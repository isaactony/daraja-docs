"""Checks that every code block marked "From examples/..." matches the tested example file.

Each line of the snippet, up to a "Usage" comment, must appear in the named file (ignoring
leading whitespace and blank lines). Run: python3 scripts/check-snippets.py
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
failures = 0
checked = 0
for page in sorted(root.rglob("*.mdx")):
    if "examples" in page.parts:
        continue
    text = page.read_text()
    for block in re.findall(r"```[^\n]*\n(.*?)```", text, re.S):
        match = re.match(r"\s*(?://|#) From (examples/[^\s)]+)", block)
        if not match:
            continue
        source = (root / match.group(1)).read_text()
        source_lines = {line.strip() for line in source.splitlines() if line.strip()}
        checked += 1
        for line in block.splitlines()[1:]:
            if re.match(r"\s*(//|#) Usage", line):
                break
            if line.strip() and line.strip() not in source_lines:
                failures += 1
                print(f"{page.relative_to(root)}: not in {match.group(1)}: {line.strip()}")
print(f"{checked} snippets checked, {failures} mismatched lines")
sys.exit(1 if failures else 0)
