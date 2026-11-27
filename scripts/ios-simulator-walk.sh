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

# The iPhone Duo has two screens, and a plain screenshot refuses to pick one:
# it lists them as "--display=N  name WxH". Take every listed screen that is
# showing (the inner one is <name>.png, the outer one <name>-outer.png), and
# keep the errors so a missing picture is explained.
shot() {
  local f="$OUT/shots/$1.png" err="$OUT/.shot-err.txt" id
  xcrun simctl io "$UDID" screenshot "$f" >/dev/null 2>"$err" && return 0
  cat "$err" >> "$OUT/logs/shot-errors.txt"
  for id in $(grep -oE -- '--display=[0-9]+ +[^ ]+.* [0-9]+x[0-9]+' "$err" \
      | awk '{split($NF, d, "x"); print d[1]*d[2], $1}' | sort -rn | awk '{print $2}' | cut -d= -f2); do
    xcrun simctl io "$UDID" screenshot --display="$id" "$f" >/dev/null 2>>"$OUT/logs/shot-errors.txt" \
      && f="$OUT/shots/$1-outer.png"
  done
  return 0
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
  limit 30 open "$(xcode-select -p)/Applications/Simulator.app" --args -CurrentDeviceUDID "$UDID" || return 1
  sleep 15
  limit 30 osascript -e 'tell application "Simulator" to activate' \
    -e 'tell application "System Events" to tell process "Simulator" to click menu item "Rotate Left" of menu "Device" of menu bar 1' \
    >> "$OUT/logs/rotate.txt" 2>&1 || return 1
  sleep 4
}

# The iPhone Duo simulator boots folded, so only the small outer screen is
# lit. Open it from the Simulator's Device menu (the item's name is looked up,
# not fixed), and write every Device menu item to logs/device-menu.txt.
unfold_duo() {
  local log="$OUT/logs/device-menu.txt"
  {
    echo "== simctl ui / io help (looking for a fold command)"
    xcrun simctl help ui 2>&1
    xcrun simctl help io 2>&1 | sed -n '/screenConfig/,$p'
    xcrun simctl io "$UDID" screenConfig --display=3 help 2>&1 | head -40
  } > "$log"
  if xcrun simctl help ui 2>&1 | grep -qiE "fold|posture"; then
    for arg in "fold open" "posture open" "posture flat" "unfold"; do
      # shellcheck disable=SC2086
      if xcrun simctl ui "$UDID" $arg >> "$log" 2>&1; then echo "simctl ui $arg: ok" >> "$log"; sleep 5; return 0; fi
    done
  fi
  # The Xcode 27 runner has no Simulator app, so there is no Device menu to
  # unfold from: power the biggest screen on and the others off instead.
  if [ ! -d "$(xcode-select -p)/Applications/Simulator.app" ]; then
    echo "== no Simulator app; screens:" >> "$log"
    xcrun simctl io "$UDID" enumerate >> "$log" 2>&1 || true
    local err ids big
    err="$(xcrun simctl io "$UDID" screenshot "$OUT/.probe.png" 2>&1 >/dev/null || true)"
    ids="$(echo "$err" | grep -oE -- '--display=[0-9]+ +[^ ]+.* [0-9]+x[0-9]+' \
      | awk '{split($NF, d, "x"); print d[1]*d[2], $1}' | sort -rn | awk '{print $2}' | cut -d= -f2)"
    big="$(echo "$ids" | head -1)"
    [ -n "$big" ] || return 1
    xcrun simctl io "$UDID" screenConfig --display="$big" power on >> "$log" 2>&1 || return 1
    for id in $(echo "$ids" | tail -n +2); do
      xcrun simctl io "$UDID" screenConfig --display="$id" power off >> "$log" 2>&1 || true
    done
    sleep 5
    return 0
  fi
  echo "== open Simulator" >> "$log"
  limit 90 open "$(xcode-select -p)/Applications/Simulator.app" --args -CurrentDeviceUDID "$UDID" >> "$log" 2>&1 || { echo "open failed: $?" >> "$log"; return 1; }
  sleep 20
  limit 60 osascript >> "$log" 2>&1 <<'AS' || return 1
tell application "Simulator" to activate
delay 2
tell application "System Events" to tell process "Simulator"
  set out to ""
  set done to "none"
  set m to menu "Device" of menu bar 1
  repeat with mi in menu items of m
    set n to (name of mi) as text
    set out to out & n & linefeed
    try
      repeat with si in menu items of menu 1 of mi
        set out to out & "  > " & ((name of si) as text) & linefeed
      end repeat
    end try
  end repeat
  repeat with mi in menu items of m
    set n to (name of mi) as text
    if done is "none" and (n contains "Unfold" or n contains "Open Device") then
      click mi
      set done to n
    end if
    if done is "none" then
      try
        repeat with si in menu items of menu 1 of mi
          set sn to (name of si) as text
          if done is "none" and (sn contains "Unfold" or sn is "Open" or sn is "Opened") then
            click si
            set done to n & " > " & sn
          end if
        end repeat
      end try
    end if
  end repeat
  return out & "clicked: " & done
end tell
AS
  grep -q "clicked: none" "$log" && return 1
  sleep 5
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
  "arcade/splurge"
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

# A clean simulator starts in the three-step setup. Finish it before opening
# the game, then restart so the app starts on the returning-guest stack.
finish_splurge_guest_setup() {
  local ax="$OUT/.ax.json" log="$OUT/logs/splurge.txt" skip step completed=0
  for step in 1 2 3; do
    if ! limit 15 idb ui describe-all --udid "$UDID" > "$ax" 2>> "$log"; then
      echo "Could not read setup step $step" >> "$log"
      return 1
    fi
    skip="$(python3 scripts/ios-nav/ax-find.py "$ax" Skip "$log" "setup step $step")"
    [ -n "$skip" ] || break
    limit 15 idb ui tap --udid "$UDID" $skip >/dev/null 2>> "$log" || return 1
    completed=$step
    sleep 2
  done
  if [ "$completed" -gt 0 ]; then
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
    launch || return 1
    sleep 10
  fi
}

# The guest turn exercises the keyboard and the shared log without an account.
check_splurge() {
  local name="$1" field crt modern entry
  local ax="$OUT/.ax.json" log="$OUT/logs/splurge.txt"
  limit 15 idb ui describe-all --udid "$UDID" > "$ax" 2>> "$log" || return 1
  # The rendered prompt and its text input share an accessibility label.
  field="$(python3 scripts/ios-nav/ax-find.py "$ax" 'What would you buy?' "$log" "$name field" --last)"
  [ -n "$field" ] || return 1
  limit 15 idb ui tap --udid "$UDID" $field >/dev/null || return 1
  limit 15 idb ui text --udid "$UDID" 'A train trip' >/dev/null || return 1
  limit 15 idb ui key-sequence --udid "$UDID" 40 >/dev/null || return 1
  limit 15 idb ui describe-all --udid "$UDID" > "$ax" 2>> "$log" || return 1
  crt="$(python3 scripts/ios-nav/ax-find.py "$ax" CRT "$log" "$name CRT")"
  [ -n "$crt" ] || return 1
  limit 15 idb ui tap --udid "$UDID" $crt >/dev/null || return 1
  shot "$name-crt"
  limit 15 idb ui describe-all --udid "$UDID" > "$ax" 2>> "$log" || return 1
  modern="$(python3 scripts/ios-nav/ax-find.py "$ax" Modern "$log" "$name Modern")"
  entry="$(python3 scripts/ios-nav/ax-find.py "$ax" 'A train trip' "$log" "$name saved turn")"
  [ -n "$modern" ] && [ -n "$entry" ]
}

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
  if [ "${splurge_only:-0}" = 1 ]; then
    finish_splurge_guest_setup || {
      echo "$theme: could not finish guest setup (see logs/splurge.txt)" >> "$OUT/crashes.txt"
      return
    }
  fi
  shot "$theme-00-home"
  local i=1
  for page in "${PAGES[@]}"; do
    local name
    name="$(printf '%s-%02d-%s' "$theme" "$i" "$(echo "$page" | tr '/:?' '---')")"
    xcrun simctl openurl "$UDID" "dehub://$page" >/dev/null 2>&1 || echo "openurl failed: $page" >> "$OUT/crashes.txt"
    confirm_open
    sleep 6
    shot "$name"
    if [ "$page" = arcade/splurge ] && ! check_splurge "$name"; then
      echo "$theme: Splurge guest turn or mode switch failed (see logs/splurge.txt)" >> "$OUT/crashes.txt"
    fi
    echo "$(date +%H:%M:%S) $name"
    if ! running; then
      echo "$theme: app not running after opening $page" >> "$OUT/crashes.txt"
      launch
      sleep 20
    fi
    i=$((i + 1))
  done
}

