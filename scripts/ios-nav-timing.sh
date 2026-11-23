#!/usr/bin/env bash
# Times page switches (tabs, profiles, posts, Settings, Back) on a booted
# iPhone simulator, with main's app code and with this checkout's, inside the
# same native build. Used by ios-simulator-check.yml (task "nav").
#
#   scripts/ios-nav-timing.sh <simulator udid> <path to .app> <output dir>
#
# The app's JavaScript is bundled twice, once from BEFORE_REF's sources and
# once from this checkout's, each time with scripts/ios-nav/tour.ts added to
# the entry file. Each bundle is swapped into the built app in turn and the
# tour walks the same pages, noting how long the screen could not update after
# every switch. Runs alternate (before, after, before, after) so a slow moment
# on the runner does not land on one side only. Each tour ends with a swipe
# back from the left edge, made here with idb when it is installed.
#
# It compares app code only. Both bundles run on this checkout's node_modules;
# a patch this checkout adds under patches/ is taken off for the "before"
# bundle and put back afterwards.
set -uo pipefail

UDID="$1"
APP="$2"
OUT="$3"
BEFORE_REF="${BEFORE_REF:-main}"
ROUNDS="${ROUNDS:-2}"
THEME="${NAV_THEME:-system}"
# "probe" looks for where a switch spends its time instead of timing it.
MODE="${NAV_MODE:-nav}"
WORK="${RUNNER_TEMP:-/tmp}/ios-nav"
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
EXE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Info.plist")"
HERMESC="$PWD/node_modules/hermes-compiler/hermesc/osx-bin/hermesc"
[ -x "$HERMESC" ] || HERMESC="$PWD/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"

mkdir -p "$OUT/nav" "$OUT/pages" "$OUT/logs" "$WORK"

# --- bundles -----------------------------------------------------------------

bundle() {
  local label="$1" dir="$WORK/$1"
  rm -rf "$dir" && mkdir -p "$dir/app"
  cp index.ts "$WORK/index.ts.orig"
  printf '\nimport "./scripts/ios-nav/tour";\n' >> index.ts
  local entry
  entry="$(node -e "require('expo/scripts/resolveAppEntry')" "$PWD" ios absolute | tail -n 1)"
  cat > "$WORK/bundle.sh" <<SH
set -euo pipefail
npx expo export:embed --platform ios --dev false --minify ${MINIFY:-true} --entry-file "$entry" \
  --bundle-output "$dir/main.js" --assets-dest "$dir/app"
SH
  # The app's config is inlined from the EAS production environment, as in the build.
  eas env:exec production "bash $WORK/bundle.sh" > "$OUT/logs/bundle-$label.log" 2>&1
  local status=$?
  cp "$WORK/index.ts.orig" index.ts
  if [ "$status" != 0 ] || [ ! -s "$dir/main.js" ]; then
    echo "Bundling $label failed"; tail -40 "$OUT/logs/bundle-$label.log"; return 1
  fi
  "$HERMESC" -emit-binary -O -out "$dir/app/main.jsbundle" "$dir/main.js" 2>> "$OUT/logs/bundle-$label.log" || {
    echo "hermesc failed for $label"; tail -20 "$OUT/logs/bundle-$label.log"; return 1; }
  echo "Bundled $label: $(du -h "$dir/app/main.jsbundle" | cut -f1)"
}

# node_modules as this checkout wants it, whatever was installed earlier.
npx patch-package --error-on-fail > "$OUT/logs/patch-package.log" 2>&1 || { cat "$OUT/logs/patch-package.log"; exit 1; }
git fetch --quiet --depth=1 origin "$BEFORE_REF:refs/remotes/origin/nav-before" || { echo "Cannot fetch $BEFORE_REF"; exit 1; }
HEAD_SHA="$(git rev-parse HEAD)"
BEFORE_SHA="$(git rev-parse refs/remotes/origin/nav-before)"
NEW_PATCHES="$(git diff --name-only --diff-filter=A "$BEFORE_SHA" "$HEAD_SHA" -- patches | grep '\.patch$' || true)"
echo "before = $BEFORE_REF ($BEFORE_SHA), after = $HEAD_SHA"
echo "Patches only in this checkout: ${NEW_PATCHES:-none}"

