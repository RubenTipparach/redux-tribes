/**
 * Games in progress, kept in this browser.
 *
 * A practice match had no id and no record: it lived in the wasm module and
 * died with the tab. That is the wrong shape for something a player spends
 * forty turns on, and it is unnecessary, because a match here is already a
 * pure function of what it started from and the orders given since (ADR-6).
 * So a save is exactly that: the launch record, and one entry per resolved
 * turn. Replaying it reproduces the match bit for bit, which is the same
 * property lockstep rests on and is checked the same way.
 *
 * Not a snapshot of the state. A snapshot is bigger, is invalidated by every
 * format change, and throws away the history the review panel scrubs through;
 * orders are small, survive a rebuild, and re-run in about half a millisecond
 * a turn.
 *
 * `localStorage` rather than the server, because practice has to work with no
 * server at all and always has. A served match already persists: it has a room
 * id, its orders are on the server, and its address is `/room/<id>`.
 */

import type { PlannedOrder } from '../sim/types.js';

/** One turn's orders, keyed by ship, as they go to disk. */
export type SavedTurn = Record<string, PlannedOrder>;

export interface SavedGame {
  readonly id: string;
  /** What to call it in a list. The scenario, plus what hull was taken in. */
  readonly name: string;
  readonly seed: string;
  readonly scenario: string;
  readonly humanSides: number;
  readonly side: number;
  /** The design fielded, whole, so a game resumes into the same ship even if
   *  the library row it came from has since been edited or deleted. */
  readonly hull?: unknown;
  readonly hullName?: string;
  /** One entry per resolved turn, in order. Index IS the turn number. */
  readonly turns: SavedTurn[];
  /**
   * A strictly increasing stamp, for ordering.
   *
   * `updatedMs` cannot do it: two games started in the same millisecond tie,
   * and a tie makes the sort depend on whatever order the object happened to
   * enumerate in, which is insertion order and therefore OLDEST first. The
   * shelf then keeps the twelve oldest games and drops the one just started.
   */
  readonly seq: number;
  /** Set once the match is over, so the list can say so and stop offering it
   *  as somewhere to go back to. */
  readonly outcome?: 'won' | 'lost';
  readonly startedMs: number;
  readonly updatedMs: number;
}

const KEY = 'ft.games.v1';
/**
 * How many games to keep, and how big the shelf may get.
 *
 * `localStorage` is a few megabytes per origin and shared with everything else
 * the page keeps, so this is a shelf rather than an archive: the newest games
 * stay and the oldest fall off. A cap in BYTES as well as in count, because
 * one long match is worth more than the count suggests and a quota error is
 * not something a game should ever have to handle mid turn.
 */
const KEEP = 12;
const MAX_BYTES = 900_000;

type Shelf = Record<string, SavedGame>;

/** Every read goes through here, so a corrupt or absent shelf is an empty one
 *  rather than an exception in whatever happened to be asking. */
function read(): Shelf {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Shelf;
  } catch {
    return {};
  }
}

function write(shelf: Shelf): void {
  // Newest first, then trimmed by count and by size. Trimming inside the write
  // rather than on a timer, because the only moment the size is known to have
  // grown is the moment something was added.
  let rows = Object.values(shelf).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)).slice(0, KEEP);
  for (;;) {
    const body = JSON.stringify(Object.fromEntries(rows.map(g => [g.id, g])));
    if (body.length <= MAX_BYTES || rows.length <= 1) {
      try {
        localStorage.setItem(KEY, body);
      } catch {
        // A full or blocked store is not a reason to lose the turn that is
        // being played. The game goes on; it just will not be there tomorrow.
      }
      return;
    }
    rows = rows.slice(0, rows.length - 1);
  }
}

/** Every game on the shelf, newest first. */
export function list(): SavedGame[] {
  return Object.values(read()).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

/** The next ordering stamp: one past the highest on the shelf, so it keeps
 *  increasing across reloads without a clock to trust. */
function nextSeq(shelf: Shelf): number {
  return Object.values(shelf).reduce((a, g) => Math.max(a, g.seq ?? 0), 0) + 1;
}

export function load(id: string): SavedGame | null {
  return read()[id] ?? null;
}

export function remove(id: string): void {
  const shelf = read();
  delete shelf[id];
  write(shelf);
}

/** Start one. Written immediately, so a game that is refreshed on its first
 *  turn is still a game to come back to. */
export function create(
  g: Omit<SavedGame, 'turns' | 'startedMs' | 'updatedMs' | 'seq'>,
): SavedGame {
  const now = Date.now();
  const shelf = read();
  const made: SavedGame = { ...g, turns: [], startedMs: now, updatedMs: now, seq: nextSeq(shelf) };
  shelf[made.id] = made;
  write(shelf);
  return made;
}

/**
 * Record a resolved turn.
 *
 * By turn INDEX rather than by appending, so replaying a game that was rewound
 * overwrites the turns after the cut instead of stacking a second history
 * behind the first.
 */
export function recordTurn(id: string, turn: number, orders: SavedTurn): void {
  const shelf = read();
  const g = shelf[id];
  if (!g) return;
  const turns = g.turns.slice(0, turn);
  turns[turn] = orders;
  shelf[id] = { ...g, turns, updatedMs: Date.now(), seq: nextSeq(shelf) };
  write(shelf);
}

/** Mark how it ended, so the shelf can say so. */
export function finish(id: string, outcome: 'won' | 'lost'): void {
  const shelf = read();
  const g = shelf[id];
  if (!g) return;
  shelf[id] = { ...g, outcome, updatedMs: Date.now(), seq: nextSeq(shelf) };
  write(shelf);
}
