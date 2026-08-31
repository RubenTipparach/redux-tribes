#!/usr/bin/env python3
"""Candidate surface finishes and window decals for a hull, for review.

    python3 tools/make_surface_textures.py [--check]

WHAT THIS IS FOR. A hull is a lattice of cells and every cell face is drawn as a
flat rectangle of one colour. That reads at map range and it is bare up close,
which is exactly where the console now takes a player: the ship data inspector
zooms in on one hull. Two things fix that without touching a single rule:

  a NORMAL MAP per palette colour, so a player picks what their armour is MADE
  of (riveted panel, corrugation, hex ablative, greebles) and every cell wearing
  that colour is lit as though it had that surface, and

  a WINDOW DECAL per cell, painted on in the shipyard, which adds a recess to
  the normals and a glow to the emission while the cell keeps the paint colour
  it already had.

Neither changes an outcome, so neither crosses the boundary: meshes and
materials are the client's business (CLAUDE.md, the boundary). What a player
picked is stored with the design beside `paint`, and like `paint` it is not part
of what the core is told and not part of the hash.

WHY A FILE PER FINISH AND NOT ONE ATLAS. The ember texture is an atlas because
its tiles are picked per face and never repeat. A finish is the opposite: it has
to TILE, once per cell, across a greedy quad that may be twenty cells wide, and
repeat wrapping repeats the whole image rather than one tile of it. Separate
textures also cost nothing in draw calls here, because a design wears one finish
per colour and realistically one or two colours.

HOW THEY ARE DELIVERED FOR REVIEW. `tex/` holds the PNGs, which are what a
person can open, and `textures.js` holds the same bytes as data URIs, which is
what the mockup can load: GUIDELINES 2.1 gives a mockup no network at all, and
that includes no `<img src>` to a file beside it. Both come out of one run from
the same bytes, and `--check` fails if either has drifted.

NOT SHIPPED YET, AND STOPGAP EITHER WAY. Nothing here is written into
`web/public/`; this is the mockup GUIDELINES 2 asks for before a feature is
built. And per GUIDELINES 4 the tool for a texture is Material Maker, which
still answers 403 on every download path from this sandbox, so whichever of
these is approved should be re-authored as a `.ptex` graph rather than shipped
from here.

NO `sin` ANYWHERE, for the reason `texkit.py` explains at length: `--check`
compares bytes on a machine that is not this one.
"""

import argparse
import hashlib
import sys
from base64 import b64encode
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from texkit import (   # noqa: E402
    ROOT, clamp01, dome, emit, fbm, frac, normal_png, rgb_png, rng, smoothstep,
    tri, value_noise, wrap_delta,
)

OUT = ROOT / "mockups" / "surface-finishes"
SIZE = 128


# ------------------------------------------------------- armour finishes --
#
# Every one of these returns a height field: a flat list of SIZE * SIZE values
# in roughly 0 to 1, which `normal_png` differentiates into a normal map. They
# are authored as HEIGHT rather than as normals directly because a height field
# is a thing a person can reason about, and because the two derivatives then
# cannot disagree with each other.

def field(fn) -> list:
    """Sample a height function over the tile."""
    return [fn((x + 0.5) / SIZE, (y + 0.5) / SIZE)
            for y in range(SIZE) for x in range(SIZE)]


def f_smooth() -> list:
    """No finish. The off state, so the palette has one."""
    return [0.0] * (SIZE * SIZE)


def f_plate() -> list:
    """A panel with a seam round it and rivets inside the seam.

    The default a warship wants: it says "this is armour plate" at a glance and
    it puts a line on every cell boundary, which is what makes a voxel hull read
    as built rather than as a solid lump.
    """
    grain = [value_noise(p, 0x51A7E + i) for i, p in enumerate((16, 32))]
    rivets = []
    n = 5
    for i in range(n):
        t = (i + 0.5) / n
        rivets += [(t, 0.085), (t, 0.915), (0.085, t), (0.915, t)]

    def h(x, y):
        d = min(x, 1 - x, y, 1 - y)
        v = smoothstep(0.0, 0.052, d) * 0.62      # seam groove at the edge
        v += smoothstep(0.052, 0.16, d) * 0.10    # and a shallow crown inside
        for (cx, cy) in rivets:
            dx, dy = wrap_delta(cx, x), wrap_delta(cy, y)
            r = (dx * dx + dy * dy) ** 0.5
            if r < 0.028:
                v += dome(r / 0.028) * 0.30
        return v + 0.045 * (fbm(x, y, grain) - 0.5)
    return field(h)


