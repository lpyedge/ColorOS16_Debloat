# ColorOS 16 Debloat (Ace 6)

Magisk 模块用于禁用 OnePlus Ace 6 / ColorOS 16 上的广告、云控与运维组件。通过 `pm disable-*-user 0` 的方式实现，可随时卸载恢复。

## 目录

- `module.prop`：模块基础信息
- `packages.txt`：按分组维护的包列表（带中文注释说明）
- `service.sh`：开机时读取 `packages.txt` 并禁用未注释的包
- `uninstall.sh`：卸载模块时重新启用所有包（包含被注释的行）
- `apply_now.sh`：跳过开机等待，立即执行禁用流程
- `webroot/`：Magisk WebUI 界面，可视化管理包列表

## WebUI 使用

**环境要求：**
- Magisk 26.0+ (官方版)
- 旧版或第三方 Magisk 可能不支持 `webroot/` 机制

**操作步骤：**
1. 打开 Magisk Manager
2. 在模块列表中找到 "Ace 6 Debloat"
3. 点击模块卡片，Magisk 会自动在内置 WebView 中打开配置界面

**若未显示按钮：**
- 检查 Magisk 版本是否 >= 26.0
- 在 Magisk 中禁用/启用模块以刷新
- 或清除 Magisk App 数据后重启

**界面功能：**
- 按分组查看所有包名与中文注释
- 勾选代表"禁用"，取消勾选代表"保留"
- 点击"保存"只更新 `packages.txt`
- 点击"保存并立即应用"会自动执行禁用，立刻生效（无需重启）

## 手动应用更改

无需重启即可执行禁用流程：

```bash
cd /data/adb/modules/Ace6_Debloat
sh apply_now.sh
```

`apply_now.sh` 会跳过 `sys.boot_completed` 等待逻辑，直接进入包处理阶段。

## 卸载行为

`uninstall.sh` 会遍历 `packages.txt` 中出现过的所有包，即使其前面带有 `#` 也会重新启用，确保系统状态完全恢复。

## 注意事项

- 禁用 OTA/SAU 相关包会阻止系统更新，请在升级前手动重新启用。
- Watchdog/性能调度（如 `com.coloros.phoenix`）禁用后可能影响系统稳定性，请谨慎选择。
- WebUI 会直接修改 `packages.txt`，编辑时请避免在包名后插入需要解析的特殊字符。
