"""Finds a button by its label in the simulator's accessibility dump.

Usage: ax-find.py <idb describe-all json> <label> <log file> <request name>
Prints "x y" (the centre of the first match) when found, and adds one line
about it to the log either way.
"""
import json
import sys

dump, wanted, log, name = sys.argv[1:5]
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
    if hit is None and label == wanted and frame.get("width") and frame.get("height"):
        hit = (round(frame["x"] + frame["width"] / 2), round(frame["y"] + frame["height"] / 2))

with open(log, "a") as out:
    if hit:
        out.write(f"{name}: \"{wanted}\" at {hit[0]},{hit[1]} ({len(seen)} labels on screen)\n")
    else:
        out.write(f"{name}: \"{wanted}\" not on screen ({len(seen)} labels)\n")
if hit:
    print(hit[0], hit[1])
