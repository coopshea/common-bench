#!/usr/bin/env bash
# Build and open Bench Glasses. `bash run.sh --build-only` builds without opening it.
# BENCH_URL (default http://127.0.0.1:8787) is where Common Bench's server answers on this Mac.
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/build/Bench Glasses.app"

# Mentra's Bluetooth SDK source: only the SDK folder of their repository, at the dev branch.
if [[ ! -d vendor/MentraOS/mobile/modules/bluetooth-sdk ]]; then
  mkdir -p vendor
  git clone --depth 1 --filter=blob:none --sparse --branch dev https://github.com/Mentra-Community/MentraOS.git vendor/MentraOS
  git -C vendor/MentraOS sparse-checkout set mobile/modules/bluetooth-sdk
fi

if pgrep -f "$app/Contents/MacOS/BenchGlasses" >/dev/null; then
  printf 'Quit Bench Glasses before rebuilding.\n' >&2
  exit 1
fi
swift build
bin_dir="$(swift build --show-bin-path)"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/BenchGlasses" "$app/Contents/MacOS/"
cp Info.plist "$app/Contents/Info.plist"
cp AppIcon.icns "$app/Contents/Resources/"
for bundle in "$bin_dir"/*.bundle; do
  if [[ -d "$bundle" ]]; then cp -R "$bundle" "$app/Contents/Resources/"; fi
done
# Where Common Bench is, and where it keeps the key that lets this app in (made when its server first starts).
printf '{"benchUrl":"%s","keyFile":"%s","logFile":"%s"}\n' "${BENCH_URL:-http://127.0.0.1:8787}" "$PWD/../app/recordings/.key" "$PWD/build/helper.log" > "$app/Contents/Resources/bench.json"
codesign --force --sign - "$app"
if [[ "${1:-}" != "--build-only" ]]; then open "$app"; fi