def f_ribbed() -> list:
    """Corrugation. Structural, cheap to read, and it gives a hull a direction."""
    grain = [value_noise(24, 0x0BB1)]

    def h(x, y):
        v = smoothstep(0.30, 0.92, tri(y * 5.0)) * 0.85
        d = min(x, 1 - x, y, 1 - y)
        v *= smoothstep(0.0, 0.04, d)             # the corrugation stops at the seam
        return v + 0.035 * (fbm(x, y, grain) - 0.5)
    return field(h)


def _voronoi(cols: int, rows: int, jitter: float, seed: int):
    """Nearest and second nearest centre on a staggered lattice.

    Staggered because a Voronoi of a staggered lattice is a field of hexagons,
    which is what ablative tiling looks like, and jittering the same lattice
    turns it into cracked plating without a second implementation.
    """
    r = rng(seed)
    jx = [[(r() - 0.5) * jitter / cols for _ in range(cols)] for _ in range(rows)]
    jy = [[(r() - 0.5) * jitter / rows for _ in range(cols)] for _ in range(rows)]

    def centre(c: int, rw: int):
        cc, rr = c % cols, rw % rows
        return ((c + 0.5 * (rw & 1) + 0.5) / cols + jx[rr][cc],
                (rw + 0.5) / rows + jy[rr][cc])

    def at(x: float, y: float):
        rw0 = int(y * rows)
        c0 = int(x * cols)
        d1 = d2 = 9.0
        for dr in (-1, 0, 1):
            for dc in (-2, -1, 0, 1, 2):
                cx, cy = centre(c0 + dc, rw0 + dr)
                dx, dy = wrap_delta(cx, x), wrap_delta(cy, y)
                d = (dx * dx + dy * dy) ** 0.5
                if d < d1:
                    d2, d1 = d1, d
                elif d < d2:
                    d2 = d
        return d1, d2

    return at


def f_hex() -> list:
    """Ablative tiling. The one that most says "this ship expects to be shot"."""
    vor = _voronoi(4, 5, 0.0, 0x11E1)

    def h(x, y):
        d1, d2 = vor(x, y)
        edge = smoothstep(0.0, 0.030, d2 - d1)     # groove along every seam
        return edge * (0.62 + 0.24 * smoothstep(0.10, 0.0, d1))
    return field(h)


def f_cracked() -> list:
    """The same lattice, thrown out of true: irregular plating, welded up."""
    vor = _voronoi(5, 6, 0.85, 0x3C4A)
    grain = [value_noise(p, 0x77D + i) for i, p in enumerate((12, 28))]

    def h(x, y):
        d1, d2 = vor(x, y)
        edge = smoothstep(0.0, 0.024, d2 - d1)
        weld = smoothstep(0.030, 0.014, d2 - d1) * 0.22   # a proud bead in the seam
        return edge * 0.60 + weld + 0.06 * (fbm(x, y, grain) - 0.5)
    return field(h)


def f_tread() -> list:
    """Crossed grip bars. Deck plate, and it catches a light beautifully."""
    def bar(u, v):
        ridge = smoothstep(0.34, 0.95, tri(v))
        gap = smoothstep(0.06, 0.20, tri(u * 0.5))
        return ridge * gap

    def h(x, y):
        a = bar((x + y) * 4.0, (x - y) * 4.0)
        b = bar((x - y) * 4.0 + 0.5, (x + y) * 4.0 + 0.5)
        return (a if a > b else b) * 0.80
    return field(h)


def f_greeble() -> list:
    """Kit bashed boxes. The look every model maker glued on to sell scale.

    Many small boxes rather than a few big ones, and panel lines between them.
    A normal map only shows an EDGE, so a handful of wide flat lids is a nearly
    blank tile: what makes greebling read is edge density, not box count.
    """
    r = rng(0x6EEB)
    boxes = []
    for _ in range(30):
        w = 0.030 + r() * 0.085
        t = 0.030 + r() * 0.070
        boxes.append((r(), r(), w, t, 0.22 + r() * 0.70))
    grain = [value_noise(20, 0x6EEC)]

    def h(x, y):
        v = 0.10
        # Panel lines under everything, so the flat ground is not featureless.
        v -= smoothstep(0.045, 0.0, tri(x * 3.0) * 0.5) * 0.10
        v -= smoothstep(0.045, 0.0, tri(y * 2.0) * 0.5) * 0.10
        for (cx, cy, w, t, hgt) in boxes:
            dx, dy = abs(wrap_delta(cx, x)), abs(wrap_delta(cy, y))
            if dx < w and dy < t:
                # A chamfer rather than a cliff, or the normals are a hard edge
                # one texel wide and alias into nothing at distance.
                e = min(smoothstep(0.0, 0.014, w - dx), smoothstep(0.0, 0.014, t - dy))
                b = hgt * e
                if b > v:
                    v = b
        return v + 0.04 * (fbm(x, y, grain) - 0.5)
    return field(h)


