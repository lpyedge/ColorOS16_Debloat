#!/system/bin/sh
# ColorOS 16 Debloat - Service Script
# 在系统启动时禁用指定的应用包

MODDIR="${0%/*}"
PKGLIST="${MODDIR}/packages.txt"
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

# 解析参数
NO_WEBUI=0
for arg in "$@"; do
    if [ "$arg" = "--no-webui" ]; then
        NO_WEBUI=1
    fi
done

# 启动 WebUI 服务 (Magisk 兼容模式)
start_webui() {
    local port=9898
    local bb="busybox"
    
    # 检测 KSU 环境 (仅记录日志，不影响启动备用 WebUI)
    if [ -d "/data/adb/ksu" ] || [ -f "/data/adb/ksu/bin/ksu" ]; then
         log "[INFO] KernelSU environment detected."
    fi

    # 查找最佳 busybox (优先使用 Magisk/KSU 内置版本，通常功能更全)
    if [ -f "/data/adb/magisk/busybox" ]; then
        bb="/data/adb/magisk/busybox"
    elif [ -f "/data/adb/ksu/bin/busybox" ]; then
        bb="/data/adb/ksu/bin/busybox"
    elif command -v busybox >/dev/null; then
        bb="busybox"
    else
        log "[WARN] Busybox not found, WebUI cannot start"
        return
    fi

    # 检查 httpd 功能是否支持
    if ! $bb httpd --help >/dev/null 2>&1; then
        log "[WARN] Selected busybox ($bb) does not support httpd applet"
        return
    fi

    # 强制清理旧进程 (防止僵尸进程占用端口)
    $bb pkill -f "httpd -p $port" 2>/dev/null

    # 启动 httpd
    log "Starting WebUI with: $bb httpd -p $port -h $MODDIR/webroot -c $MODDIR/webroot/cgi-bin"
    $bb httpd -p $port -h "$MODDIR/webroot" -c "$MODDIR/webroot/cgi-bin"
    
    # === 混合架构核心：同步配置文件到 Web 目录 ===
    # 解决 CGI 读取失败的问题，改用静态文件读取
    cp -f "$PKGLIST" "$MODDIR/webroot/packages.txt"
    chmod 0644 "$MODDIR/webroot/packages.txt"
    # ===========================================
    
    # 验证启动状态
    sleep 1
    if netstat -an | grep -q ":$port "; then
        log "WebUI started successfully at http://127.0.0.1:$port"
    else
        log "[ERROR] WebUI failed to bind port $port. Check if port is in use or permission denied."
        # 尝试使用备用端口 9899
        port=9899
        log "Retrying on port $port..."
        $bb httpd -p $port -h "$MODDIR/webroot" -c "$MODDIR/webroot/cgi-bin"
        if netstat -an | grep -q ":$port "; then
             log "WebUI started successfully at http://127.0.0.1:$port"
        else
             log "[ERROR] WebUI failed to start on backup port either."
        fi
    fi
}

# === 关键修复：确保 CGI 脚本可执行且无 Windows 换行符 ===
# 这步操作在每次开机时执行，防止 customize.sh 修复失败
CGI_DIR="$MODDIR/webroot/cgi-bin"
CGI_SCRIPT="$CGI_DIR/packages.sh"

if [ -d "$CGI_DIR" ]; then
    chmod 0755 "$CGI_DIR"
fi

if [ -f "$CGI_SCRIPT" ]; then
    log "Fixing CGI script permissions and line endings..."
    chmod 0755 "$CGI_SCRIPT"
    
    # 尝试设置 SELinux 上下文，防止执行被拒绝
    chcon u:object_r:system_file:s0 "$CGI_SCRIPT" 2>/dev/null || true
    
    # 使用 tr 删除 \r，比 sed -i 兼容性更好
    cat "$CGI_SCRIPT" | tr -d '\r' > "${CGI_SCRIPT}.tmp"
    # 确保文件内容不为空再覆盖
    if [ -s "${CGI_SCRIPT}.tmp" ]; then
        mv "${CGI_SCRIPT}.tmp" "$CGI_SCRIPT"
        chmod 0755 "$CGI_SCRIPT"
        chcon u:object_r:system_file:s0 "$CGI_SCRIPT" 2>/dev/null || true
    else
        rm "${CGI_SCRIPT}.tmp"
    fi
else
    log "[ERROR] CGI script not found: $CGI_SCRIPT"
fi
# ========================================================

if [ "$NO_WEBUI" -eq 0 ]; then
    start_webui
fi

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
