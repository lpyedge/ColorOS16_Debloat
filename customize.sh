ui_print "=========================================="
ui_print " ColorOS 16 Debloat - Ace 6"
ui_print " 版本: 0.1.8"
ui_print "=========================================="
ui_print ""
ui_print "模块功能："
ui_print "- 禁用 ColorOS 16 广告/云控/运维组件"
ui_print "- 支持 WebUI 可视化管理包列表"
ui_print "- 自动应用 packages.txt 配置"
ui_print ""


ui_print ""
ui_print "=========================================="
ui_print " 安装完成，重启后生效"
ui_print "=========================================="

# 设置权限
set_perm_recursive "$MODDIR" 0 0 0755 0644
set_perm "$MODDIR/service.sh" 0 0 0755
set_perm "$MODDIR/apply_now.sh" 0 0 0755
set_perm "$MODDIR/uninstall.sh" 0 0 0755
set_perm "$MODDIR/webroot/scripts/save_packages.sh" 0 0 0755

# 修复 Windows 换行符 (CRLF -> LF)
for file in "$MODDIR"/*.sh "$MODDIR"/*.prop "$MODDIR"/*.txt "$MODDIR"/webroot/scripts/*.sh; do
  if [ -f "$file" ]; then
    cat "$file" | tr -d '\r' > "${file}.tmp" && mv "${file}.tmp" "$file"
    case "$file" in
      *.sh) chmod 0755 "$file" ;;
      *) chmod 0644 "$file" ;;
    esac
  fi
done
