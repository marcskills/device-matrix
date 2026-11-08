# Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
# Shared paths for the device-matrix scripts; sourced, not run. Everything lives in user space.
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=${JAVA_HOME:-$HOME/Android/jdk-17}
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
# Builds, the QA database and runs; outside the repository.
# ADAPT: where builds, the test database and runs go (outside the repository).
export DEVICE_MATRIX_HOME=${DEVICE_MATRIX_HOME:-$HOME/device-matrix}
export DEVICE_MATRIX_IMAGE=${DEVICE_MATRIX_IMAGE:-system-images;android-36;google_apis;x86_64}
export DEVICE_MATRIX_AVD=${DEVICE_MATRIX_AVD:-device-matrix}  # ADAPT: any AVD name
# The local QA API the APK calls (through `adb reverse`, so 127.0.0.1 on the phone is the host).
# backend/scripts/launch-qa-server.ts always listens on 3008.
export DEVICE_MATRIX_API_PORT=3008  # ADAPT: the port your test API listens on
# The test database's port (qa.mjs), checked free by run.sh. ADAPT: set DEVICE_MATRIX_NO_BACKEND=1 for an app with
# no backend: setup.sh then skips the database and run.sh skips both port checks.
export DEVICE_MATRIX_PG_PORT=${DEVICE_MATRIX_PG_PORT:-55442}
export DEVICE_MATRIX_NO_BACKEND=${DEVICE_MATRIX_NO_BACKEND:-0}
# Temporary files outside /tmp: where /tmp is a RAM-backed tmpfs,
# the emulators' disk overlays (~1.2 GB each) and the Gradle and Metro build files would fill it.
export DEVICE_MATRIX_TMP=$DEVICE_MATRIX_HOME/tmp
export ANDROID_TMP=$DEVICE_MATRIX_TMP/android
export TMPDIR=$DEVICE_MATRIX_TMP/other
# Not JAVA_TOOL_OPTIONS: the JVM then prints "Picked up JAVA_TOOL_OPTIONS" on stderr, and the Android Gradle
# plugin's prefab step fails on it (CXX1210 "No compatible library found", e.g. react-native-reanimated).
# build.sh gives Gradle the temp dir through org.gradle.jvmargs.
mkdir -p "$ANDROID_TMP" "$TMPDIR"
