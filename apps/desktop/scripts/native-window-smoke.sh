#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

# Run through dbus-run-session + xvfb-run on a Linux build machine.
set -euo pipefail
package_path=$1
result_dir=$2
mkdir -p "$result_dir"
smoke_root=$(mktemp -d /tmp/dbrainx-native-window-XXXXXX)
cleanup() {
  if [[ -n "${app_pid:-}" ]]; then kill -TERM "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  rm -rf "$smoke_root"
}
trap cleanup EXIT

mkdir -p "$smoke_root/package"
case "$package_path" in
  *.deb) dpkg-deb -x "$package_path" "$smoke_root/package" ;;
  *.rpm)
    rpm -K "$package_path"
    (cd "$smoke_root/package"
      set +e
      rpm2cpio "$package_path" | cpio -id --quiet
      extraction_status=("${PIPESTATUS[@]}")
      # Ubuntu's rpm2cpio can return 1 after emitting the complete valid archive.
      [[ "${extraction_status[1]}" == 0 ]]
    ) ;;

  *.AppImage) (cd "$smoke_root" && "$package_path" --appimage-extract > /dev/null); rmdir "$smoke_root/package"; mv "$smoke_root/squashfs-root" "$smoke_root/package" ;;
  *) printf 'Unsupported package format\n' >&2; exit 1 ;;
esac
export XDG_DATA_HOME="$smoke_root/data"
export XDG_CONFIG_HOME="$smoke_root/config"
export XDG_CACHE_HOME="$smoke_root/cache"
export XDG_RUNTIME_DIR="$smoke_root/run"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export GDK_BACKEND=x11
export LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
app_executable=$(find "$smoke_root/package/usr/bin" -maxdepth 1 -type f -print -quit)
[[ -n "$app_executable" ]]
if [[ "$package_path" == *.AppImage ]]; then app_executable="$smoke_root/package/AppRun"; fi
"$app_executable" > "$result_dir/native-window.log" 2>&1 &
app_pid=$!
for attempt in $(seq 1 40); do
  kill -0 "$app_pid"
  if [[ -f "$XDG_DATA_HOME/cn.dbrainx.desktop/runtime.lock" ]] && compgen -G "$XDG_DATA_HOME/cn.dbrainx.desktop/backend-ready-*.json" > /dev/null; then
    break
  fi
  sleep 1
done
compgen -G "$XDG_DATA_HOME/cn.dbrainx.desktop/backend-ready-*.json" > /dev/null
# Give the authenticated workspace shell time to render from the actual backend.
sleep 8
ready_descriptor=$(find "$XDG_DATA_HOME/cn.dbrainx.desktop" -maxdepth 1 -name 'backend-ready-*.json' -print -quit)
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
runtime_node=$(find "$smoke_root/package/usr/lib" -path '*/runtime/node' -type f -print -quit)
LD_LIBRARY_PATH="$(dirname "$runtime_node")/lib" "$runtime_node" "$script_dir/seed-native-smoke.mjs" "$ready_descriptor"
sleep 4
import -window root "$result_dir/native-window.png"
cp "$XDG_DATA_HOME/cn.dbrainx.desktop/backend.log" "$result_dir/native-backend.log"
# Closing the parent must close the Node control pipe and reap PocketBase.
kill -TERM "$app_pid"
wait "$app_pid" || true
unset app_pid
for attempt in $(seq 1 50); do
  [[ ! -f "$XDG_DATA_HOME/cn.dbrainx.desktop/runtime.lock" ]] && break
  sleep 0.1
done
[[ ! -f "$XDG_DATA_HOME/cn.dbrainx.desktop/runtime.lock" ]]
printf 'PASS packaged native window, frontend/native bridge, live backend events and parent-exit cleanup\n'
