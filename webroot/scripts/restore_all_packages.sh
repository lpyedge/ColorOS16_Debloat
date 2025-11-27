#!/system/bin/sh
# Restore all packages from packages.txt by enabling each entry regardless of comment state

MODDIR="${0%/*}/../.."
PKGLIST="${1:-$MODDIR/webroot/data/packages.txt}"
BOM_CHAR=$(printf '\357\273\277')

log() {
    echo "[RESTORE] $*"
}

if [ ! -f "$PKGLIST" ]; then
    log "Package list not found: $PKGLIST"
    exit 0
fi

get_user_list() {
    local parsed users="0"
    if command -v cmd >/dev/null 2>&1; then
        parsed=$(cmd user list 2>/dev/null | awk -F'[][]' '/\[/ {print $2}' | tr ',' ' ')
        if [ -n "$parsed" ]; then
            users="$parsed"
        fi
    fi
    echo "$users"
}

parse_pkg_line() {
    local raw="$1" trimmed pkg
    [ -n "$raw" ] || return 1

    raw=$(printf '%s' "$raw" | tr -d '\r')
    if [ "${raw#"$BOM_CHAR"}" != "$raw" ]; then
        raw="${raw#"$BOM_CHAR"}"
    fi

    trimmed=$(printf '%s\n' "$raw" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$trimmed" ] || return 1

    while [ "${trimmed#\#}" != "$trimmed" ]; do
        trimmed="${trimmed#\#}"
        trimmed=$(printf '%s\n' "$trimmed" | sed 's/^[[:space:]]*//')
    done

    pkg="${trimmed%%#*}"
    pkg=$(printf '%s\n' "$pkg" | sed 's/[[:space:]]*$//')
    pkg=$(printf '%s\n' "$pkg" | awk '{print $1}')

    if printf '%s\n' "$pkg" | grep -Eq '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$'; then
        printf '%s\n' "$pkg"
        return 0
    fi
    return 1
}

USERS=$(get_user_list)
log "Users: $USERS"

seen="|"
count=0
enabled=0
skipped=0
failed=0

while IFS= read -r line || [ -n "$line" ]; do
    pkg=$(parse_pkg_line "$line") || continue
    case "$seen" in
        *"|$pkg|") continue ;;
    esac
    seen="${seen}${pkg}|"
    count=$((count + 1))
    for user in $USERS; do
        if pm enable --user "$user" "$pkg" >/dev/null 2>&1; then
            enabled=$((enabled + 1))
            log "Enabled $pkg for user $user"
        else
            failed=$((failed + 1))
            log "Failed to enable $pkg for user $user"
        fi
    done
done < "$PKGLIST"

log "Restore summary: packages=$count, operations_ok=$enabled, failed=$failed"
exit 0