if [ "$MODE" = probe ]; then
  # One bundle, of this checkout, with its function names kept.
  MINIFY=false bundle after || exit 1
elif [ "$MODE" = touch ] || [ "$MODE" = keys ] || [ "$MODE" = player ] || [ "$MODE" = menu ] || [ "$MODE" = shells ] || [ "$MODE" = bones ] || [ "$MODE" = feedline ] || [ "$MODE" = moments ]; then
  bundle after || exit 1
else
  for p in $NEW_PATCHES; do patch -R -p1 -s --no-backup-if-mismatch < "$p" || { echo "Cannot take $p off"; exit 1; }; done
  git checkout --quiet "$BEFORE_SHA" -- . ':(exclude).github' ':(exclude)scripts' || exit 1
  bundle before; BEFORE_OK=$?
  git reset --quiet --hard "$HEAD_SHA"
  for p in $NEW_PATCHES; do patch -p1 -s --no-backup-if-mismatch < "$p" || { echo "Cannot put $p back"; exit 1; }; done
  [ "$BEFORE_OK" = 0 ] || exit 1
  bundle after || exit 1
fi

# --- runs --------------------------------------------------------------------

xcrun simctl spawn "$UDID" log stream --style compact --level info \
  --predicate "process == \"$EXE\"" > "$OUT/logs/app.log" 2>&1 &
LOG_PID=$!
trap 'kill "$LOG_PID" 2>/dev/null' EXIT

storage_dir() {
  local data
  data="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)"
  echo "$data/Library/Application Support/$BUNDLE/RCTAsyncLocalStorage_V1"
}

# storage set <key> <value> ... | storage get <key> | storage drop <key>
storage() {
  python3 - "$(storage_dir)" "$@" <<'PY'
import hashlib, json, os, sys
directory, op, args = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(directory, exist_ok=True)
path = os.path.join(directory, "manifest.json")
manifest = {}
if os.path.exists(path):
    try:
        manifest = json.load(open(path))
    except Exception:
        manifest = {}
# Values too long for the manifest live in a file named after the key's md5.
blob = lambda key: os.path.join(directory, hashlib.md5(key.encode()).hexdigest())
if op == "set":
    for key, value in zip(args[0::2], args[1::2]):
        manifest[key] = value
    json.dump(manifest, open(path, "w"))
elif op == "drop":
    for key in args:
        manifest.pop(key, None)
        if os.path.exists(blob(key)):
            os.remove(blob(key))
    json.dump(manifest, open(path, "w"))
elif op == "get":
    key = args[0]
    value = manifest.get(key)
    if value is None and os.path.exists(blob(key)):
        value = open(blob(key)).read()
    sys.stdout.write(value or "")
PY
}

use_bundle() {
  cp -R "$WORK/$1/app/." "$APP/"
  codesign --force --sign - --preserve-metadata=entitlements "$APP" >/dev/null 2>&1 || true
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl install "$UDID" "$APP"
}

# Watches what the tour asks for until the stop file appears: a screenshot
# whenever it names a new picture, and a sample of every thread of the app
# (where each one is spending its time) whenever it names a new sampling.
#   shots <prefix> <stop file>
shots() {
  python3 - "$(storage_dir)/manifest.json" "$UDID" "$OUT" "$1" "$2" "$EXE" <<'PY'
import json, os, re, subprocess, sys, time
manifest, udid, out, prefix, stop, exe = sys.argv[1:7]
os.makedirs(f"{out}/pages", exist_ok=True)
last = sampled = None
safe = lambda name: re.sub(r"[^A-Za-z0-9_-]", "_", name)
while not os.path.exists(stop):
    try:
        keys = json.load(open(manifest))
    except Exception:
        keys = {}
    name = keys.get("dehub.perfTour.shot")
    if name and name != last:
        last = name
        subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", "--type=jpeg", f"{out}/pages/{prefix}-{safe(name)}.jpg"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    name = keys.get("dehub.perfTour.sample")
    if name and name != sampled:
        sampled = name
        pid = subprocess.run(["pgrep", "-n", "-x", exe], capture_output=True, text=True).stdout.strip()
        if pid:
            subprocess.Popen(["sudo", "-n", "sample", pid, "12", "1", "-file", f"{out}/nav/{prefix}-sample-{safe(name)}.txt"],
                             stdout=open(f"{out}/logs/sample-{safe(name)}.log", "w"), stderr=subprocess.STDOUT)
        else:
            open(f"{out}/logs/sample-{safe(name)}.log", "w").write(f"no process named {exe}\n")
    time.sleep(0.12)
PY
}

