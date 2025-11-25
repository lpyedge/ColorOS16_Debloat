# ColorOS16_Debloat — Magisk / KernelSU 模組

繁體中文說明（簡潔、實作導向）

本模組的目標是幫助使用者在 ColorOS16（包含 OnePlus Ace6）上屏蔽系統內的廣告、雲控、行為/監控模組以及其他不必要或具隱私/資源負擔的系統組件。

支援環境
- Magisk（模組安裝）搭配 WebUI‑X：提供完整的 WebUI 管理介面（在 Magisk Manager 中顯示模組卡片並開啟內建 WebView）。
- KernelSU：支援 KernelSU 的宿主環境也能透過其 JS Bridge 使用 WebUI 與模組腳本（若宿主提供 WebUI 功能）。

主要功能
- 以分組方式維護可選擇禁用的系統套件清單（真源檔案：`webroot/data/packages.txt`）。
- 提供 WebUI 編輯與「保存並立即應用」的工作流程（WebUI 寫入時會執行安全寫入腳本並修正權限）。
- 開機時自動執行 `service.sh`，讀取套件清單並批次禁用未被註解的套件；亦提供 `apply_now.sh` 以即時套用變更。
- 卸載時由 `uninstall.sh` 嘗試重新啟用曾被處理過的套件，盡量回復系統狀態。

測試平台
- 主要開發與測試機型：OnePlus Ace6（ColorOS16）。其他使用 ColorOS16 的裝置可能相容，但請務必先在備份環境驗證。

取得並安裝 WebUI‑X（Magisk）
1. 訪問 [WebUI-X 官方 GitHub 項目](https://github.com/MMRLApp/WebUI-X-Portable) 下載最新版本。
2. 安裝 WebUI‑X 後，打開WebUI‑X模組列表打開本模組卡片，即會由宿主（Magisk / KernelSU）開啟內建 WebView 顯示 `webroot/` 下的管理介面。

套件清單（已禁用/可禁用項目）
- 主套件清單儲存在：`webroot/data/packages.txt`（請以該檔案為單一真源）。
- 檢視或編輯請使用 WebUI，或直接在模組目錄中打開此檔案：

```bash
# 範例：在裝置上檢視
cat /data/adb/modules/ColorOS16_Debloat/webroot/data/packages.txt
```

使用說明（快速）
- 編輯：打開模組 WebUI（Magisk + WebUI‑X 或 KernelSU 的 WebUI）；編輯完成後點選「保存」。
- 保存僅會更新 `webroot/data/packages.txt`；若勾選「保存並立即應用」，系統會觸發 `apply_now.sh` 以即刻套用變更（需要 root 權限）。
- 命令列套用：

```bash
cd /data/adb/modules/ColorOS16_Debloat
sh apply_now.sh
```

警告與建議
- 禁用 OTA/SAU/更新相關組件會導致系統無法收到官方更新；若要升級系統，請事先還原或停用本模組。
- 部分安全或支付相關套件（例如安全中心、支付鍵盤等）被禁用後可能造成銀行或支付 App 無法使用；在生產裝置上操作前請先確認影響範圍。
- 建議先備份系統或至少備份重要資料，並在具可回復的情況下測試本模組。

回報錯誤與貢獻
- 若遇到問題，請在本專案 GitHub 頁面提出 Issue 或 PR，並附上：
	- 使用機型與 Android/ColorOS 版本
	- 日誌（如 `adb logcat` 與模組運行日誌）
	- 具體重現步驟

授權與責任
- 本模組為工具性質，使用者需自行承擔操作風險；作者/維護者不對因操作導致的任何損失負責。

---
上面檔案與說明已針對 Magisk + WebUI‑X 與 KernelSU 環境進行優化，如需更進階的整合或範例（例如自動化部署指令、CI 打包設定），可以在 repo 提 issue 指示要加入的內容。

---
本模組僅提供工具性協助，使用時請自行承擔風險並先備份重要資料。


## 卸载行为

`uninstall.sh` 会遍历 `webroot/data/packages.txt` 中出现过的所有包，即使其前面带有 `#` 也会重新启用，确保系统状态完全恢复。

