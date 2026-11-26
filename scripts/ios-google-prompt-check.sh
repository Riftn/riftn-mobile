#!/usr/bin/env bash
set -euo pipefail

sim="$1"
app="$2"
out="$3"
plist="$app/Info.plist"
bundle="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist")"
mkdir -p "$out/shots" "$out/logs"

cat > "$RUNNER_TEMP/read-dialog.swift" <<'SWIFT'
import Foundation
import Vision

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
for line in request.results ?? [] {
    if let text = line.topCandidates(1).first?.string {
        print(text)
    }
}
SWIFT
swiftc "$RUNNER_TEMP/read-dialog.swift" -o "$RUNNER_TEMP/read-dialog"

tap_label() {
  local label="$1" x y point
  perl -e 'alarm shift; exec @ARGV' 15 idb ui describe-all --udid "$sim" > "$out/logs/ax.json" 2>/dev/null || return 1
  point="$(python3 scripts/ios-nav/ax-find.py "$out/logs/ax.json" "$label" "$out/logs/taps.txt" "$label")"
  [[ -n "$point" ]] || return 1
  read -r x y <<< "$point"
  idb ui tap --udid "$sim" "$x" "$y" >/dev/null
}

show_prompt() {
  local label="$1" appearance="$2" theme="$3" expected="$4" data dir i selected=0 shot
  echo "Opening the sign-in dialog in $label."
  xcrun simctl uninstall "$sim" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl ui "$sim" appearance "$appearance"
  xcrun simctl install "$sim" "$app"
  data="$(xcrun simctl get_app_container "$sim" "$bundle" data)"
  dir="$data/Library/Application Support/$bundle/RCTAsyncLocalStorage_V1"
  mkdir -p "$dir"
  printf '{"dehub.theme":"%s"}' "$theme" > "$dir/manifest.json"
  xcrun simctl launch "$sim" "$bundle"
  sleep 12
  xcrun simctl openurl "$sim" 'dehub://signin'
  for i in {1..12}; do
    if tap_label Google; then
      selected=1
      break
    fi
    tap_label Open || true
    sleep 2
  done
  if [[ "$selected" == 0 ]]; then
    xcrun simctl io "$sim" screenshot "$out/shots/$label-no-google.png"
    return 1
  fi
  echo "Tapped Google in $label."
  shot="$out/shots/$label.png"
  for i in {1..8}; do
    sleep 1
    xcrun simctl io "$sim" screenshot "$shot"
    "$RUNNER_TEMP/read-dialog" "$shot" > "$out/logs/$label.txt"
    if grep -iq "$expected.*wants to use" "$out/logs/$label.txt"; then
      grep -i "$expected.*wants to use" "$out/logs/$label.txt" | tee -a "$GITHUB_STEP_SUMMARY"
      return 0
    fi
  done
  echo "The permission dialog did not show $expected in $label."
  cat "$out/logs/$label.txt"
  return 1
}

baseline="$(/usr/libexec/PlistBuddy -c 'Print CFBundleName' "$plist")"
display="$(/usr/libexec/PlistBuddy -c 'Print CFBundleDisplayName' "$plist")"
fixed="$(/usr/libexec/PlistBuddy -c 'Print CFBundleName' ios/DeHub/Info.plist)"
printf 'Simulator bundle metadata before fix. Display name %s, bundle name %s.\n' "$display" "$baseline"
[[ "$display" == "$fixed" && "$baseline" == 'DeHub' ]]

# Try the proposed metadata in the same simulator binary for a direct comparison.
# This ad hoc signature is for the simulator only.
/usr/libexec/PlistBuddy -c "Set CFBundleName $fixed" "$plist"
codesign --force --sign - --preserve-metadata=entitlements,identifier "$app"
codesign --verify "$app"
echo "Installed bundle metadata to test. Bundle name $(/usr/libexec/PlistBuddy -c 'Print CFBundleName' "$plist")."
show_prompt system-dark dark system "$fixed"
show_prompt system-light light system-light "$fixed"
