# ColorOS 16 Debloat (Magisk / KernelSU)

为 ColorOS 16 设备（测试设备 OnePlus Ace 6）提供系统组件精简与禁用能力，专注屏蔽广告、云控、统计/监控等高骚扰或隐私敏感的系统服务。支持 Magisk + WebUI-X 以及 KernelSU（含 apatch）双端方案。

## 功能概览
- **分组禁用列表**：`webroot/data/packages.txt` 按分组维护可禁用的系统包名，附中文注释，勾选即代表禁用。
- **WebUI 可视化**：通过 Magisk Manager 或 KernelSU 宿主内置的 WebView 打开 WebUI，支持浏览、勾选、保存，以及「保存并立即应用」。
- **开机自动执行**：`service.sh` 在开机后读取列表并禁用未注释的包；`apply_now.sh` 可在无需重启的情况下即时应用。
- **卸载回滚**：`uninstall.sh` 会尝试重新启用列表中出现过的包（即便前面带有 `#`），尽可能还原系统状态。

## 适用环境
- Magisk 26.0+（官方版）+ WebUI-X Portable
- KernelSU / apatch（含其 WebUI JS Bridge）
- ColorOS 16 （Android 16）OnePlus Ace 6 及同系列 ColorOS 机型

## 目录速览
- `module.prop`：模块信息与在线更新元数据
- `webroot/data/packages.txt`：唯一可信的包列表源
- `webroot/`：WebUI 前端资源（Magisk / KernelSU 均读取此处）
- `service.sh`：开机时执行禁用流程
- `apply_now.sh`：跳过开机等待，立即应用当前列表
- `uninstall.sh`：卸载模块时尝试恢复所有出现在列表中的包
- `webroot/scripts/save_packages.sh`：WebUI 保存入口（写入并修正权限）

## WebUI 使用
1. 确保已安装 WebUI-X（Magisk 环境）或宿主支持 KernelSU JS Bridge。
2. 在 WebUI-X / KernelSU 模块列表点击本模块卡片，打开内置 WebView。
3. WebUI 交互：
   - 勾选 = 禁用；取消勾选 = 保留
   - **保存**：仅更新 `webroot/data/packages.txt`
   - **保存并立即应用**：保存后触发 `apply_now.sh`，无需重启
4. 若页面提示「未检测到 KernelSU / WebUI X」，可先浏览列表，但无法保存。请在支持的宿主内打开。

## 命令行快速操作
```bash
# 手动立即应用当前列表（无需重启）
cd /data/adb/modules/coloros16_debloat
sh apply_now.sh
```

查看当前列表：
```bash
cat /data/adb/modules/coloros16_debloat/webroot/data/packages.txt
```

## 注意事项
- 禁用 OTA / SAU / 系统更新相关包将导致无法收到官方更新；升级前请暂时恢复或禁用本模块。
- 禁用安全/支付相关组件（如安全中心、支付键盘等）可能影响银行/支付 App 正常使用，请谨慎选择。
- 建议先备份重要数据，再在可回滚的环境中尝试。

## 日志与排查
- WebUI 顶部状态与 debug 区会显示当前步骤与执行日志，便于定位问题。
- 开机/应用时的后台日志：`/data/local/tmp/ace6_debloat.log`
- 卸载日志：`/data/local/tmp/ace6_debloat_uninstall.log`

