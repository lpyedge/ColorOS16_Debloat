#!/system/bin/sh
# Save packages.txt updates coming from KernelSU WebUI
# Usage: save_packages.sh <base64_payload>

set -eu

SCRIPT_DIR="${0%/*}"
MODDIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# ensure webroot/data exists
mkdir -p "$MODDIR/webroot/data"
TMP_FILE="$MODDIR/webroot/data/packages.txt.tmp"
TARGET_FILE="$MODDIR/webroot/data/packages.txt"
WEBROOT_FILE="$MODDIR/webroot/data/packages.txt"

if [ $# -lt 1 ] || [ -z "$1" ]; then
    echo "Usage: $0 <base64_payload>" >&2
    exit 1
fi

PAYLOAD_B64="$1"

# 将 base64 数据解码到临时文件，确保写入原子性
printf '%s' "$PAYLOAD_B64" | base64 -d > "$TMP_FILE"

mv -f "$TMP_FILE" "$TARGET_FILE"
cp -f "$TARGET_FILE" "$WEBROOT_FILE"
chmod 0644 "$TARGET_FILE" "$WEBROOT_FILE"

exit 0
