#!/usr/bin/env python3
"""Bundle harness.html + sim/*.js into one self-contained HTML fragment
(for publishing as a claude.ai artifact, which supplies the doctype/head/body
skeleton itself). Usage: python3 prototype/tools/bundle.py OUTPUT_PATH"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "harness.html").read_text()

# keep head extras (title, font link, style), drop the document skeleton
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
head = re.sub(r"<meta[^>]*>\s*", "", head)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)

def inline(m):
    src = m.group(1)
    js = (root / src).read_text()
    return "<script>\n" + js + "\n</script>"

body = re.sub(r'<script src="([^"]+)"></script>', inline, body)

out = pathlib.Path(sys.argv[1])
out.write_text(head.strip() + "\n" + body.strip() + "\n")
print("bundled", out, out.stat().st_size, "bytes")
