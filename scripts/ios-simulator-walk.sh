#!/usr/bin/env bash
# Walks a Release build of the app on a booted iPhone simulator: opens each
# page by deep link in light and dark, screenshots it, and notes any page
# after which the app is no longer running. Used by ios-simulator-check.yml.
#
#   scripts/ios-simulator-walk.sh <simulator udid> <path to .app> <output dir>
set -uo pipefail

UDID="$1"
APP="$2"
OUT="$3"
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
EXE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Info.plist")"

mkdir -p "$OUT/shots" "$OUT/logs"
: > "$OUT/crashes.txt"

xcrun simctl install "$UDID" "$APP"
for service in photos camera microphone location; do
  xcrun simctl privacy "$UDID" grant "$service" "$BUNDLE" >/dev/null 2>&1 || true
done

xcrun simctl spawn "$UDID" log stream --style compact --level info \
  --predicate "process == \"$EXE\"" > "$OUT/logs/app.log" 2>&1 &
LOG_PID=$!
trap 'kill "$LOG_PID" 2>/dev/null' EXIT

# Runs a command, and gives up on it after the given number of seconds.
limit() {
  perl -e 'alarm shift; exec @ARGV' "$@"
}

running() {
  xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -q "UIKitApplication:$BUNDLE"
}

# The iPhone Duo has two screens, and a plain screenshot can fail there: then
# try each display by name, and keep the errors so a missing picture is explained.
shot() {
  local f="$OUT/shots/$1.png" d
  xcrun simctl io "$UDID" screenshot "$f" >/dev/null 2>>"$OUT/logs/shot-errors.txt" && return 0
  for d in internal inner main external outer; do
    xcrun simctl io "$UDID" screenshot --display="$d" "$f" >/dev/null 2>>"$OUT/logs/shot-errors.txt" && return 0
  done
  screencapture -x -o -l"$(osascript -e 'tell application "Simulator" to id of window 1' 2>/dev/null)" "$f" 2>>"$OUT/logs/shot-errors.txt" \
    || screencapture -x "$f" 2>>"$OUT/logs/shot-errors.txt" || true
}

launch() {
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
}

# iOS 26 asks "Open in …?" before the simulator hands a deep link to the app.
# When the prompt's blue Open button is on screen, tap it (needs idb).
confirm_open() {
  command -v idb >/dev/null 2>&1 || return 0
  if [ "${DEVICE:-iphone}" != "iphone" ]; then
    confirm_open_anywhere
    return 0
  fi
  local i
  for i in 1 2 3 4; do
    xcrun simctl io "$UDID" screenshot "$OUT/.prompt.png" >/dev/null 2>&1 || return 0
    if python3 - "$OUT/.prompt.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
scale = im.size[0] / 402
blue = 0
for dx in range(-60, 61, 20):
    for dy in (-10, 0, 10):
        r, g, b = im.getpixel((int((275 + dx) * scale), int((474 + dy) * scale)))
        if b > 200 and r < 60:
            blue += 1
sys.exit(0 if blue >= 10 else 1)
PY
    then
      idb ui tap --udid "$UDID" 275 474 >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
  done
}

