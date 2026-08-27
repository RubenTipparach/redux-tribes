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
`);

export const nowMs = (): number => Date.now();
