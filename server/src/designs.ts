/**
 * The ship library.
 *
 * A design is a small JSON record the client authors and the client reads
 * back. The server stores it, stamps who saved it and when, and never
 * interprets it: what a design MEANS is the core's business and the core does
 * not run here (ADR-6). So there is no validation of parts or mass beyond
 * "this is an object of the right shape and a sane size". The mass, hull and
 * legality on a row are the CLIENT's own figures, kept for the card only, and
 * labelled as such wherever they are shown.
 *
 * Everything is public to read and anybody may clone anything. A clone is a
 * new row with a new owner rather than a reference: a design someone is
 * working from cannot change under them, and deleting yours never breaks
 * anyone else's.
 */
import type express from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowMs } from './db.ts';
import { account } from './lobby.ts';

export interface DesignRow {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  class_key: string;
  mass: number;
  hull: number;
  legal: number;
  body: string;
  from_id: string | null;
  created_ms: number;
  updated_ms: number;
}

const one = <T,>(r: unknown): T | undefined => r as T | undefined;
const many = <T,>(r: unknown): T[] => r as T[];

const COLS = 'id, owner_id, owner_name, name, class_key, mass, hull, legal, body,'
  + ' from_id, created_ms, updated_ms';

const qd = {
  list: db.prepare(`SELECT ${COLS} FROM designs ORDER BY updated_ms DESC LIMIT ?`),
  mine: db.prepare(`SELECT ${COLS} FROM designs WHERE owner_id = ? ORDER BY updated_ms DESC LIMIT ?`),
  get: db.prepare(`SELECT ${COLS} FROM designs WHERE id = ?`),
  insert: db.prepare(`INSERT INTO designs (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare('UPDATE designs SET name = ?, class_key = ?, mass = ?, hull = ?,'
    + ' legal = ?, body = ?, updated_ms = ? WHERE id = ? AND owner_id = ?'),
  remove: db.prepare('DELETE FROM designs WHERE id = ? AND owner_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM designs WHERE owner_id = ?'),
};

/** What a client sees. The body goes back verbatim; nothing here rewrites it. */
export function designView(row: DesignRow, meId: string | null): Record<string, unknown> {
  return {
    designId: row.id,
    name: row.name,
    classKey: row.class_key,
    owner: { accountId: row.owner_id, name: row.owner_name },
    mine: meId !== null && row.owner_id === meId,
    // The client's own figures at save time, kept for the card. The authority
    // on what a design derives is derive() reading the body, never this.
    reported: { mass: row.mass, hull: row.hull, legal: row.legal === 1 },
    clonedFrom: row.from_id,
    createdMs: row.created_ms,
    updatedMs: row.updated_ms,
    design: JSON.parse(row.body) as unknown,
  };
}

/** One person may not fill the library on their own. */
const PER_ACCOUNT = 60;
/** A frigate's record is a few kilobytes; this is room to spare, not a target. */
const MAX_BODY = 64 * 1024;

export function mountDesigns(app: express.Express): void {
  /** The library, newest first. Public: no account needed to look. */
  app.get('/v1/designs', (req, res) => {
    const me = account(req);
    const limit = Math.min(200, Math.max(1, Number(req.query['limit'] ?? 60) || 60));
    const rows = req.query['mine'] === '1'
      ? (me ? many<DesignRow>(qd.mine.all(me.id, limit)) : [])
      : many<DesignRow>(qd.list.all(limit));
    res.json({ designs: rows.map(r => designView(r, me?.id ?? null)) });
  });

  app.get('/v1/designs/:id', (req, res) => {
    const me = account(req);
    const row = one<DesignRow>(qd.get.get(req.params.id));
    if (!row) { res.status(404).json({ error: 'no such design' }); return; }
    res.json(designView(row, me?.id ?? null));
  });

  /**
   * Save a design, or clone one. Both are the same operation: a new row owned
   * by whoever sent it. `from` records where it came from, for provenance.
   */
  app.post('/v1/designs', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'sign in first' }); return; }
    const body = req.body as {
      name?: unknown; design?: unknown; from?: unknown;
      mass?: unknown; hull?: unknown; legal?: unknown;
    };
    const design = body.design;
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
      res.status(400).json({ error: 'design must be an object' });
      return;
    }
    const classKey = (design as { classKey?: unknown }).classKey;
    if (typeof classKey !== 'string' || !classKey) {
      res.status(400).json({ error: 'design needs a classKey' });
      return;
    }
    const text = JSON.stringify(design);
    if (text.length > MAX_BODY) {
      res.status(413).json({ error: 'design is too large' });
      return;
    }
    const held = one<{ n: number }>(qd.count.get(me.id))?.n ?? 0;
    if (held >= PER_ACCOUNT) {
      res.status(429).json({ error: `you already have ${held} designs saved` });
      return;
    }
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 48)
      : 'Untitled';
    const now = nowMs();
    const id = randomUUID();
    qd.insert.run(id, me.id, me.name, name, classKey,
      Number(body.mass) || 0, Number(body.hull) || 0, body.legal ? 1 : 0,
      text, typeof body.from === 'string' ? body.from : null, now, now);
    const row = one<DesignRow>(qd.get.get(id));
    res.status(201).json(designView(row as DesignRow, me.id));
  });

  /** Update one of your own. Someone else's is a 403, not a silent no-op. */
  app.post('/v1/designs/:id', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'sign in first' }); return; }
    const row = one<DesignRow>(qd.get.get(req.params.id));
    if (!row) { res.status(404).json({ error: 'no such design' }); return; }
    if (row.owner_id !== me.id) {
      res.status(403).json({ error: 'not yours: save it as a clone instead' });
      return;
    }
    const body = req.body as {
      name?: unknown; design?: unknown; mass?: unknown; hull?: unknown; legal?: unknown;
    };
    const design = body.design;
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
      res.status(400).json({ error: 'design must be an object' });
      return;
    }
    const classKey = (design as { classKey?: unknown }).classKey;
    if (typeof classKey !== 'string' || !classKey) {
      res.status(400).json({ error: 'design needs a classKey' });
      return;
    }
    const text = JSON.stringify(design);
    if (text.length > MAX_BODY) { res.status(413).json({ error: 'design is too large' }); return; }
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 48)
      : row.name;
    qd.update.run(name, classKey, Number(body.mass) || 0, Number(body.hull) || 0,
      body.legal ? 1 : 0, text, nowMs(), row.id, me.id);
    res.json(designView(one<DesignRow>(qd.get.get(row.id)) as DesignRow, me.id));
  });

  app.delete('/v1/designs/:id', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'sign in first' }); return; }
    const row = one<DesignRow>(qd.get.get(req.params.id));
    if (!row) { res.status(404).json({ error: 'no such design' }); return; }
    if (row.owner_id !== me.id) { res.status(403).json({ error: 'not yours' }); return; }
    qd.remove.run(row.id, me.id);
    res.json({ ok: true });
  });
}