# run <before|after> <name> [record] [tour: 1 = main switches, pages = every page] [theme]
run() {
  local variant="$1" name="$2" record="${3:-}" tour="${4:-1}" theme="${5:-$THEME}"
  local recorder="" started=0 touched="" touch="" tries=180
  use_bundle "$variant"
  storage drop dehub.perfTour.result dehub.perfTour.swipe dehub.perfTour.shot dehub.perfTour.sample
  storage set dehub.theme "$theme" dehub.perfTour "$tour"
  [ "$tour" = shorts ] && [ -n "${SHORTS_SWIPES:-}" ] && storage set dehub.perfTour.swipes "$SHORTS_SWIPES"
  [ "$tour" = login ] && storage set dehub.perfTour.key "$LOGIN"
  # A real account on a public run: its personal pages are not pictured
  # (tour.ts) and nothing is filmed.
  if [ "$PRIVATE_RUN" = 1 ]; then storage set dehub.perfTour.private 1; record=""; fi
  if [ "$tour" != 1 ]; then
    tries=480
    # A long Shorts scroll: about 6 s a swipe, plus the setup.
    [ "$tour" = shorts ] && [ "${SHORTS_SWIPES:-0}" -gt 40 ] && tries=$((240 + SHORTS_SWIPES * 4))
    [ "$tour" = login ] && tries=45
    rm -f "$WORK/shots.stop"
    shots "$name" "$WORK/shots.stop" &
  fi
  if [ -n "$record" ]; then
    xcrun simctl io "$UDID" recordVideo --codec hevc --force "$OUT/nav/$name.mov" 2> "$WORK/record.log" &
    recorder=$!
    for _ in $(seq 1 50); do grep -q "Recording started" "$WORK/record.log" && break; sleep 0.1; done
    python3 -c 'import time; print(int(time.time()*1000))' > "$OUT/nav/$name.video-start"
  fi
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
  local result=""
  # Shorts asks for a swipe every few seconds: look often enough to act on
  # each one before the next replaces it.
  local poll=2
  if [ "$tour" = shorts ]; then poll=0.5; tries=$((tries * 4)); fi
  for _ in $(seq 1 "$tries"); do
    sleep "$poll"
    # The tour asks for real touches, which only idb can make: a slow swipe
    # in from the left edge ("ready", "swipe:<label>"), a tap
    # ("tap:<label>:<x>:<y>") or a tap on a button found by its text
    # ("find:<label>:<text>"). Each request is acted on once.
    touch="$(storage get dehub.perfTour.swipe)"
    if [ -n "$touch" ] && [ "$touch" != "$touched" ]; then
      touched="$touch"
      if command -v idb >/dev/null 2>&1; then
        case "$touch" in
          vswipe:*)
            # Shorts: a quick upward flick in the middle of the screen; the
            # moment it was sent is what the next short's start is timed from.
            python3 -c 'import time; print(int(time.time()*1000))' >> "$OUT/nav/$name.swipes"
            # The app's resident memory (KB) at each swipe: a long scroll that
            # piles players up shows as a climb.
            ps -axo rss=,command= | grep -m1 "Containers/Bundle/Application/.*\.app/" | awk '{print $1}' >> "$OUT/nav/$name.rss" || true
            # Long and fast: a 380 pt flick over 0.25 s dragged the page and
            # let it snap back, so no short was ever turned to.
            idb ui swipe --udid "$UDID" --duration 0.12 196 760 196 180 >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
          vpair:*)
            # Shorts: the same flick, then two seconds later one that starts
            # on the timeline row, a finger above the player's buttons.
            python3 -c 'import time; print(int(time.time()*1000))' >> "$OUT/nav/$name.swipes"
            idb ui swipe --udid "$UDID" --duration 0.12 196 760 196 180 >/dev/null 2>&1 || echo "$name: idb swipe failed"
            sleep 2
            python3 -c 'import time; print(int(time.time()*1000))' >> "$OUT/nav/$name.lowswipes"
            idb ui swipe --udid "$UDID" --duration 0.12 196 796 196 220 >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
          vback:*)
            # Shorts: a quick downward flick, back to the short before.
            idb ui swipe --udid "$UDID" --duration 0.12 196 180 196 760 >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
          tap:*)
            IFS=: read -r _ _ tap_x tap_y <<< "$touch"
            idb ui tap --udid "$UDID" "$tap_x" "$tap_y" >/dev/null 2>&1 || echo "$name: idb tap failed" ;;
          type:*)
            # "type:<label>:<text>": typed into whatever has the cursor.
            IFS=: read -r _ _ type_text <<< "$touch"
            idb ui text --udid "$UDID" "$type_text" >/dev/null 2>&1 || echo "$name: idb text failed" ;;
          scrub:*)
            # "scrub:<label>:<y>": a finger drawn slowly along the player's
            # scrubber, slow enough for the tour to picture it half way.
            IFS=: read -r _ _ scrub_y <<< "$touch"
            idb ui swipe --udid "$UDID" --duration 6 70 "$scrub_y" 310 "$scrub_y" >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
          hswipe:*)
            # "hswipe:<label>": a finger dragged right to left across the middle
            # of the screen, slow enough to picture half way (<name>-hswipe-mid).
            idb ui swipe --udid "$UDID" --duration 1.5 330 300 70 300 >/dev/null 2>&1 &
            hswipe_pid=$!
            sleep 0.8
            mkdir -p "$OUT/pages"
            xcrun simctl io "$UDID" screenshot --type=jpeg "$OUT/pages/$name-hswipe-mid.jpg" >/dev/null 2>&1 \
              || idb screenshot --udid "$UDID" "$OUT/pages/$name-hswipe-mid.png" >/dev/null 2>&1 \
              || echo "$name: mid-swipe picture failed"
            wait "$hswipe_pid" || echo "$name: idb swipe failed" ;;
          drag:*)
            # A finger pulling the page down, above where a keyboard sits.
            idb ui swipe --udid "$UDID" --duration 0.5 200 250 200 400 >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
          flick:*)
            # "flick:<label>:<text>:<dy>": a finger drawn up (dy < 0) or
            # down from the middle of whatever has that label.
            IFS=: read -r _ flick_name flick_text flick_dy <<< "$touch"
            idb ui describe-all --udid "$UDID" > "$WORK/ax.json" 2>/dev/null || echo "[]" > "$WORK/ax.json"
            read -r fx fy <<< "$(python3 scripts/ios-nav/ax-find.py "$WORK/ax.json" "$flick_text" "$OUT/nav/$name-finds.txt" "$flick_name")"
            if [ -n "$fx" ]; then
              idb ui swipe --udid "$UDID" --duration 0.35 "$fx" "$fy" "$fx" "$((fy + flick_dy))" >/dev/null 2>&1 || echo "$name: idb swipe failed"
            fi ;;
          find:*)
            # "find:<label>:<button text>": tap the button with that text,
            # wherever it is drawn; nothing is tapped when it is not up.
            IFS=: read -r _ find_name find_text <<< "$touch"
            # The first read after launch can come back empty, so look again
            # a few times before calling the button missing.
            tap_x=""
            for _ in 1 2 3 4; do
              idb ui describe-all --udid "$UDID" > "$WORK/ax.json" 2>/dev/null || echo "[]" > "$WORK/ax.json"
              read -r tap_x tap_y <<< "$(python3 scripts/ios-nav/ax-find.py "$WORK/ax.json" "$find_text" "$OUT/nav/$name-finds.txt" "$find_name")"
              [ -n "$tap_x" ] && break
              sleep 1.5
            done
            if [ -n "$tap_x" ]; then
              idb ui tap --udid "$UDID" "$tap_x" "$tap_y" >/dev/null 2>&1 || echo "$name: idb tap failed"
            fi ;;
          *)
            python3 -c 'import time; print(int(time.time()*1000))' > "$OUT/nav/$name.swipe-start"
            idb ui swipe --udid "$UDID" --duration 1.2 1 430 330 430 >/dev/null 2>&1 || echo "$name: idb swipe failed" ;;
        esac
      fi
    fi
    result="$(storage get dehub.perfTour.result)"
    case "$result" in '{"done":true'*) started=1; break ;; esac
  done
  touch "$WORK/shots.stop"
  xcrun simctl io "$UDID" screenshot "$OUT/nav/$name-end.png" >/dev/null 2>&1 || true
  if [ -n "$recorder" ]; then kill -INT "$recorder" 2>/dev/null; wait "$recorder" 2>/dev/null; fi
  printf '%s' "$result" > "$OUT/nav/$name.json"
  [ "$started" = 1 ] && echo "$name: finished" || echo "$name: did not finish"
}

