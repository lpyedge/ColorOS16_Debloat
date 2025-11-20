#!/system/bin/sh
# 手动执行包禁用流程，跳过开机等待
MODDIR="${0%/*}"
export SKIP_BOOT_WAIT=1
# 传递 --no-webui 防止重启 Web 服务导致连接中断
exec "$MODDIR/service.sh" --no-webui "$@"
