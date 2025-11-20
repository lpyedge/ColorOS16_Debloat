#!/system/bin/sh
# CGI endpoint for reading/updating packages.txt

# 忽略错误，防止脚本中途退出导致 Web 服务器断开连接
set +e

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "${0%/*}" && pwd)"
# 推算模块根目录
MODDIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
PKG_FILE="$MODDIR/packages.txt"
APPLY_SCRIPT="$MODDIR/apply_now.sh"

# === 关键修改：先输出响应头 ===
# 这能确保浏览器先建立连接，避免因脚本处理耗时或错误导致的 "Failed to fetch"
echo "Content-Type: text/plain"
echo "Connection: close"
echo ""

# 处理请求
if [ "$REQUEST_METHOD" = "POST" ]; then
    # === 关键修改：使用 cat 读取 stdin ===
    # busybox httpd 会在发送完 Body 后关闭 stdin，所以 cat 是安全的
    # 相比 dd，cat 不会因为字节数计算错误而挂起
    cat > "$PKG_FILE.tmp"
    
    # 检查是否成功写入
    if [ -s "$PKG_FILE.tmp" ]; then
        mv -f "$PKG_FILE.tmp" "$PKG_FILE"
        # 同步到 Web 目录
        cp -f "$PKG_FILE" "$MODDIR/webroot/packages.txt"
        echo "Save OK"
    else
        echo "Save Failed: Empty body"
        rm -f "$PKG_FILE.tmp"
    fi

    # 尝试应用更改
    # 检查 QUERY_STRING 是否包含 apply=1
    if echo "$QUERY_STRING" | grep -q "apply=1"; then
        if [ -x "$APPLY_SCRIPT" ]; then
            # 后台执行
            nohup sh "$APPLY_SCRIPT" >/dev/null 2>&1 &
            echo "Apply Triggered"
        fi
    fi
else
    # GET 请求 (备用，主要由静态文件处理)
    if [ -f "$PKG_FILE" ]; then
        cat "$PKG_FILE"
    else
        echo "# Error: packages.txt not found"
    fi
fi

exit 0
