#!/system/bin/sh
# ColorOS 16 Debloat - Uninstall Script
# 卸载模块时重新启用之前禁用的应用包

MODDIR="${0%/*}"
PKGLIST="${MODDIR}/webroot/data/packages.txt"
LOGFILE="/data/local/tmp/coloros16_debloat_uninstall.log"
TAIL_LINES=2000

if [ -f "$LOGFILE" ] && command -v tail >/dev/null 2>&1; then
    tail -n "$TAIL_LINES" "$LOGFILE" > "${LOGFILE}.tmp" 2>/dev/null && mv "${LOGFILE}.tmp" "$LOGFILE"
fi

exec >> "$LOGFILE" 2>&1

log() {
    echo "[$(date '+%F %T')] $*"
}

extract_pkg_from_line() {
    local text="$1"
    if [ -z "$text" ]; then
        echo ""
        return
    fi

    local trimmed="$text"
    trimmed=$(printf '%s\n' "$trimmed" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    if [ "${trimmed#\#}" != "$trimmed" ]; then
        trimmed=$(printf '%s\n' "${trimmed#\#}" | sed 's/^[[:space:]]*//')
    fi

    # 移除 com. 前缀限制，并正确处理行内注释
    # 检查是否包含点号，作为包名的基本特徵
    case $trimmed in
        *.*)
            # 先去掉 # 及其后面的内容，再取第一列
            printf '%s\n' "$trimmed" | cut -d'#' -f1 | awk '{print $1}'
            return
            ;;
        *)
            echo ""
            return
            ;;
    esac
}

log "============================================"
log "ColorOS 16 Debloat Uninstall started"
log "Module Dir: $MODDIR"
log "============================================"

# 检查 Root 权限
if [ "$(id -u)" -ne 0 ]; then
    log "[ERROR] Root access required!"
    exit 1
fi

# 检查包列表文件是否存在
if [ ! -f "$PKGLIST" ]; then
    log "[WARNING] Package list not found: $PKGLIST"
    log "[INFO] Uninstall will proceed without re-enabling packages"
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

USERS="$(get_user_list)"
log "[INFO] Target users: $USERS"

# 重新启用包的函数
enable_package() {
    local pkg="$1"
    local user overall=0 result

    if ! pm path "$pkg" >/dev/null 2>&1; then
        log "[SKIP] Package not found: $pkg"
        return 2
    fi

    for user in $USERS; do
        if pm enable --user "$user" "$pkg" 2>/dev/null; then
            log "[OK] Enabled for user $user: $pkg"
        else
            log "[FAIL] Failed to enable for user $user: $pkg"
            overall=1
        fi
    done

    return $overall
}

# 统计计数器
total=0
enabled=0
skipped=0
failed=0

# 读取包列表并逐行处理
while IFS= read -r line || [ -n "$line" ]; do
    pkg=$(extract_pkg_from_line "$line")
    if [ -z "$pkg" ]; then
        continue
    fi

    total=$((total + 1))
    enable_package "$pkg"
    result=$?
    
    case $result in
        0) enabled=$((enabled + 1)) ;;
        1) failed=$((failed + 1)) ;;
        2) skipped=$((skipped + 1)) ;;
    esac
    
done < "$PKGLIST"

# 输出统计信息
log "============================================"
log "Re-enable operation completed"
log "Total packages processed: $total"
log "Successfully enabled: $enabled"
log "Skipped (not found): $skipped"
log "Failed: $failed"
log "============================================"

# 清理日志文件(可选)
rm -f /data/local/tmp/coloros16_debloat.log
rm -f /data/local/tmp/coloros16_debloat_uninstall.log

if command -v settings >/dev/null 2>&1; then
    settings delete global pkg_watchdog_enable >/dev/null 2>&1 && log "[INFO] pkg_watchdog setting restored"
fi
pm enable --user 0 com.oplus.phoenix >/dev/null 2>&1 && log "[INFO] Phoenix watchdog restored"

log "[INFO] Module uninstalled successfully"
log "[INFO] You may need to reboot for changes to take full effect"

exit 0
