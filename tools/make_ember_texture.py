#!/usr/bin/env python3
"""Generate the ember texture the torn edge of a hull is drawn with.

    python3 tools/make_ember_texture.py [--check]

GUIDELINES rule 3: a texture is a static FILE with a committed generator, never
something built at runtime and never drawn by hand once. So this script is the
source and `web/public/ember.png` is the product, and `--check` fails if the two
have drifted.

WHAT IT IS. Sixteen 64 x 64 tiles in a 256 x 256 atlas, every dimension a power
of two (rule 3 again). Each tile is a crust of char broken by a network of
glowing cracks:

  crust   the cooled shell, dark and mottled
  cracks  where it has split and the hot material underneath shows through
  embers  a few bright specks, because a real burn is not uniform

SIXTEEN of them because one is worse than none. A wound is hundreds of cell
faces a tenth of a unit across, and the same tile on all of them reads as a
repeating pattern rather than as burning: each face picks a tile by a hash of
its own cell, so neighbours differ.

HOW IT IS USED. `MeshBasicMaterial` multiplies `map` by the vertex colour, and
the vertex colour is the heat ramp in `wound.ts`. So this file carries only the
PATTERN, in near neutral greys, and the colour of a burn stays in one place:
the ramp. A texture with orange baked into it would be a second opinion about
how hot a wound is, and the two would drift the first time either was tuned.
The mean is held near 0.62 so a fresh wound is as bright with the texture on as
it was with flat colour, rather than the whole effect going dim.

No third party imaging library: the PNG encoder below is thirty lines and the
alternative is a dependency in a repo that has none.
"""

import argparse
import hashlib
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "ember.png"

TILE = 64
GRID = 4
SIZE = TILE * GRID

# What the crust and the cracks sit at, before the heat ramp multiplies them.
CRUST_LO, CRUST_HI = 0.09, 0.26
CRACK_TOP = 1.0
# Where a crack starts to open. Higher is a finer web: at 0.74 the "cracks"
# were half the tile and the whole thing read as camouflage.
CRACK_EDGE = 0.90
# Dark on purpose. A wound is char with hot material showing THROUGH it, so the
# mean belongs well under half; holding it at 0.62 forced the brightness into
# the crust, which is the part that is supposed to be burnt out.
TARGET_MEAN = 0.34


def rng(seed: int):
    """A tiny deterministic generator, so a regeneration is bit identical."""
    state = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state / 0x100000000

    return nxt


def value_noise(period: int, seed: int):
    """Periodic value noise on a `period` x `period` lattice.

    Periodic so a tile meets itself without a seam, which matters because a
    face may be seen next to another face carrying the same tile.
    """
    r = rng(seed)
    lattice = [[r() for _ in range(period)] for _ in range(period)]

    def at(x: float, y: float) -> float:
        fx, fy = x * period, y * period
        x0, y0 = int(math.floor(fx)), int(math.floor(fy))
        tx, ty = fx - x0, fy - y0
        # Smoothstep, so the lattice does not show as a grid of diamonds.
        tx = tx * tx * (3 - 2 * tx)
        ty = ty * ty * (3 - 2 * ty)
        a = lattice[y0 % period][x0 % period]
        b = lattice[y0 % period][(x0 + 1) % period]
        c = lattice[(y0 + 1) % period][x0 % period]
        d = lattice[(y0 + 1) % period][(x0 + 1) % period]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

    return at


def fbm(x: float, y: float, octaves, ) -> float:
    total, amp, norm = 0.0, 1.0, 0.0
    for oct_at in octaves:
        total += amp * oct_at(x, y)
        norm += amp
        amp *= 0.5
    return total / norm


def tile_pixels(index: int) -> list:
    """One tile, as a list of TILE*TILE floats in 0..1."""
    seed = 0x9E3779B9 ^ (index * 2654435761)
    crack_oct = [value_noise(p, seed + i * 97) for i, p in enumerate((6, 12, 24, 48))]
    crust_oct = [value_noise(p, seed + 500 + i * 31) for i, p in enumerate((8, 16, 32))]
    speck = value_noise(32, seed + 999)

    out = []
    for py in range(TILE):
        for px in range(TILE):
            x, y = px / TILE, py / TILE
            # Ridged noise: the ridges run along the contours of the field, so
            # they read as a crack network rather than as blobs.
            n = fbm(x, y, crack_oct)
            ridge = 1.0 - abs(2.0 * n - 1.0)
            if ridge <= CRACK_EDGE:
                crack = 0.0
            else:
                t = (ridge - CRACK_EDGE) / (1.0 - CRACK_EDGE)
                crack = t * t * (3 - 2 * t)
            crust = CRUST_LO + (CRUST_HI - CRUST_LO) * fbm(x, y, crust_oct)
            v = crust + (CRACK_TOP - crust) * crack
            # A few embers sitting proud of the crust.
            s = speck(x, y)
            if s > 0.95:
                v = max(v, 0.5 + (s - 0.95) * 9.0)
            out.append(min(1.0, max(0.0, v)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if the committed PNG differs from a fresh one")
    args = ap.parse_args()

    tiles = [tile_pixels(i) for i in range(GRID * GRID)]

    # Hold the mean where the flat colour used to be, so turning the texture on
    # changes the DETAIL of a wound and not how bright it is.
    mean = sum(sum(t) for t in tiles) / (len(tiles) * TILE * TILE)
    gain = TARGET_MEAN / mean

    rows = bytearray()
    for y in range(SIZE):
        ty, iy = divmod(y, TILE)
        for x in range(SIZE):
            tx, ix = divmod(x, TILE)
            v = min(1.0, tiles[ty * GRID + tx][iy * TILE + ix] * gain)
            # Near neutral, with the cracks a touch warmer than the crust: the
            # HEAT is the vertex colour's job, this only says where the hot
            # material shows.
            r = int(255 * min(1.0, v * 1.04))
            g = int(255 * v)
            b = int(255 * v * (0.90 + 0.10 * (1.0 - v)))
            rows += bytes((r, g, b))

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)                      # filter 0, none
        raw += rows[y * SIZE * 3:(y + 1) * SIZE * 3]

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))

    if args.check:
        if not OUT.exists():
            print(f"{OUT} is missing; run this script without --check")
            return 1
        have = OUT.read_bytes()
        if have != png:
            print(f"{OUT} has drifted from {Path(__file__).name}; regenerate it")
            return 1
        print(f"ember.png matches its generator ({len(png)} bytes)")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(png)
    print(f"wrote {OUT} ({SIZE}x{SIZE}, {GRID * GRID} tiles, {len(png)} bytes, "
          f"sha {hashlib.sha256(png).hexdigest()[:12]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
