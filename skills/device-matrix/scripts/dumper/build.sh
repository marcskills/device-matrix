#!/usr/bin/env bash
# Builds dumper.jar (Dump.java, see there why) into $DEVICE_MATRIX_HOME/build. Needs the SDK from setup.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../env.sh"
platform=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)
tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
javac -nowarn -source 8 -target 8 -cp "$platform/android.jar:$platform/uiautomator.jar:$platform/optional/android.test.base.jar" \
  -d "$work" "$here/Dump.java" 2>&1 | grep -v '^warning\|^Note\|^1 warning' || true
mkdir -p "$DEVICE_MATRIX_HOME/build"
# The device's old uiautomator runner lacks android.test.* classes, so they travel in the jar.
"$tools/d8" --min-api 24 --output "$DEVICE_MATRIX_HOME/build/dumper.jar" --lib "$platform/android.jar" \
  --classpath "$platform/uiautomator.jar" "$work"/*.class "$platform/optional/android.test.base.jar" 2>&1 | grep -v '^Warning' || true
test -s "$DEVICE_MATRIX_HOME/build/dumper.jar"
echo "$DEVICE_MATRIX_HOME/build/dumper.jar"
