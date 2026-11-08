#!/usr/bin/env bash
# Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
# Builds the Expo app two folders up (<app>/scripts/device-matrix/../..) as a release APK (x86_64 only, signed with the debug key),
# for the device matrix. Release, so the layout runs without the development overlays. Unlike a store build:
#   - the API is EXPO_PUBLIC_API_URL (the local QA API through `adb reverse`), never the live one;
#   - plain http is allowed (that QA API has no TLS);
#   - expo-updates is off, so the build never swaps in a published OTA;
#   - product analytics stay off (the analytics key is set empty here);
#   - the version is 1.0.0 (1), as the version code comes from EAS for store builds.
# The run also turns the emulator's network off, so the app can reach nothing but the QA API.
# Usage: build.sh [out.apk]   (default: $DEVICE_MATRIX_HOME/build/app.apk)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/env.sh"
expo=$(cd "$here/../.." && pwd)
out=${1:-$DEVICE_MATRIX_HOME/build/app.apk}
mkdir -p "$(dirname "$out")"

# ADAPT: this file builds an Expo app. For a native app, run `./gradlew assembleRelease` with the same overrides:
# test API address, plain http allowed, over-the-air updates off, analytics key empty, x86_64 only.
cd "$expo"
[ -d node_modules ] || npm ci --no-audit --no-fund
# Whether the app's sources differ from the commit, read before prebuild: prebuild edits app.json and package.json.
dirty=$([ -z "$(git status --porcelain -- . ':!scripts/device-matrix' ':!android')" ] && echo no || echo yes)
# --clean: prebuild output must follow app.json and the plugins, not an older android/ folder (it is gitignored).
CI=1 npx expo prebuild --platform android --clean --no-install

manifest=android/app/src/main/AndroidManifest.xml
# Only where the app uses expo-updates: without it the manifest has no such entry.
if grep -q 'expo.modules.updates' "$manifest"; then
  sed -i 's|android:name="expo.modules.updates.ENABLED" android:value="true"|android:name="expo.modules.updates.ENABLED" android:value="false"|' "$manifest"
  grep -q 'expo.modules.updates.ENABLED" android:value="false"' "$manifest" || { echo "could not turn expo-updates off in $manifest" >&2; exit 1; }
fi
mkdir -p android/app/src/release
# Gradle's temp files outside /tmp too (see env.sh for why not JAVA_TOOL_OPTIONS).
sed -i "s|^org.gradle.jvmargs=.*|& -Djava.io.tmpdir=$TMPDIR|" android/gradle.properties
cp android/app/src/debug/AndroidManifest.xml android/app/src/release/AndroidManifest.xml

# ADAPT: the build-time variables your app reads for its API address and analytics key.
export EXPO_PUBLIC_API_URL="http://127.0.0.1:$DEVICE_MATRIX_API_PORT"
export EXPO_PUBLIC_POSTHOG_KEY=
(cd android && ./gradlew --quiet assembleRelease -PreactNativeArchitectures=x86_64)
cp android/app/build/outputs/apk/release/app-release.apk "$out"
# What was built, for the run's summary.
{
  echo "commit=$(git rev-parse HEAD)"
  # The app's sources only: this tooling folder does not change the APK.
  echo "dirty=$dirty"
  echo "built=$(date -u +%FT%TZ)"
  echo "api=$EXPO_PUBLIC_API_URL"
} > "$out.txt"
echo "$out"
