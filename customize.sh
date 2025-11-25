ui_print "=========================================="
ui_print " ColorOS16_Debloat - Magisk / KernelSU 模組"
ui_print " 版本: 0.2.1"
ui_print "=========================================="
ui_print ""
ui_print "模組用途："
ui_print "- 屏蔽 ColorOS16 的廣告、雲控、行為/監控與垃圾系統組件"
ui_print "- 支援 Magisk + WebUI-X 提供可視化管理，亦支援 KernelSU 的 WebUI Bridge"
ui_print ""
ui_print "安裝後操作："
ui_print "- 編輯：請透過模組的 WebUI（或直接編輯 webroot/data/packages.txt）管理套件清單"
ui_print "- 立即套用：可在 WebUI 選擇「保存並立即應用」或執行 sh apply_now.sh"
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
