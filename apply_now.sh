#!/system/bin/sh
# 手动执行包禁用流程，跳过等待开机与 WebUI 自动同步
MODDIR="${0%/*}"
export SKIP_BOOT_WAIT=1
# 显式用 sh 执行，避免可执行位挂载限制
exec /system/bin/sh "$MODDIR/service.sh" --no-webui "$@"
