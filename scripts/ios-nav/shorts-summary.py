"""Shorts swipe timings from a `task=shorts` run of ios-nav-timing.sh.

For every swipe the script sent (nav/<run>.swipes, one wall-clock ms per
line) it finds the first video clock that started running after it
(nav/<run>.json "motions", written by tour.ts): that is the short swiped to.
Prints a markdown table, main's code against this checkout's.

    python3 scripts/ios-nav/shorts-summary.py <nav dir>
"""
import glob
import json
import os
import statistics
import sys

nav = sys.argv[1]
# A start more than this long after the swipe belongs to nothing it did.
WINDOW_MS = 4000


def runs(side):
    out = []
    for path in sorted(glob.glob(os.path.join(nav, f"shorts-{side}-*.json"))):
        name = os.path.basename(path)[:-5]
        try:
            result = json.load(open(path))
        except Exception:
            continue
        swipes_path = os.path.join(nav, f"{name}.swipes")
        swipes = [int(x) for x in open(swipes_path).read().split()] if os.path.exists(swipes_path) else []
        motions = sorted(result.get("motions", []), key=lambda m: m["wall"])
        delays = []
        for sent in swipes:
            later = [m for m in motions if sent - 30 <= m["wall"] <= sent + WINDOW_MS]
            delays.append(later[0]["wall"] - sent if later else None)
        # A swipe begun on the timeline row: did it bring a new short (a
        # player that had not run before it), or was it taken for a seek?
        low_path = os.path.join(nav, f"{name}.lowswipes")
        lows = [int(x) for x in open(low_path).read().split()] if os.path.exists(low_path) else []
        turned = []
        for sent in lows:
            # The flick two seconds before it brings one new player by itself.
            known = {m["player"] for m in motions if m["wall"] < sent - 2600}
            fresh = {m["player"] for m in motions if sent - 2600 <= m["wall"] <= sent + WINDOW_MS} - known
            turned.append(len(fresh) >= 2)
        out.append({"name": name, "delays": delays, "turned": turned, "patched": result.get("patched"), "opened": result.get("opened")})
    return out


def line(label, side):
    all_runs = runs(side)
    delays = [d for r in all_runs for d in r["delays"]]
    seen = sorted(d for d in delays if d is not None)
    if not seen:
        return f"| {label} | no swipes timed | | | |", all_runs
    return (
        f"| {label} | {round(statistics.median(seen))} ms | {seen[len(seen) // 10]} ms | {seen[-1]} ms | "
        f"{len(seen)} of {len(delays)} |",
        all_runs,
    )


print("## Shorts: next short playing, after the swipe is sent\n")
print("Time from sending a 0.25 s upward flick (idb) to the next short's clock running.")
print("Includes idb's own start-up, the same on both sides.\n")
print("| Code | median | fastest 10% | worst | swipes timed |")
print("|---|---|---|---|---|")
details = []
for label, side in (("main", "before"), ("this branch", "after")):
    row, all_runs = line(label, side)
    print(row)
    details.extend(all_runs)
print("\n## Shorts: a swipe that starts on the timeline row\n")
print("Sent two seconds after landing on a short. It should bring the next short, not seek this one.\n")
print("| Code | turned the page |")
print("|---|---|")
for label, side in (("main", "before"), ("this branch", "after")):
    turned = [t for r in runs(side) for t in r["turned"]]
    print(f"| {label} | {sum(turned)} of {len(turned)} |")
print("\n### Each run\n")
for r in details:
    shown = ", ".join("-" if d is None else str(d) for d in r["delays"])
    print(f"- {r['name']} (viewer opened: {r['opened']}, watched: {r['patched']}): {shown}")