xcrun simctl ui "$UDID" appearance dark
for service in photos camera microphone location; do
  xcrun simctl privacy "$UDID" grant "$service" "$BUNDLE" >/dev/null 2>&1 || true
done

# With a test account, sign the simulator in first: the session stays for
# every run after it, and the tours then cover the pages only an account has.
# The account is the repository secret SIM_TEST_KEY (recovery words or a key),
# or, when asked for with SIM_REVIEW_LOGIN=1, the sign-in Apple's reviewers
# use, read from App Store Connect here and never printed.
LOGIN="${SIM_TEST_KEY:-}"
PRIVATE_RUN=0
if [ -z "$LOGIN" ] && [ "${SIM_REVIEW_LOGIN:-0}" = 1 ]; then
  LOGIN="$(node scripts/ios-nav/review-login.mjs 2> "$OUT/logs/review-login.txt")" || LOGIN=""
  [ -n "$LOGIN" ] && PRIVATE_RUN=1 || echo "The review sign-in could not be read: $(cut -c1-200 "$OUT/logs/review-login.txt" | head -3)"
fi
if [ -n "$LOGIN" ]; then
  run after login "" login
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("Signed in:", d.get("login") or d.get("error") or "no")' "$OUT/nav/login.json" 2>/dev/null || echo "Sign-in did not finish"
fi

