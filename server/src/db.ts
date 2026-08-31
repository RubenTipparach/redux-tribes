/**
 * Storage. `node:sqlite` is built into Node 22, so there is no native module to
 * compile and the Docker image needs no build toolchain. One file, one writer,
 * which is what a single Fly machine wants.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env['DATABASE_PATH'] ?? './ft.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS matches (
    id          TEXT PRIMARY KEY,
    seed        TEXT NOT NULL,
    scenario    TEXT NOT NULL,
    turn        INTEGER NOT NULL DEFAULT 0,
    created_ms  INTEGER NOT NULL,
    closed      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS players (
    match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    joined_ms   INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );

  -- One row per player per turn. The lockstep gate is simply: are all of a
  -- match's players present for this turn yet?
  CREATE TABLE IF NOT EXISTS orders (
    match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    turn        INTEGER NOT NULL,
    player_id   TEXT NOT NULL,
    body        TEXT NOT NULL,
    sent_ms     INTEGER NOT NULL,
    PRIMARY KEY (match_id, turn, player_id)
  );

  -- Reported state hashes. Divergence is detected here, not guessed at: two
  -- clients that ran the same orders must report the same hash (ADR-6).
  CREATE TABLE IF NOT EXISTS hashes (
    match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    turn        INTEGER NOT NULL,
    player_id   TEXT NOT NULL,
    hash        TEXT NOT NULL,
    sent_ms     INTEGER NOT NULL,
    PRIMARY KEY (match_id, turn, player_id)
  );

  CREATE INDEX IF NOT EXISTS orders_by_turn ON orders(match_id, turn);
  CREATE INDEX IF NOT EXISTS hashes_by_turn ON hashes(match_id, turn);

  -- Anonymous accounts. No email, no password, nothing to lose if it leaks:
  -- an id and a secret minted on first visit and kept in the browser. The
  -- point is continuity across rooms and matches, not identity in any
  -- stronger sense, so the cheapest thing that survives a page reload wins.
  CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    created_ms  INTEGER NOT NULL,
    seen_ms     INTEGER NOT NULL
  );

  -- A room is where people gather before a match exists. It becomes a match
  -- when it starts, and keeps the match id so a late arrival can be told
  -- where everyone went.
  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    scenario    TEXT NOT NULL,
    -- 'pve' seats one person against the AI, 'pvp' seats two people.
    mode        TEXT NOT NULL,
    host_id     TEXT NOT NULL REFERENCES accounts(id),
    -- open -> playing -> done. A room never returns to open: starting it
    -- mints a match, and a match is the thing that has a history.
    status      TEXT NOT NULL DEFAULT 'open',
    match_id    TEXT,
    seed        TEXT NOT NULL,
    created_ms  INTEGER NOT NULL,
    updated_ms  INTEGER NOT NULL
  );

  -- Who is in a room, and which side they will fly. Seat is 0 or 1 and is
  -- what the client maps its own ships through; the simulation only knows
  -- sides, never whose they are.
  CREATE TABLE IF NOT EXISTS seats (
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    side        INTEGER NOT NULL,
    ready       INTEGER NOT NULL DEFAULT 0,
    joined_ms   INTEGER NOT NULL,
    PRIMARY KEY (room_id, account_id)
  );

  CREATE INDEX IF NOT EXISTS rooms_open ON rooms(status, updated_ms);
  CREATE INDEX IF NOT EXISTS seats_by_room ON seats(room_id, side);

  -- The ship library. A design is a small JSON record the client authors and
  -- the client reads back; the server stores it, says who saved it and when,
  -- and never interprets it. It cannot: what a design MEANS is the core's
  -- business, and the core does not run here (ADR-6).
  --
  -- Everything is public to read and anybody may clone anything. Cloning is a
  -- new row with a new owner rather than a reference, so a design that someone
  -- is working from cannot change under them, and deleting yours never breaks
  -- anyone else's.
  CREATE TABLE IF NOT EXISTS designs (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES accounts(id),
    owner_name  TEXT NOT NULL,
    name        TEXT NOT NULL,
    class_key   TEXT NOT NULL,
    -- What the shipyard shows on a card without parsing the whole record.
    mass        REAL NOT NULL DEFAULT 0,
    hull        REAL NOT NULL DEFAULT 0,
    legal       INTEGER NOT NULL DEFAULT 0,
    body        TEXT NOT NULL,
    -- The design this was cloned from, for provenance. Never a live link.
    from_id     TEXT,
    created_ms  INTEGER NOT NULL,
    updated_ms  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS designs_recent ON designs(updated_ms);
  CREATE INDEX IF NOT EXISTS designs_by_owner ON designs(owner_id, updated_ms);
`);

export const nowMs = (): number => Date.now();
