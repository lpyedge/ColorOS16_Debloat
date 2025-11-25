#!/system/bin/sh
# ColorOS 16 Debloat - Service Script
# 在系统启动时禁用指定的应用包

MODDIR="${0%/*}"
PKGLIST="${MODDIR}/webroot/data/packages.txt"
LOGFILE="/data/local/tmp/ace6_debloat.log"
MAX_BOOT_WAIT=300
BOOT_WAIT_INTERVAL=5
MAX_DISABLE_RETRY=3
RETRY_INTERVAL=2
TAIL_LINES=2000
SKIP_BOOT_WAIT=${SKIP_BOOT_WAIT:-0}

# 日志截断以避免无限增长
if [ -f "$LOGFILE" ] && command -v tail >/dev/null 2>&1; then
    tail -n "$TAIL_LINES" "$LOGFILE" > "${LOGFILE}.tmp" 2>/dev/null && mv "${LOGFILE}.tmp" "$LOGFILE"
fi

# 重定向所有输出到日志文件
exec >> "$LOGFILE" 2>&1

log() {
    echo "[$(date '+%F %T')] $*"
}

log "============================================"
log "Ace6 Debloat Service started"
log "Module Dir: $MODDIR"
log "============================================"

# 检查 Root 权限
if [ "$(id -u)" -ne 0 ]; then
    log "[ERROR] Root access required!"
    exit 1
fi

# 检查包列表文件是否存在
if [ ! -f "$PKGLIST" ]; then
    log "[ERROR] Package list not found: $PKGLIST"
    exit 1
fi

# 同步 packages.txt 到 WebUI 目录，便于 KernelSU WebUI 读取
sync_webroot_packages() {
    local target="$MODDIR/webroot/data/packages.txt"
    if [ -d "$MODDIR/webroot" ]; then
        mkdir -p "$MODDIR/webroot/data" 2>/dev/null || true
        cp -f "$PKGLIST" "$target" 2>/dev/null
        chmod 0644 "$target" 2>/dev/null
    fi
}

sync_webroot_packages

if [ "$SKIP_BOOT_WAIT" -eq 1 ]; then
    log "[INFO] SKIP_BOOT_WAIT=1, skipping boot-complete wait"
else
    log "[INFO] Waiting for system properties to signal boot completion..."
    elapsed=0
    until [ "$(getprop sys.boot_completed)" = "1" ]; do
        if [ "$elapsed" -ge "$MAX_BOOT_WAIT" ]; then
            log "[ERROR] sys.boot_completed not set after ${MAX_BOOT_WAIT}s, aborting"
            exit 1
        fi
        sleep "$BOOT_WAIT_INTERVAL"
        elapsed=$((elapsed + BOOT_WAIT_INTERVAL))
    done

    sleep 10
    log "[INFO] System boot completed, starting package disable operations..."
fi

# 关闭 pkg watchdog 以减少回滚
if command -v settings >/dev/null 2>&1; then
    settings put global pkg_watchdog_enable 0 >/dev/null 2>&1 && log "[INFO] pkg_watchdog disabled"
fi
pm disable-user --user 0 com.oplus.phoenix >/dev/null 2>&1 && log "[INFO] Phoenix watchdog disabled"

# 解析用户列表
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

# 禁用包的函数
disable_package() {
    local pkg="$1"
    local user result overall=0

    # 检查包是否存在 (即使已禁用也能检测)
    if ! pm path "$pkg" >/dev/null 2>&1; then
        log "[SKIP] Package not found: $pkg"
        return 2
    fi

    for user in $USERS; do
        result=1
        attempt=1
        while [ "$attempt" -le "$MAX_DISABLE_RETRY" ]; do
            if pm disable-until-used --user "$user" "$pkg" 2>/dev/null; then
                log "[OK] Disabled for user $user: $pkg (disable-until-used)"
                result=0
                break
            elif pm disable-user --user "$user" "$pkg" 2>/dev/null; then
                log "[OK] Disabled for user $user: $pkg (disable-user)"
                result=0
                break
            elif pm disable --user "$user" "$pkg" 2>/dev/null; then
                log "[OK] Disabled for user $user: $pkg (disable)"
                result=0
                break
            else
                sleep "$RETRY_INTERVAL"
            fi
            attempt=$((attempt + 1))
        done

        if [ "$result" -ne 0 ]; then
            log "[FAIL] Failed to disable for user $user after $MAX_DISABLE_RETRY attempts: $pkg"
            overall=1
        fi
    done

    return $overall
}

# 统计计数器
total=0
disabled=0
skipped=0
failed=0

# 读取包列表并逐行处理
while IFS= read -r line || [ -n "$line" ]; do
    # 移除行首尾空白
    line=$(printf '%s\n' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # 跳过空行和注释行
    if [ -z "$line" ] || [ "${line#\#}" != "$line" ]; then
        continue
    fi
    
    # 提取包名（去掉注释部分）
    # 使用 cut -d'#' -f1 去掉行内注释，再用 awk 提取第一个字段(包名)
    pkg=$(printf '%s\n' "$line" | cut -d'#' -f1 | awk '{print $1}')
    if [ -z "$pkg" ]; then
        continue
    fi
    
    total=$((total + 1))
    disable_package "$pkg"
    result=$?
    
    case $result in
        0) disabled=$((disabled + 1)) ;;
        1) failed=$((failed + 1)) ;;
        2) skipped=$((skipped + 1)) ;;
    esac
    
done < "$PKGLIST"

# 输出统计信息
log "============================================"
log "Debloat operation completed"
log "Total packages processed: $total"
log "Successfully disabled: $disabled"
log "Skipped (not found): $skipped"
log "Failed: $failed"
log "============================================"

exit 0
