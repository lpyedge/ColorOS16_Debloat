ui_print "=========================================="
ui_print " ColorOS16_Debloat - Magisk / KernelSU 模組"
ui_print " 版本: 0.3.5"
ui_print "=========================================="
ui_print ""
ui_print "模組用途："
ui_print "- 屏蔽 ColorOS16 的廣告、雲控、行為/監控與垃圾系統組件"
ui_print ""
ui_print "安裝後操作："
ui_print "- 編輯：請透過模組的 WebUI 管理套件清單"
ui_print "- Magisk 请安装 WebUI-X App 以啟用 Web 介面"
ui_print ""
ui_print "=========================================="
ui_print " 安裝完成，請重啟以確保服務啟動"
ui_print "=========================================="

# 设置权限
set_perm_recursive "$MODDIR" 0 0 0755 0644
set_perm "$MODDIR/service.sh" 0 0 0755
set_perm "$MODDIR/apply_now.sh" 0 0 0755
set_perm "$MODDIR/uninstall.sh" 0 0 0755
set_perm "$MODDIR/webroot/scripts/save_packages.sh" 0 0 0755
set_perm "$MODDIR/webroot/scripts/restore_all_packages.sh" 0 0 0755

# 修复 Windows 换行符 (CRLF -> LF) 并调整权限
for file in "$MODDIR"/*.sh "$MODDIR"/*.prop "$MODDIR"/webroot/data/*.txt "$MODDIR"/webroot/scripts/*.sh; do
  if [ -f "$file" ]; then
    cat "$file" | tr -d '\r' > "${file}.tmp" && mv "${file}.tmp" "$file"
    case "$file" in
      *.sh) chmod 0755 "$file" ;;
      *) chmod 0644 "$file" ;;
    esac
  fi
done