# Before anything is uploaded: the sign-in itself, and any session token the
# app logged, are taken out of every text file this run wrote.
scrub() {
  LOGIN="$LOGIN" python3 - "$OUT" <<'PY'
import json, os, re, sys
secrets = set()
raw = os.environ.get("LOGIN", "")
if raw:
    secrets.add(raw)
    try:
        for value in json.loads(raw).values():
            value = str(value)
            secrets.add(value)
            digits = re.sub(r"\D", "", value)
            if len(digits) >= 6:
                secrets.add(digits)
    except Exception:
        pass
token = re.compile(rb"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
for folder, _, files in os.walk(sys.argv[1]):
    for name in files:
        if not name.endswith((".txt", ".log", ".json", ".md", ".ips")):
            continue
        path = os.path.join(folder, name)
        try:
            data = open(path, "rb").read()
        except Exception:
            continue
        clean = token.sub(b"[token]", data)
        for secret in sorted(secrets, key=len, reverse=True):
            if secret:
                clean = clean.replace(secret.encode(), b"[removed]")
        if clean != data:
            open(path, "wb").write(clean)
PY
}
trap scrub EXIT

if [ "$MODE" = keys ]; then
  # The on-screen keyboard has to stay up while idb types like a real one.
  xcrun simctl spawn "$UDID" defaults write com.apple.Preferences AutomaticMinimizationEnabled -bool NO >/dev/null 2>&1 || true
  # Software keys on a tap, as on a phone (a connected Mac keyboard hides them).
  defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false >/dev/null 2>&1 || true
  xcrun simctl spawn "$UDID" defaults write com.apple.Preferences HardwareKeyboardLastSeen -bool NO >/dev/null 2>&1 || true
  for theme in ${KEYS_THEMES:-system hazy system-light osaka}; do
    run after "keys-$theme" "" keys "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  cat "$OUT/logs/tour.txt"
  exit 0
fi

if [ "$MODE" = touch ]; then
  run after touch "" touch
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  python3 -c 'import json,sys; [print(c) for c in json.load(open(sys.argv[1])).get("touch", [])]' "$OUT/nav/touch.json" 2>/dev/null || true
  exit 0
fi

if [ "$MODE" = bones ]; then
  # Every page's measured layout (what its loading placeholder is drawn from).
  storage drop dehub.perfTour.bones
  run after bones "" bones
  storage get dehub.perfTour.bones > "$OUT/nav/screen-bones.json"
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  echo "Measured $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$OUT/nav/screen-bones.json" 2>/dev/null || echo 0) pages"
  exit 0
