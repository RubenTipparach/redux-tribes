/**
 * Unsaved work in the shipyard, and the view you were looking at it from.
 *
 * An hour of fitting a hull died on a reload, a Back press, or a closed tab,
 * with no warning and nothing to come back to. The design existed only as a
 * field on a live `Designer`; nothing tracked whether it had diverged from
 * what was loaded, and nothing wrote it anywhere.
 *
 * **The draft key IS the route id**, which is what makes this more than an
 * autosave. `/ship/<designId>` drafts under that design id and
 * `/ship/<classKey>` drafts under that class key, so the address fully
 * determines what you are editing INCLUDING the work you have not saved.
 * Reloading any shipyard URL puts you back exactly where you were, and two
 * different hulls in progress do not collide because they are at two different
 * addresses.
 *
 * `localStorage`, for the same reason the game shelf uses it: this has to work
 * with no server, and a draft is nobody else's business until it is saved.
 * A draft is explicitly NOT a save. It is never listed in the library, never
 * fielded in a match, and is thrown away the moment the real thing exists.
 *
 * Two stores, kept apart on purpose. A DRAFT belongs to one hull and is that
 * hull's unsaved state. PREFERENCES belong to the person and follow them
 * across every hull: which tab is open, whether plate is ghosted, where the
 * camera sits. CLAUDE.md's routing rule says view state does not go in the
 * URL, and this is where it goes instead.
 */

/** Where the drafts live. Versioned, because a shape change here must not
 *  resurrect as a half readable hull. */
const KEY = 'ft.drafts.v1';
const PREF_KEY = 'ft.shipyard.prefs.v1';

/**
 * How many hulls in progress to keep.
 *
 * Smaller than the game shelf, because a draft is a working copy rather than a
 * record: past about this many, the oldest is something you abandoned rather
 * than something you meant to come back to.
 */
// One per class plus room for saved hulls in progress. Eight was one slot per
// class when there were five; with seventeen, merely BROWSING the class picker
// wrote seventeen drafts and evicted the saved hull somebody was building.
const KEEP = 28;
/** Total budget. localStorage is a handful of megabytes shared with the game
 *  shelf and the identity, and a plate array is the big thing in here. */
const MAX_BYTES = 600_000;

export interface Draft {
  /** The route id this belongs to: a design id, or a class key for a hull that
   *  has never been saved. The same string the URL carries. */
  readonly key: string;
  /** The design itself, whole. */
  readonly design: unknown;
  /** The name in the save field, so a half typed one is not lost either. */
  readonly name: string;
  /** What it was called when loaded, for saying WHAT was restored. */
  readonly of: string;
  readonly at: number;
}

/** Which tab, which toggles, which way the camera was pointing. Per person,
 *  not per hull. */
export interface Prefs {
  readonly tab?: string;
  readonly plate?: string;
  readonly mirrorX?: boolean;
  readonly mirrorY?: boolean;
  readonly depth?: number;
  readonly onion?: number;
  readonly arcs?: boolean;
  readonly target?: boolean;
}

type Shelf = Record<string, Draft>;

/** Every read goes through here, so a corrupt or blocked store is an empty one
 *  rather than an exception inside whatever was drawing. */
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
  // Newest first, then trimmed by count and by size, in that order. Trimming
  // on write rather than on a timer, because the only moment the size is known
  // to have grown is the moment something was added.
  let rows = Object.values(shelf).sort((a, b) => b.at - a.at).slice(0, KEEP);
  for (;;) {
    const body = JSON.stringify(Object.fromEntries(rows.map(d => [d.key, d])));
    if (body.length <= MAX_BYTES || rows.length <= 1) {
      try {
        localStorage.setItem(KEY, body);
      } catch {
        // A full or blocked store must not take the editor down with it. The
        // hull on screen is still fine; it just will not survive a reload.
      }
      return;
    }
    rows = rows.slice(0, rows.length - 1);
  }
}

/** Keep the unsaved state of one hull. Call it after a change, debounced by
 *  the caller: this serialises a plate array and is not free. */
export function remember(key: string, design: unknown, name: string, of: string): void {
  if (!key) return;
  const shelf = read();
  shelf[key] = { key, design, name, of, at: Date.now() };
  write(shelf);
}

/** The unsaved state of one hull, if there is any. */
export function recall(key: string): Draft | null {
  if (!key) return null;
  return read()[key] ?? null;
}

/** Throw a draft away. Called when the real thing exists, and when a person
 *  deliberately resets: a draft that outlived its save would come back over
 *  the top of the saved hull on the next reload, which is the one thing worse
 *  than losing it. */
export function forget(key: string): void {
  if (!key) return;
  const shelf = read();
  if (!(key in shelf)) return;
  delete shelf[key];
  write(shelf);
}

/** Every hull in progress, newest first, for a shelf that lists them. */
export function list(): Draft[] {
  return Object.values(read()).sort((a, b) => b.at - a.at);
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Prefs;
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Same as above: a preference is not worth an exception.
  }
}
