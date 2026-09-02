/**
 * Where the app is, as a URL.
 *
 * Every screen used to be a `hidden` class toggled from wherever happened to
 * be doing the toggling, so the address bar said `/` through a whole match and
 * a refresh threw the game away. Which screen you are on is state, and state
 * that a reload has to survive belongs in the URL: a room has an id, a saved
 * game has an id, a design has an id, and each of those is a path you can send
 * to yourself.
 *
 * Real paths rather than a hash, because the server already answers anything
 * that is not an API route with the app shell (`index.html`), so a refresh on
 * `/play/abc123` arrives at the same page a click did.
 *
 * This module knows nothing about screens. It parses, it formats, and it tells
 * whoever asked that the route changed; deciding what a route MEANS is the
 * app's business, and a router that showed panels would be a second place that
 * knows the screen list.
 */

/** Every screen that has an address. */
export type Route =
  | { readonly kind: 'lobby' }
  /** A local game, by the id its save is filed under. */
  | { readonly kind: 'play'; readonly gameId: string }
  /** A room, before and during the match it becomes. */
  | { readonly kind: 'room'; readonly roomId: string }
  /** The shipyard, on a saved design or on a new one. */
  | { readonly kind: 'ship'; readonly designId?: string }
  /**
   * The architect, on a base frame or on the list of them.
   *
   * A class key rather than a minted id, the same closed authored set
   * `/ship/<classKey>` already addresses: a frame is not a resource a player
   * creates, it is one of twenty three this build ships, so browsing them is
   * a trail you can walk back and a link you can send.
   */
  | { readonly kind: 'architect'; readonly classKey?: string };

/**
 * Ids that may appear in a path.
 *
 * Server ids are hex or base36 and the local ones are minted here, so this is
 * deliberately narrow: anything else is somebody else's URL, or a typo, and
 * both should land on the lobby rather than on a lookup for a thing that
 * cannot exist.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const LOBBY: Route = { kind: 'lobby' };

/** A path back into a route. Unknown paths are the lobby. */
export function parse(path: string): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  // Two segments at most. A longer path is not a route with something extra on
  // the end, it is a different address, and quietly reading the first two of
  // it would have `/ship/a/b/c` open design `a`.
  if (parts.length > 2) return LOBBY;
  const [head, id] = parts;
  if (head === 'play' && id && ID.test(id)) return { kind: 'play', gameId: id };
  if (head === 'room' && id && ID.test(id)) return { kind: 'room', roomId: id };
  if (head === 'ship') return id && ID.test(id) ? { kind: 'ship', designId: id } : { kind: 'ship' };
  if (head === 'architect')
    return id && ID.test(id) ? { kind: 'architect', classKey: id } : { kind: 'architect' };
  return LOBBY;
}

/** A route back into a path. The inverse of `parse` for everything `parse`
 *  recognises, which is what the round trip test pins. */
export function href(r: Route): string {
  switch (r.kind) {
    case 'play': return `/play/${encodeURIComponent(r.gameId)}`;
    case 'room': return `/room/${encodeURIComponent(r.roomId)}`;
    case 'ship': return r.designId ? `/ship/${encodeURIComponent(r.designId)}` : '/ship';
    case 'architect':
      return r.classKey ? `/architect/${encodeURIComponent(r.classKey)}` : '/architect';
    default: return '/';
  }
}

/** Are these the same place? Used to keep a redundant push out of the history,
 *  which is what turns one Back press into five. */
export function same(a: Route, b: Route): boolean {
  return href(a) === href(b);
}

type Listener = (r: Route) => void;
let listener: Listener | null = null;

/** Where the browser currently is. */
export function current(): Route {
  return parse(typeof location === 'undefined' ? '/' : location.pathname);
}

/**
 * Go somewhere.
 *
 * `replace` for a move that is not a place a player would want to come Back
 * to: opening a game they were already in, or correcting a URL that named
 * something gone. Everything else pushes, so Back walks the screens they
 * actually visited.
 *
 * The listener runs either way. A router that only fired on `popstate` would
 * leave every in app navigation to also call the thing it navigated to, which
 * is two ways to change screen and one of them will be forgotten.
 */
export function go(r: Route, opts: { replace?: boolean } = {}): void {
  const url = href(r);
  if (typeof history !== 'undefined') {
    if (opts.replace) history.replaceState(null, '', url);
    else if (url !== location.pathname) history.pushState(null, '', url);
  }
  listener?.(r);
}

/** Start listening. One listener: the app is one thing, and a second one would
 *  be a second opinion about which screen is up. */
export function onRoute(fn: Listener): void {
  listener = fn;
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => { fn(current()); });
  }
}

/** A fresh id for something that only exists in this browser. Short enough to
 *  read out, wide enough that two games started in the same second do not
 *  collide. */
export function newId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 10);
}