fi

if [ "$MODE" = shells ]; then
  # Every page's loading shell and the page itself, in each theme asked for.
  for theme in ${SHELL_THEMES:-system}; do
    run after "shells-$theme" "" shells "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = wallet ]; then
  # Connect Wallet on the sign-in page opened from "Log in": main's code
  # first, then this checkout's in several themes.
  run before "wallet-main-system" "" wallet system
  for theme in ${WALLET_THEMES:-system osaka}; do
    run after "wallet-$theme" "" wallet "$theme"
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[2], {k: d.get(k) for k in ("route", "openByTap", "pickerOpen", "error")})' "$OUT/nav/wallet-$theme.json" "$theme" 2>/dev/null || true
  done
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("main", {k: d.get(k) for k in ("route", "openByTap", "pickerOpen", "error")})' "$OUT/nav/wallet-main-system.json" 2>/dev/null || true
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = menu ]; then
  # The phone menu in each layout, in several themes.
  for theme in ${WALLET_THEMES:-system hazy system-light}; do
    run after "menu-$theme" "" menu "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = reactions ]; then
  # Reactions landing live in public chat, filmed: Fly in (the default) on
  # three themes, then Burst once.
  for theme in ${WALLET_THEMES:-system hazy system-light}; do
    run after "reactions-fly-$theme" record reactions "$theme"
  done
  storage set dehub.perfTour.reactStyle burst
  run after "reactions-burst-system" record reactions system
  storage drop dehub.perfTour.reactStyle
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = rowreactions ]; then
  # Reactions waiting in the Messages list (bare moving emojis, no pill),
  # filmed: Fly in (the default) on three themes, then Burst and Off once.
  for theme in ${WALLET_THEMES:-system hazy system-light}; do
    run after "rowreactions-fly-$theme" record rowreactions "$theme"
  done
  storage set dehub.perfTour.reactStyle burst
  run after "rowreactions-burst-system" record rowreactions system
  storage set dehub.perfTour.reactStyle off
  run after "rowreactions-off-system" record rowreactions system
  storage drop dehub.perfTour.reactStyle
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = moments ]; then
  # Moments: the Glass Shelf, the viewer and the creator, per theme.
  for theme in ${FEED_THEMES:-system system-light hazy osaka}; do
    run after "moments-$theme" "" moments "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = feedline ]; then
  # Post separator: Home with bento cards and with the thin line, same posts.
  for theme in ${FEED_THEMES:-system system-light hazy osaka}; do
    run after "feedline-$theme" "" feedline "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = sharelink ]; then
  # A shared video link opened from Home: main's code, then this checkout's
  # on three themes.
  run before "sharelink-main-system" "" sharelink system
  for theme in ${SHARE_THEMES:-system hazy system-light}; do
    run after "sharelink-$theme" "" sharelink "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = livetheme ]; then
  # Leaving a live in System Light, main's code then this checkout's, both
  # filmed; then this checkout's on two dark themes.
  run before "livetheme-main-system-light" record livetheme system-light
  run after "livetheme-system-light" record livetheme system-light
  for theme in ${LIVE_THEMES:-system hazy}; do
    run after "livetheme-$theme" "" livetheme "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = loginsheet ]; then
  # The sign-in pop-ups (like, +, Log in page): main's code first, then this
  # checkout's in several themes.
  run before "loginsheet-main-system" "" loginsheet system
  for theme in ${WALLET_THEMES:-system osaka hazy}; do
    run after "loginsheet-$theme" "" loginsheet "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = player ]; then
  # Loop off by default, a short moving on when it ends, the Shorts menu's
  # player rows and the When? wheel, in several themes.
  for theme in ${PLAYER_THEMES:-system system-light osaka}; do
    run after "player-$theme" "" player "$theme"
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[2], {k: d.get(k) for k in ("signedIn", "loopOnStart", "opened", "firstPlayer", "afterEnd", "movedOn", "loopAfterTap", "loopAfterSecondTap", "uploadRoute", "error")})' "$OUT/nav/player-$theme.json" "$theme" 2>/dev/null || true
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-600 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = freeze ]; then
  # A short swiped away from and back to, and the app set aside and back:
  # main's code, then this checkout's, each filmed and pictured.
  for theme in ${FREEZE_THEMES:-system}; do
    run before "freeze-main-$theme" record freeze "$theme"
    run after "freeze-$theme" record freeze "$theme"
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]|poster lifted' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = wide ]; then
  # A wide clip in the swipe player, pictured once per theme.
  # main's code first on System Light, to tell what was already there.
  run before "wide-main-system-light" "" wide system-light
  for theme in ${WIDE_THEMES:-hazy osaka glass system system-light}; do
    run after "wide-$theme" "" wide "$theme"
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[2], {k: d.get(k) for k in ("opened", "fullscreen", "back", "error")})' "$OUT/nav/wide-$theme.json" "$theme" 2>/dev/null || true
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

