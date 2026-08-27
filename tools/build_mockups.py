#!/usr/bin/env python3
"""Build every mockup into a self contained page, and write the mockup index.

Adapted from RubenTipparach/adventure-2dcon-26 tools/build_mockups.py (same author,
same rules). Kept deliberately close to the original so fixes flow both ways.

GUIDELINES.md rule 2.1: a mockup is one HTML file with no network at all, because the
artifact CSP blocks external hosts and a page that silently fails to load three.js
renders nothing rather than reporting an error. So the source page references
shared files by relative path and this script folds them in.

    mockups/<slug>/page.html   source, references ../vendor and ../common
    mockups/<slug>/index.html  generated, self contained, committed

The index at mockups/index.html is generated from each page's own <title> and
<meta name="description">, so there is no second copy of a mockup's pitch to go
stale. A page missing either one is a hard error rather than a blank card.

Pages are fragments on purpose: no doctype, no <html>, no <head>, no <body>. That
is what the artifact publisher expects, and a browser supplies them anyway when
the file is opened directly.

    python3 tools/build_mockups.py [--check]

--check exits non zero if any index.html on disk differs from what would be
generated, for use before a commit.
"""

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOCKUPS = ROOT / "mockups"
# Named by codepoint so this file stays pure ASCII and survives its own sweep.
BANNED = {"\u2014": "em dash", "\u2013": "en dash"}

# THE SAME TWO DASHES SPELLED AS HTML, which is the hole this closes. CLAUDE.md
# rule 1's own sweep greps for the CODEPOINTS, and the named entity form is
# seven ASCII characters that the browser renders as U+2014: it passes that
# sweep and puts a long dash on screen anyway. A page is exactly where somebody
# reaches for the entity form, so it is exactly where the check has to know
# about it. The numeric forms are covered too, being the same character by a
# third and fourth spelling.
# Assembled from fragments so this file does not itself contain the strings it
# bans, exactly as BANNED above is named by codepoint for the same reason. A
# checker that fails its own check is a checker somebody switches off.
_AMP = "&"
BANNED_ENTITY = re.compile(
    _AMP + r"(?:m" + r"dash|n" + r"dash|#8212|#8211|#[xX]201[34]);",
    re.IGNORECASE)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def inline(page_path: Path) -> str:
    """Fold every local <link rel=stylesheet> and <script src> into the page."""
    src = read(page_path)
    base = page_path.parent

    def css(match):
        href = match.group(1)
        if "//" in href:
            raise SystemExit(f"{page_path}: remote stylesheet {href}, mockups take no network")
        return "<style>\n" + read((base / href).resolve()) + "\n</style>"

    def js(match):
        ref = match.group(1)
        if "//" in ref:
            raise SystemExit(f"{page_path}: remote script {ref}, mockups take no network")
        return "<script>\n" + read((base / ref).resolve()) + "\n</script>"

    src = re.sub(r'<link[^>]*rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*>', css, src)
    src = re.sub(r'<script[^>]*src=["\']([^"\']+)["\'][^>]*>\s*</script>', js, src)

    leftover = re.search(r'<(?:script[^>]*\ssrc|link[^>]*\shref)=["\']([^"\']+)', src)
    if leftover:
        raise SystemExit(f"{page_path}: {leftover.group(1)} was not inlined")
    return src


def meta_of(page_path: Path) -> dict:
    src = read(page_path)
    title = re.search(r"<title>(.*?)</title>", src, re.S)
    desc = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']\s*/?>', src, re.S)
    if not title:
        raise SystemExit(f"{page_path}: no <title>, the index is generated from it")
    if not desc:
        raise SystemExit(f"{page_path}: no <meta name=\"description\">, the index is generated from it")
    return {
        "slug": page_path.parent.name,
        "title": " ".join(title.group(1).split()),
        "desc": " ".join(desc.group(1).split()),
    }


def check_dashes(path: Path, text: str) -> list:
    """GUIDELINES.md rule 1. Checked here so a mockup cannot smuggle one in.

    BOTH SPELLINGS. A raw U+2014 is what the rule's grep finds; `&mdash;` is the
    same character written in ASCII, which sails past that grep and renders as a
    long dash in the one place a reader actually sees it.
    """
    hits = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for ch, name in BANNED.items():
            if ch in line:
                hits.append(f"{path}:{line_no}: {name}")
        for found in BANNED_ENTITY.findall(line):
            hits.append(f"{path}:{line_no}: {found} is a dash spelled as HTML")
    return hits


INDEX_TEMPLATE = """<title>Mockups</title>
<meta name="description" content="Design mockups for Fallen Tribes, each one a single self contained page.">
<style>
{css}
.cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 8px; }}
.cards a {{
  display: block; padding: 20px 22px; text-decoration: none;
  background: var(--bg-panel); border: 1px solid var(--line); border-radius: 8px;
  transition: border-color .14s, transform .14s;
}}
.cards a:hover {{ border-color: var(--accent); transform: translateY(-2px); }}
.cards h3 {{ margin: 0 0 7px; color: var(--ink); font-size: 18px; }}
.cards p {{ margin: 0; font-size: 14px; }}
.cards .slug {{
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--accent-dim); margin: 0 0 9px;
}}
</style>

<div class="wrap">
<header>
  <p class="kicker">fallen tribes</p>
  <h1>Mockups</h1>
  <p class="lede">One self contained page each. Numbers are taken from
  <code>prototype/sim/data.js</code> and the design docs, so a mockup answers the question
  the game will actually ask rather than one at a convenient scale.</p>
</header>

<div class="cards">
{cards}
</div>

<footer>
  Generated by <code>tools/build_mockups.py</code> from each page's own title and description.
  Adding a mockup is adding a directory.
</footer>
</div>
"""


def main() -> int:
    check_only = "--check" in sys.argv
    pages = sorted(MOCKUPS.glob("*/page.html"))
    if not pages:
        raise SystemExit("no mockups/*/page.html found")

    problems, metas, stale = [], [], []

    for page in pages:
        built = inline(page)
        metas.append(meta_of(page))
        problems += check_dashes(page, read(page))
        out = page.parent / "index.html"
        if check_only:
            if not out.exists() or out.read_text(encoding="utf-8") != built:
                stale.append(str(out.relative_to(ROOT)))
        else:
            out.write_text(built, encoding="utf-8")
            print(f"built {out.relative_to(ROOT)} ({len(built):,} bytes)")

    cards = "\n".join(
        '  <a href="./{slug}/"><p class="slug">{slug}</p><h3>{title}</h3><p>{desc}</p></a>'.format(
            slug=html.escape(mm["slug"]),
            title=html.escape(mm["title"]),
            desc=html.escape(mm["desc"]),
        )
        for mm in metas
    )
    index = INDEX_TEMPLATE.format(css=read(MOCKUPS / "common" / "harness.css"), cards=cards)
    index_path = MOCKUPS / "index.html"
    if check_only:
        if not index_path.exists() or index_path.read_text(encoding="utf-8") != index:
            stale.append(str(index_path.relative_to(ROOT)))
    else:
        index_path.write_text(index, encoding="utf-8")
        print(f"built {index_path.relative_to(ROOT)} ({len(index):,} bytes)")

    for p in problems:
        print("DASH: " + p, file=sys.stderr)
    for s in stale:
        print("STALE: " + s + " differs from its source", file=sys.stderr)
    return 1 if (problems or stale) else 0


if __name__ == "__main__":
    sys.exit(main())
