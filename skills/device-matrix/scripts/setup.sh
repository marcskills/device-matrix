#!/usr/bin/env bash
# One-time setup for the device matrix, all in user space: a JDK, the Android command-line tools, the emulator,
# one system image, the matrix's AVD, and an embedded PostgreSQL for the QA API. Safe to run again.
# The only thing it cannot do itself is KVM access, which needs root once (it says so and stops).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/env.sh"

downloads=$DEVICE_MATRIX_HOME/downloads
mkdir -p "$downloads" "$ANDROID_HOME/cmdline-tools"

if ! [ -x "$JAVA_HOME/bin/java" ]; then
  jdk_url='https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz'
  jdk_sha=8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711
  curl -fsSLo "$downloads/jdk.tar.gz" "$jdk_url"
  echo "$jdk_sha  $downloads/jdk.tar.gz" | sha256sum -c -
  mkdir -p "$JAVA_HOME" && tar -xzf "$downloads/jdk.tar.gz" -C "$JAVA_HOME" --strip-components=1
fi

if ! [ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fsSLo "$downloads/cmdline-tools.zip" https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
  rm -rf "$downloads/cmdline-tools"
  # unzip may be missing; Python's zipfile drops the execute bits, so they are set again below.
  python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$downloads/cmdline-tools.zip" "$downloads"
  chmod +x "$downloads"/cmdline-tools/bin/*
  rm -rf "$ANDROID_HOME/cmdline-tools/latest" && mv "$downloads/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

yes | sdkmanager --licenses > /dev/null || true
# A platform and build tools for dumper/build.sh (the app's Gradle build fetches its own as well).
sdkmanager --install platform-tools emulator "$DEVICE_MATRIX_IMAGE" "platforms;android-36" "build-tools;36.0.0" > "$downloads/sdkmanager.log"

# One AVD, started read-only as many times as the run wants. Each setup sets its own size and density with `wm`
# (screenshots come out at that size, larger than the panel too). The panel is the commonest phone, and refreshes
# 20 times a second: the app always has something moving, rendered in software, so 60 would use three times
# the CPU (5 emulators fit on 24 cores) for no difference in a still picture. 6 GB, or Android swaps.
if ! avdmanager list avd -c | grep -qx "$DEVICE_MATRIX_AVD"; then
  # (avdmanager also prints a harmless error about the image's devices.xml.)
  echo no | avdmanager create avd -n "$DEVICE_MATRIX_AVD" -k "$DEVICE_MATRIX_IMAGE" -d pixel_9_pro_xl > /dev/null 2>&1
fi
config=$HOME/.android/avd/$DEVICE_MATRIX_AVD.avd/config.ini
set_config() { grep -q "^$1=" "$config" && sed -i "s|^$1=.*|$1=$2|" "$config" || echo "$1=$2" >> "$config"; }
set_config hw.lcd.width 1080
set_config hw.lcd.height 2400
set_config hw.lcd.density 440
set_config hw.lcd.vsync 20
set_config hw.ramSize 6144
set_config hw.keyboard yes
set_config disk.dataPartition.size 6G
set_config hw.gpu.enabled yes
set_config hw.gpu.mode swiftshader_indirect

# The QA API's database: embedded PostgreSQL from npm (no Docker or system Postgres here).
pg=$DEVICE_MATRIX_HOME/pg
if [ "$DEVICE_MATRIX_NO_BACKEND" != 1 ] && ! [ -d "$pg/node_modules/embedded-postgres" ]; then
  mkdir -p "$pg"
  (cd "$pg" && echo '{"name":"device-matrix-pg","private":true,"type":"module"}' > package.json \
    && npm install --no-audit --no-fund embedded-postgres@16.14.0-beta.17 > /dev/null)
  # npm blocks the package's install script, which links the binaries' libraries.
  (cd "$pg/node_modules/@embedded-postgres/linux-x64" && node scripts/hydrate-symlinks.js)
fi
# Last, so everything else is in place by the time it is granted.
in_kvm_group() { getent group kvm | cut -d: -f4 | tr , '\n' | grep -qx "$(id -un)"; }
if ! [ -w /dev/kvm ] && ! in_kvm_group; then
  cat >&2 <<EOF
The emulator needs /dev/kvm, and $(id -un) cannot open it. Once, as root:
  sudo usermod -aG kvm $(id -un)          # lasting; new logins get it
Then run this again. run.sh uses the group at once through \`sg kvm\`, without a new login.
EOF
  exit 1
fi

echo "ready: $ANDROID_HOME, AVD $DEVICE_MATRIX_AVD$([ "$DEVICE_MATRIX_NO_BACKEND" = 1 ] || echo ", $pg")"
