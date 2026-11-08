#!/usr/bin/env bash
# Runs the device matrix (run.mjs) with the SDK on the path. Options go through: --setups a,b --screens x,y
# --emulators N --apk file --out dir. `--build` first rebuilds the APK from this checkout (build.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/env.sh"
# KVM: a shell started before `usermod -aG kvm` lacks the group until the next login, and /dev/kvm's per-user ACL
# does not last (udev resets it). `sg` gives the group now to a member listed in /etc/group.
if ! [ -w /dev/kvm ]; then
  if [ -z "${DEVICE_MATRIX_SG:-}" ] && getent group kvm | cut -d: -f4 | tr , '\n' | grep -qx "$(id -un)"; then
    export DEVICE_MATRIX_SG=1  # once: if the group is not enough either, stop below instead of looping
    exec sg kvm -c "$(printf '%q ' "$0" "$@")"
  fi
  echo "no access to /dev/kvm: see setup.sh" >&2
  exit 1
fi
args=()
for arg in "$@"; do
  if [ "$arg" = --build ]; then "$here/build.sh" > /dev/null; else args+=("$arg"); fi
done
[ -s "$DEVICE_MATRIX_HOME/build/dumper.jar" ] || "$here/dumper/build.sh" > /dev/null
# The QA API (3008) and its database (55442) belong to this run; something already there is a run left over.
for port in $([ "$DEVICE_MATRIX_NO_BACKEND" = 1 ] || echo "$DEVICE_MATRIX_API_PORT $DEVICE_MATRIX_PG_PORT"); do
  if ss -ltn | grep -q ":$port "; then
    echo "port $port is taken (a QA API or matrix database left running?); the matrix starts its own there" >&2
    exit 1
  fi
done
# A database folder a hard exit left (its port is free, so no run uses it).
rm -rf "$DEVICE_MATRIX_HOME"/pg/data-*
# Disk overlays left by emulators that were killed rather than closed, only while none of the matrix's emulators
# runs.
if ! pgrep -u "$(id -u)" -f "qemu-system.*-avd $DEVICE_MATRIX_AVD" > /dev/null; then rm -rf "${ANDROID_TMP:?}"/*; fi
exec node "$here/run.mjs" "${args[@]}"
