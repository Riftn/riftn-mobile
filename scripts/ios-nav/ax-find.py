"""Finds a button by its label in the simulator's accessibility dump.

Usage: ax-find.py <idb describe-all json> <label> <log file> <request name> [--last]
Prints "x y" (the centre of the first match, or last with --last) when found, and adds one line
about it to the log either way.
"""
import json
import sys

dump, wanted, log, name = sys.argv[1:5]
prefer_last = sys.argv[5:] == ["--last"]
try:
    items = json.load(open(dump))
except Exception:
    items = []


def walk(nodes):
    for node in nodes or []:
        if isinstance(node, dict):
            yield node
            yield from walk(node.get("children"))


seen = []
hit = None
for node in walk(items if isinstance(items, list) else [items]):
    label = (node.get("AXLabel") or "").strip()
    if label:
        seen.append(label)
    frame = node.get("frame") or {}
    # Only what a finger can reach: a copy scrolled up under the status bar
    # (a profile's tab bar behind its pinned copy) is passed over.
    if (hit is None or prefer_last) and label == wanted and frame.get("width") and frame.get("height"):
        cx, cy = round(frame["x"] + frame["width"] / 2), round(frame["y"] + frame["height"] / 2)
        if 50 <= cy <= 840:
            hit = (cx, cy)

with open(log, "a") as out:
    if hit:
        out.write(f"{name}: \"{wanted}\" at {hit[0]},{hit[1]} ({len(seen)} labels on screen)\n")
    else:
        out.write(f"{name}: \"{wanted}\" not on screen ({len(seen)} labels: {' | '.join(seen[:40])})\n")
if hit:
    print(hit[0], hit[1])
