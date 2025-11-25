#!/system/bin/sh
# 手动执行包禁用流程，跳过开机等等待
MODDIR="${0%/*}"
export SKIP_BOOT_WAIT=1
# 传递 --no-webui 防止重启 Web 服务导致连接中断；显式用 sh 调用，避免可执行位/挂载标志导致的权限问题
exec /system/bin/sh "$MODDIR/service.sh" --no-webui "$@"