def f_weave() -> list:
    """Woven composite: strips over and under, with the gaps between them.

    The gap is the whole thing. A first cut had the strips meeting edge to edge,
    which is not a weave but a checkerboard of raised squares: what says woven
    is seeing one strip pass BEHIND another and the ground showing between them.
    """
    n = 4.0
    band = 0.78          # how much of each period the strip occupies

    def strip(t: float) -> float:
        """Height across one strip, 0 in the gap either side of it."""
        k = abs(2.0 * frac(t) - 1.0) / band
        return 0.0 if k >= 1.0 else dome(k)

    def h(x, y):
        warp = strip(x * n)                       # runs along y
        weft = strip(y * n)                       # runs along x
        over_warp = ((int(x * n) + int(y * n)) & 1) == 0
        if warp <= 0.0 and weft <= 0.0:
            return 0.0                            # the ground, seen through
        if over_warp:
            return warp * 0.88 + weft * 0.30
        return weft * 0.88 + warp * 0.30
    return field(h)


def f_battered() -> list:
    """Dents, scoring and a couple of deep gouges. A hull with a history."""
    dents = [value_noise(p, 0xBA77 + i) for i, p in enumerate((6, 13, 26))]
    r = rng(0xBA78)
    gouges = [(r(), r(), r() - 0.5, r() - 0.5) for _ in range(3)]

    def h(x, y):
        v = 0.55 + 0.30 * (fbm(x, y, dents) - 0.5)
        for (ax, ay, dx, dy) in gouges:
            ln = (dx * dx + dy * dy) ** 0.5
            if ln < 1e-6:
                continue
            ux, uy = dx / ln, dy / ln
            px, py = wrap_delta(ax, x), wrap_delta(ay, y)
            t = px * ux + py * uy
            t = -0.14 if t < -0.14 else (0.14 if t > 0.14 else t)
            ox, oy = px - ux * t, py - uy * t
            d = (ox * ox + oy * oy) ** 0.5
            v -= smoothstep(0.030, 0.0, d) * 0.42
        return v
    return field(h)


ARMOUR = [
    ("smooth",   "Smooth",       "No finish. Bare plate, and the off state.",              f_smooth,   0.0),
    ("plate",    "Riveted",      "Panel seams with rivets. The default a warship wants.",  f_plate,   34.0),
    ("ribbed",   "Corrugated",   "Structural ribbing. Gives a hull a grain.",              f_ribbed,  30.0),
    ("hex",      "Ablative",     "Hex tiling. Says the ship expects to be shot at.",       f_hex,     32.0),
    ("cracked",  "Patched",      "Irregular plates, welded. A hull with a past.",          f_cracked, 30.0),
    ("tread",    "Grip deck",    "Crossed bars. Catches a raking light.",                  f_tread,   26.0),
    ("greeble",  "Greebled",     "Kit bashed boxes. Scale, the way a model maker sells it.", f_greeble, 26.0),
    ("weave",    "Composite",    "Woven strips, over and under.",                          f_weave,   24.0),
    ("battered", "Battered",     "Dents and gouges. Hard use, before a shot lands.",        f_battered, 26.0),
]


# --------------------------------------------------------- window decals --
#
# A decal comes in two halves: a height field that recesses the glass behind a
# frame, and an emission that says what colour the light is.
#
# It tiles like everything else, and it costs nothing to let it: every shape
# here is inset from the tile border with flat hull around it, so the seam is
# already invisible, and one wrap mode for every texture beats two. It also
# means two window cells side by side merge into ONE quad carrying two windows,
# which is what a row of portholes should be.
#
# The albedo is untouched on purpose. A cell keeps the armour colour a player
# painted it, and the window is a recess and a glow ON that colour, which is
# what makes a window painted onto a green hull look like a window in a green
# hull rather than a sticker.

WARM = (1.00, 0.86, 0.62)     # lived in: galley light, crew spaces
DEEP = (1.00, 0.62, 0.26)     # the falloff at the edge of a warm pane
COOL = (0.80, 0.92, 1.00)     # instrument light, which is what a bridge is
AMBER = (1.00, 0.72, 0.20)    # running lights and bay markers