# App Store screenshots (device ipad13): only the pages the store listing
# shows, under a clean status bar (9:41, full battery and signal).
STORE_PAGES=(
  "app"
  "explore"
  "shorts"
  "app/post/742"
  "app/post/5799"
  "maldoteth"
  "app/leaderboard"
  "creators"
  "music"
  "tv"
  "arcade"
  "app/agents"
  "app/features"
  "live-studio"
)
if [ "${DEVICE:-iphone}" = "ipad13" ]; then
  PAGES=("${STORE_PAGES[@]}")
  xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 \
    || echo "could not set the clean status bar" >> "$OUT/crashes.txt"
fi

if [ "${DEVICE:-iphone}" = "duo" ]; then
  unfold_duo || echo "could not open the folded Duo (see logs/device-menu.txt)" >> "$OUT/crashes.txt"
fi

# A focused recheck uses the same release build and all three appearances.
splurge_only=0
if [ "${THEMES:-}" = splurge ]; then
  splurge_only=1
  PAGES=("arcade/splurge")
  THEMES="dark light syslight"
fi

# THEMES picks which walks run (default all three): dark and light are the
# phone's setting under the app's System theme; syslight is the app's own
# System Light pick.
for t in ${THEMES:-dark light syslight}; do
  case "$t" in
    dark) walk dark system dark ;;
    light) walk light system light ;;
    syslight) walk light system-light syslight ;;
    # Any other name is an app theme (Settings > Appearance), e.g. hazy.
    *) walk dark "$t" "$t" ;;
  esac
done

if [ "${DEVICE:-iphone}" = "ipad" ] || [ "${DEVICE:-iphone}" = "duo" ]; then
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
if [ "$splurge_only" = 1 ] && [ -s "$OUT/crashes.txt" ]; then
  exit 1
fi
