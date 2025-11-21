ui_print "=========================================="
ui_print " ColorOS 16 Debloat - Ace 6"
ui_print " 版本: 1.1"
ui_print "=========================================="
ui_print ""
ui_print "模块功能："
ui_print "- 禁用 ColorOS 16 广告/云控/运维组件"
ui_print "- 支持 WebUI 可视化管理包列表"
ui_print "- 自动应用 packages.txt 配置"
ui_print ""

if [ "$KSU" = "true" ]; then
  ui_print "检测到 KernelSU 环境："
  ui_print "- 支持原生 WebUI (模块列表显示打开按钮)"
  ui_print "- 备用访问地址: http://127.0.0.1:9898"
else
  ui_print "检测到 Magisk 环境："
  ui_print "- WebUI 访问地址: http://127.0.0.1:9898"
  ui_print "- 请使用浏览器访问上述地址进行管理"
fi

ui_print ""
ui_print "=========================================="
ui_print " 安装完成，重启后生效"
ui_print "=========================================="

# 设置权限
set_perm_recursive "$MODDIR" 0 0 0755 0644
set_perm "$MODDIR/service.sh" 0 0 0755
set_perm "$MODDIR/apply_now.sh" 0 0 0755
set_perm "$MODDIR/uninstall.sh" 0 0 0755
# 关键：确保 CGI 脚本可执行，这对 KernelSU 和 Magisk WebUI 都至关重要
set_perm "$MODDIR/webroot/cgi-bin/packages.sh" 0 0 0755

# 修复 Windows 换行符 (CRLF -> LF)
# 使用 tr 命令，兼容性优于 sed
for file in "$MODDIR"/*.sh "$MODDIR"/*.prop "$MODDIR"/*.txt "$MODDIR"/webroot/cgi-bin/*.sh; do
  if [ -f "$file" ]; then
    cat "$file" | tr -d '\r' > "${file}.tmp" && mv "${file}.tmp" "$file"
    chmod 0755 "$file"
  fi
done