if [ "$MODE" = speed ]; then
  # Chats, typing, search and the busiest switches: main's code and this
  # checkout's, alternating, after one unmeasured run that fills the caches.
  run before speed-warmup "" speed
  for round in $(seq 1 "$ROUNDS"); do
    run before "speed-before-$round" "" speed
    run after "speed-after-$round" "" speed
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-600 > "$OUT/logs/tour.txt" || true
  python3 scripts/ios-nav/speed-summary.py "$OUT/nav" | tee "$OUT/nav/summary.md"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/nav/summary.md" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

if [ "$MODE" = shorts ]; then
  # Shorts swipes, main's code and this checkout's, alternating. The first
  # round of each is filmed.
  for round in $(seq 1 "$ROUNDS"); do
    run before "shorts-before-$round" "$([ "$round" = 1 ] && echo record)" shorts
    run after "shorts-after-$round" "$([ "$round" = 1 ] && echo record)" shorts
  done
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  python3 scripts/ios-nav/shorts-summary.py "$OUT/nav" | tee "$OUT/nav/summary.md"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/nav/summary.md" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

if [ "$MODE" = probe ]; then
  run after probe record probe
  kill "$LOG_PID" 2>/dev/null
  grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true
  exit 0
fi

# One unmeasured run first: it fills the caches both sides then share.
run before warmup
for round in $(seq 1 "$ROUNDS"); do
  # Only the first round is filmed: the films are large.
  run before "before-$round" "$([ "$round" = 1 ] && echo record)"
  run after "after-$round" "$([ "$round" = 1 ] && echo record)"
done

# Every page, opened twice, with a picture of each: main's code, this
# checkout's, then this checkout's again in other themes.
if [ "${PAGES_TOUR:-1}" = 1 ]; then
  run before pages-before "" pages
  run after pages-after "" pages
  for theme in ${PAGE_THEMES:-system-light hazy}; do
    run after "pages-after-$theme" "" pages "$theme"
  done
fi

kill "$LOG_PID" 2>/dev/null
cp ~/Library/Logs/DiagnosticReports/"$EXE"*.ips "$OUT/logs/" 2>/dev/null || true
grep -E '\[perf-tour\]|\[FatalJS\]|\[UncaughtJS\]' "$OUT/logs/app.log" | cut -c1-400 > "$OUT/logs/tour.txt" || true

python3 scripts/ios-nav/summary.py "$OUT/nav" | tee "$OUT/nav/summary.md"
python3 scripts/ios-nav/summary.py "$OUT/nav" pages > "$OUT/nav/summary-pages.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/nav/summary.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