# The same prompt on an iPad sits somewhere else, and moves when the iPad is
# turned: find its Open button by name, or failing that by its blue fill.
# The iPad asks once, then remembers: after its Open has been tapped, one
# look per page is enough.
OPEN_TAPPED=0
confirm_open_anywhere() {
  local i pos tries="1 2 3 4"
  [ "$OPEN_TAPPED" = 1 ] && tries="1"
  for i in $tries; do
    limit 15 idb ui describe-all --udid "$UDID" > "$OUT/.ax.json" 2>/dev/null || echo "[]" > "$OUT/.ax.json"
    pos="$(python3 scripts/ios-nav/ax-find.py "$OUT/.ax.json" Open "$OUT/logs/open-prompt.txt" open)"
    if [ -z "$pos" ]; then
      xcrun simctl io "$UDID" screenshot "$OUT/.prompt.png" >/dev/null 2>&1 || return 0
      pos="$(python3 - "$OUT/.prompt.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
scale = 2
xs, ys = [], []
for y in range(h // 4, h * 3 // 4, 4):
    for x in range(w // 4, w * 3 // 4, 4):
        r, g, b = im.getpixel((x, y))
        if b > 200 and r < 60 and 90 < g < 170:
            xs.append(x); ys.append(y)
if len(xs) > 150:
    bw, bh = (max(xs) - min(xs)) / scale, (max(ys) - min(ys)) / scale
    if 60 <= bw <= 400 and 24 <= bh <= 80:
        print(round((min(xs) + max(xs)) / 2 / scale), round((min(ys) + max(ys)) / 2 / scale))
PY
)"
    fi
    if [ -n "$pos" ]; then
      # shellcheck disable=SC2086
      limit 15 idb ui tap --udid "$UDID" $pos >/dev/null 2>&1 || true
      OPEN_TAPPED=1
      return 0
    fi
    sleep 1
  done
}

# Turns the simulator on its side through the Simulator app's Device menu.
turn_sideways() {
  limit 30 open -a Simulator --args -CurrentDeviceUDID "$UDID" || return 1
  sleep 15
  limit 30 osascript -e 'tell application "Simulator" to activate' \
    -e 'tell application "System Events" to tell process "Simulator" to click menu item "Rotate Left" of menu "Device" of menu bar 1' \
    >> "$OUT/logs/rotate.txt" 2>&1 || return 1
  sleep 4
}

PAGES=(
  "app/post/742"
  "app"
  "app/post/5799"
  "app/post/742/info"
  "maldoteth"
  "app/features"
  "app/leaderboard"
  "dao"
  "app/governance"
  "app/superpowers"
  "app/wallet"
  "app/fractions"
  "nfts"
  "app/agents"
  "packs"
  "creators"
  "raffle"
  "builder"
  "app/launchpad"
  "premium"
  "pricing"
  "depin"
  "app/bridge"
  "apps"
  "arcade"
  "arcade/gods-eye"
  "arcade/kings-gambit"
  "app/notifications"
  "app/messages"
  "compare"
  "app/planned"
  "live-studio"
  "accounts"
  "usernames"
  "converter"
  "creator/maboroshi"
  "creator/flow"
  "connect"
  "work/history"
  "feedback"
  "welcome"
  "signin"
)

# The app's own theme pick (Settings > Appearance), written where the app's
# storage reads it on launch. The app must not be running.
set_app_theme() {
  local data dir
  data="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data 2>/dev/null)" || return 0
  dir="$data/Library/Application Support/$BUNDLE/RCTAsyncLocalStorage_V1"
  mkdir -p "$dir"
  python3 - "$dir/manifest.json" "$1" <<'PY'
import json, os, sys
path, value = sys.argv[1], sys.argv[2]
manifest = {}
if os.path.exists(path):
    try:
        manifest = json.load(open(path))
    except Exception:
        manifest = {}
manifest["dehub.theme"] = value
json.dump(manifest, open(path, "w"))
PY
}

SIDEWAYS_PAGES=(
  "app"
  "app/post/742"
  "app/post/5799"
  "maldoteth"
  "app/features"
  "app/leaderboard"
  "app/wallet"
  "app/messages"
  "arcade"
  "pricing"
  "signin"
)

# walk <phone appearance> <app theme> <label> [sideways]
walk() {
  local appearance="$1" app_theme="$2" theme="$3"
  if [ "${4:-}" = "sideways" ]; then
    PAGES=("${SIDEWAYS_PAGES[@]}")
  fi
  xcrun simctl ui "$UDID" appearance "$appearance"
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  set_app_theme "$app_theme"
  launch
  sleep 25
  shot "$theme-00-home"
  local i=1
  for page in "${PAGES[@]}"; do
    local name
    name="$(printf '%s-%02d-%s' "$theme" "$i" "$(echo "$page" | tr '/:?' '---')")"
    xcrun simctl openurl "$UDID" "dehub://$page" >/dev/null 2>&1 || echo "openurl failed: $page" >> "$OUT/crashes.txt"
    confirm_open
    sleep 6
    shot "$name"
    echo "$(date +%H:%M:%S) $name"
    if ! running; then
      echo "$theme: app not running after opening $page" >> "$OUT/crashes.txt"
      launch
      sleep 20
    fi
    i=$((i + 1))
  done
}

# THEMES picks which walks run (default all three): dark and light are the
# phone's setting under the app's System theme; syslight is the app's own
# System Light pick.
for t in ${THEMES:-dark light syslight}; do
  case "$t" in
    dark) walk dark system dark ;;
    light) walk light system light ;;
    syslight) walk light system-light syslight ;;
  esac
done

if [ "${DEVICE:-iphone}" != "iphone" ]; then
  if turn_sideways; then
    walk dark system side-dark sideways
  else
    echo "could not turn the simulator on its side" >> "$OUT/crashes.txt"
  fi
fi

sleep 3
kill "$LOG_PID" 2>/dev/null
cp ~/Library/Logs/DiagnosticReports/"$EXE"*.ips "$OUT/logs/" 2>/dev/null || true
ls ~/Library/Logs/DiagnosticReports/ > "$OUT/logs/diagnostic-reports.txt" 2>/dev/null || true
grep -iE "fatal|exception|crash|unhandled|TypeError|ReferenceError|Invariant Violation|RCTFatal" "$OUT/logs/app.log" \
  | grep -v "libsystem" | head -400 > "$OUT/logs/errors.txt" || true
# Uncaught JS errors and app self-restarts, with the stack, first few in full
# then every distinct first line with a count.
{
  grep -n -A20 -m3 -E '\[FatalJS\]|\[UncaughtJS\]|\[restartApp\]' "$OUT/logs/app.log" || true
  echo "----"
  grep -E '\[FatalJS\]|\[UncaughtJS\]|\[restartApp\]' "$OUT/logs/app.log" \
    | sed -E 's/^[^]]*\] //; s/restarts in window: [0-9]+//' | cut -c1-300 | sort | uniq -c | sort -rn | head -40 || true
} > "$OUT/logs/js-faults.txt"

echo "Pages walked: ${#PAGES[@]} x themes: ${THEMES:-dark light syslight}"
echo "Problems:"
cat "$OUT/crashes.txt"
echo "Error lines in app log: $(wc -l < "$OUT/logs/errors.txt")"
echo "JS restarts: $(grep -c 'state = restarting' "$OUT/logs/app.log")"
echo "Keychain failures: $(grep -c 'ERR_KEY_CHAIN' "$OUT/logs/app.log")"
echo "JS faults (first lines):"
sed -n '/^----$/,$p' "$OUT/logs/js-faults.txt" | head -15
rm -f "$OUT/.prompt.png" "$OUT/.ax.json"
