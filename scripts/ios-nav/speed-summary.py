#!/usr/bin/env python3
"""Turns the speed tour's result files into before/after tables.

    speed-summary.py <dir with speed-before-N.json and speed-after-N.json>

Each cell is the median over the rounds. "frozen" is the time lost to late
frames after the action, "longest" the single longest stretch without a
frame, "drawn" how many elements the app created (how much of the screen it
drew again). Typing rows give the time from a key to the second frame after
it, and what was drawn for that one key.
"""
import glob
import json
import os
import statistics
import sys

directory = sys.argv[1]


def load(variant):
    runs = []
    for path in sorted(glob.glob(os.path.join(directory, f"speed-{variant}-*.json"))):
        try:
            data = json.load(open(path))
        except Exception:
            continue
        if data.get("steps") or data.get("detail"):
            runs.append(data)
    return runs


def median(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.median(values)) if values else None


def show(value):
    return "-" if value is None else f"{value}"


before, after = load("before"), load("after")
order = []
for run in before + after:
    for step in run.get("steps", []):
        if step["step"] not in order:
            order.append(step["step"])


def step_cell(runs, name, field):
    return median([s[field] for run in runs for s in run.get("steps", []) if s["step"] == name])


def detail_cell(runs, name, field):
    return median([run.get("detail", {}).get(name, {}).get(field) for run in runs])


print(f"Runs: before {len(before)}, after {len(after)}. Times in ms, median of the runs.\n")
for label, runs in (("before", before), ("after", after)):
    for run in runs:
        print(f"{label}: signed in {run.get('signedIn')}, chats {run.get('chats')}, lines in the opened chat {run.get('chatLines')}" + (f", error {run['error']}" if run.get("error") else ""))
print()
print("| action | frozen before | frozen after | longest before | longest after | drawn before | drawn after | last draw before | last draw after |")
print("|---|---|---|---|---|---|---|---|---|")
totals = {"b": 0, "a": 0}
for name in order:
    b = [step_cell(before, name, f) for f in ("blockedMs", "worstMs")] + [detail_cell(before, name, f) for f in ("elements", "lastDrawMs")]
    a = [step_cell(after, name, f) for f in ("blockedMs", "worstMs")] + [detail_cell(after, name, f) for f in ("elements", "lastDrawMs")]
    totals["b"] += b[0] or 0
    totals["a"] += a[0] or 0
    print(f"| {name} | {show(b[0])} | {show(a[0])} | {show(b[1])} | {show(a[1])} | {show(b[2])} | {show(a[2])} | {show(b[3])} | {show(a[3])} |")
print(f"| all actions | {totals['b']} | {totals['a']} | | | | | | |")

typing = []
for run in before + after:
    for name, value in run.get("detail", {}).items():
        if isinstance(value, dict) and ("keyMs" in value or "error" in value and "typing" in name) and name not in typing:
            typing.append(name)
if typing:
    print("\n| typing | key to frame before | after | worst key before | after | drawn per key before | after | worst drawn before | after |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name in typing:
        cells = []
        for field in ("keyMs", "keyWorstMs", "keyElements", "keyElementsWorst"):
            cells += [show(detail_cell(before, name, field)), show(detail_cell(after, name, field))]
        print(f"| {name} | " + " | ".join(cells) + " |")
    for name in ("search typing",):
        for field, title in (("suggestionsMs", "suggestions shown after the last key"), ("resultsMs", "results shown after the search key")):
            print(f"\n{title}: before {show(detail_cell(before, name, field))}, after {show(detail_cell(after, name, field))}")

print("\nSlowest renders the app timed itself (last run of each side):")
for label, runs in (("before", before), ("after", after)):
    if not runs:
        continue
    print(f"\n{label}")
    for name, value in runs[-1].get("detail", {}).items():
        if not isinstance(value, dict):
            continue
        if value.get("error"):
            print(f"- {name}: {value['error']}")
            continue
        top = value.get("top") or []
        if top:
            print(f"- {name}: {value.get('tasks')} tasks, {value.get('taskMs')} ms in all, longest {value.get('longest')} ms, stalls {value.get('stalls')} ms | " + "; ".join(top[:6]))
        kinds = value.get("kinds") or []
        if kinds:
            print(f"  drawn most: " + ", ".join(kinds[:10]))
        built_by = value.get("owners") or []
        if built_by:
            print(f"  built by: " + ", ".join(built_by))