def lerp3(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def _panes(spec):
    """Shared shape for every rectangular window: a list of (x0, y0, x1, y1, lit).

    `lit` is 0 to 1, and it is deliberately not 1 everywhere. A row of identical
    panes reads as a texture; one dark pane and one dim one reads as a ship with
    somebody aboard, and it costs nothing.
    """
    def height(x, y):
        v = 0.0
        for (x0, y0, x1, y1, _lit) in spec:
            if x0 - 0.045 < x < x1 + 0.045 and y0 - 0.045 < y < y1 + 0.045:
                # Frame proud of the hull, glass sunk behind it.
                v = max(v, 0.85)
            if x0 < x < x1 and y0 < y < y1:
                inset = min(x - x0, x1 - x, y - y0, y1 - y)
                v = min(v, 0.85 - smoothstep(0.0, 0.020, inset) * 0.85)
        return v

    def emission(x, y, hot, cold):
        for (x0, y0, x1, y1, lit) in spec:
            if x0 < x < x1 and y0 < y < y1:
                inset = min(x - x0, x1 - x, y - y0, y1 - y)
                k = smoothstep(0.0, 0.026, inset)
                return tuple(v * lit * (0.35 + 0.65 * k)
                             for v in lerp3(cold, hot, k))
        return (0.0, 0.0, 0.0)

    return height, emission


def w_porthole():
    """One round window. The unit a habitation deck is made of."""
    def height(x, y):
        dx, dy = x - 0.5, y - 0.5
        r = (dx * dx + dy * dy) ** 0.5
        frame = smoothstep(0.345, 0.300, r) * 0.9
        glass = smoothstep(0.268, 0.238, r) * 0.9
        return frame - glass

    def emission(x, y):
        dx, dy = x - 0.5, y - 0.5
        r = (dx * dx + dy * dy) ** 0.5
        if r >= 0.252:
            return (0.0, 0.0, 0.0)
        # Bright almost to the rim, then a quick falloff. A slow radial ramp
        # from the centre reads as a lit BALL rather than as a lit room.
        k = smoothstep(0.252, 0.205, r)
        return tuple(v * (0.30 + 0.70 * k) for v in lerp3(DEEP, WARM, k))
    return height, emission


def w_panes():
    """Four square windows. A cabin block."""
    g, lit = 0.055, (1.0, 0.55, 0.9, 0.0)
    spec, i = [], 0
    for by in (0.5 + g, 0.5 - g - 0.30):
        for bx in (0.5 + g, 0.5 - g - 0.30):
            spec.append((bx, by, bx + 0.30, by + 0.30, lit[i]))
            i += 1
    height, emission = _panes(spec)
    return height, lambda x, y: emission(x, y, WARM, DEEP)


def w_strip():
    """A viewport band with mullions. A promenade, or a long corridor."""
    spec, n = [], 4
    lit = (1.0, 0.72, 1.0, 0.45)
    for i in range(n):
        x0 = 0.10 + i * (0.80 / n)
        spec.append((x0 + 0.014, 0.40, x0 + 0.80 / n - 0.014, 0.60, lit[i]))
    height, emission = _panes(spec)
    return height, lambda x, y: emission(x, y, WARM, DEEP)


def w_bridge():
    """One wide canted viewport. Where somebody is flying this thing."""
    def shape(x, y):
        # Canted: the top edge runs wider than the bottom one.
        half = 0.16 + 0.20 * smoothstep(0.30, 0.68, y)
        return abs(x - 0.5) < half and 0.32 < y < 0.68

    def height(x, y):
        if shape(x, y):
            d = min(0.68 - y, y - 0.32, 0.02 + 0.5 - abs(x - 0.5))
            return 0.85 - smoothstep(0.0, 0.028, d) * 0.85
        half = 0.16 + 0.20 * smoothstep(0.30, 0.68, y)
        near = abs(x - 0.5) < half + 0.05 and 0.28 < y < 0.72
        return 0.85 if near else 0.0

    def emission(x, y):
        if not shape(x, y):
            return (0.0, 0.0, 0.0)
        d = min(0.68 - y, y - 0.32)
        k = smoothstep(0.0, 0.05, d)
        return tuple(v * (0.45 + 0.55 * k) for v in lerp3(WARM, COOL, k))
    return height, emission


def w_beacons():
    """Three running lights. Not a window: the thing that makes a hull read as
    crewed at a range where a window is one pixel."""
    pts = [(0.5, 0.22), (0.5, 0.50), (0.5, 0.78)]

    def height(x, y):
        v = 0.0
        for (cx, cy) in pts:
            dx, dy = x - cx, y - cy
            r = (dx * dx + dy * dy) ** 0.5
            if r < 0.075:
                v = max(v, dome(r / 0.075) * 0.75)
        return v

    def emission(x, y):
        for (cx, cy) in pts:
            dx, dy = x - cx, y - cy
            r = (dx * dx + dy * dy) ** 0.5
            if r < 0.062:
                k = smoothstep(0.062, 0.0, r)
                return tuple(v * (0.25 + 0.75 * k) for v in lerp3(AMBER, (1, 1, 0.92), k))
        return (0.0, 0.0, 0.0)
    return height, emission


def w_hangar():
    """A bay mouth: deeply recessed, lit from inside, with a lip round it."""
    x0, x1, y0, y1 = 0.14, 0.86, 0.22, 0.78

    def height(x, y):
        if x0 < x < x1 and y0 < y < y1:
            inset = min(x - x0, x1 - x, y - y0, y1 - y)
            return 0.9 - smoothstep(0.0, 0.045, inset) * 0.9
        if x0 - 0.06 < x < x1 + 0.06 and y0 - 0.06 < y < y1 + 0.06:
            return 0.9
        return 0.35

    def emission(x, y):
        if not (x0 < x < x1 and y0 < y < y1):
            return (0.0, 0.0, 0.0)
        inset = min(x - x0, x1 - x, y - y0, y1 - y)
        k = smoothstep(0.0, 0.12, inset)
        # Floor lit: brighter low in the opening, because the deck is what a
        # bay light actually falls on.
        floor = smoothstep(0.70, 0.24, y)
        c = lerp3(DEEP, (1.0, 0.93, 0.80), k)
        return tuple(v * (0.20 + 0.80 * k) * (0.55 + 0.45 * floor) for v in c)
    return height, emission


WINDOWS = [
    ("porthole", "Porthole",  "One round window. The unit a habitation deck is made of.", w_porthole),
    ("panes",    "Cabins",    "Four panes, and one of them dark.",                        w_panes),
    ("strip",    "Promenade", "A viewport band with mullions.",                           w_strip),
    ("bridge",   "Bridge",    "A canted viewport, lit by instruments.",                   w_bridge),
    ("beacons",  "Beacons",   "Running lights. Reads as crewed at map range.",            w_beacons),
    ("hangar",   "Bay mouth", "A recessed opening, lit from the deck inside.",            w_hangar),
]

WINDOW_STRENGTH = 26.0


# ------------------------------------------------------------------ main --

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if anything on disk differs from a fresh run")
    args = ap.parse_args()

    files: list = []      # (relative path, bytes)

    for key, _label, _blurb, build, strength in ARMOUR:
        h = build()
        files.append((f"tex/armour_{key}_n.png", normal_png(h, SIZE, strength, True)))

    for key, _label, _blurb, build in WINDOWS:
        height, emission = build()
        h = [height((x + 0.5) / SIZE, (y + 0.5) / SIZE)
             for y in range(SIZE) for x in range(SIZE)]
        e = [emission((x + 0.5) / SIZE, (y + 0.5) / SIZE)
             for y in range(SIZE) for x in range(SIZE)]
        files.append((f"tex/window_{key}_n.png", normal_png(h, SIZE, WINDOW_STRENGTH, True)))
        files.append((f"tex/window_{key}_e.png", rgb_png(e, SIZE)))

    # The same bytes again as data URIs, because GUIDELINES 2.1 gives a mockup
    # no network at all and that includes a file sitting next to it.
    lines = ["// GENERATED by tools/make_surface_textures.py. Do not edit.",
             "//",
             "// The PNGs in tex/ as data URIs, because a mockup takes no network",
             "// (GUIDELINES 2.1) and an <img src> to a sibling file is a request.",
             "window.FT_TEX = {"]
    for path, png in files:
        name = Path(path).stem
        lines.append(f"  {name}: 'data:image/png;base64,{b64encode(png).decode()}',")
    lines.append("};")
    js = ("\n".join(lines) + "\n").encode()
    files.append(("textures.js", js))

    ok = True
    for path, data in files:
        target = OUT / path
        if args.check:
            ok = emit(target, data, True) and ok
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

    total = sum(len(d) for p, d in files if p.startswith("tex/"))
    if args.check:
        if not ok:
            return 1
        print(f"surface textures match their generator ({len(files)} files)")
        return 0

    print(f"wrote {len(files)} files to {OUT}")
    print(f"  {len(ARMOUR)} armour finishes, {len(WINDOWS)} window decals, "
          f"{SIZE}x{SIZE} each")
    print(f"  {total} bytes of PNG, {len(js)} bytes of data URI bundle")
    for path, data in files:
        if path.startswith("tex/"):
            print(f"    {len(data):7d}  {path}  "
                  f"{hashlib.sha256(data).hexdigest()[:8]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
