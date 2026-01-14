const state = {
    header: [],
    groups: [],
};

const MODULE_ID = "coloros16_debloat";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
const PACKAGE_FILE = `${MODULE_PATH}/webroot/data/packages.txt`;
const SAVE_SCRIPT = `${MODULE_PATH}/webroot/scripts/save_packages.sh`;
const APPLY_SCRIPT = `${MODULE_PATH}/apply_now.sh`;

const BRIDGE_WAIT_RETRIES = 40;
const BRIDGE_WAIT_DELAY = 250;
let cachedBridge = null;

// apatch 兼容：缺省映射 ksu
if (typeof window !== "undefined" && window.apatch && !window.ksu) {
    window.ksu = window.apatch;
}

function setStatus(message, level = "error") {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;
    if (!message) {
        statusEl.textContent = "";
        statusEl.className = "status";
        return;
    }
    const levelClass = `status-${level}`;
    statusEl.textContent = message;
    statusEl.className = `status status-visible ${levelClass}`;
}

function showToast(message) {
    const bridge = getBridge();
    if (bridge && typeof bridge.toast === "function") {
        try {
            bridge.toast(message);
            return;
        } catch (e) {
            // 如果 bridge.toast 拋錯，退回到 console.log
            console.log("bridge.toast failed:", e);
        }
    }

    // 若 bridge.toast 不存在或拋錯，使用 alert 作為簡單且明確的回退方案
    try {
        alert(message);
    } catch (e) {
        // 若 alert 也不可用（極少見），退回到 console.log
        console.log("[Toast-fallback] " + message);
    }
}

function logStep(message, options = {}) {
    console.log("[WebUI]", message);
    const debugEl = document.getElementById("debug");
    if (debugEl) {
        const time = new Date().toLocaleTimeString();
        debugEl.textContent += `[${time}] ${message}\n`;
        debugEl.scrollTop = debugEl.scrollHeight;
    }
    if (options.statusLevel) {
        setStatus(message, options.statusLevel);
    }
}

function normalizeExecResult(result) {
    const pickFirstString = (obj, keys) => {
        for (const key of keys) {
            const value = obj[key];
            if (typeof value === "string") return value;
            if (Array.isArray(value)) return value.join("\n");
        }
        return "";
    };

    if (Array.isArray(result)) {
        return { stdout: result.join("\n"), stderr: "", errno: 0 };
    }
    if (typeof result === "number") return { stdout: "", stderr: "", errno: result };
    if (typeof result === "string") return { stdout: result, stderr: "", errno: 0 };
    if (!result || typeof result !== "object") return { stdout: "", stderr: "", errno: 0 };

    const codeKeys = ["errno", "code", "exitCode", "status"];
    let errno = 0;
    for (const key of codeKeys) {
        if (typeof result[key] === "number") {
            errno = result[key];
            break;
        }
    }
    if (!errno && result.success === false) errno = 1;

    const stdout = pickFirstString(result, ["stdout", "out", "output", "data", "result"]);
    const stderr = pickFirstString(result, ["stderr", "err", "error", "message"]);
    return { stdout, stderr, errno };
}

async function callExecWithFallback(execFn, command) {
    let lastError = null;
    try {
        const direct = execFn(command);
        if (direct && typeof direct.then === "function") return await direct;
        if (direct !== undefined) return direct;
    } catch (err) {
        lastError = err;
    }

    if (execFn.length >= 3 && typeof window !== "undefined") {
        return await new Promise((resolve, reject) => {
            const cbName = `_wx_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            window[cbName] = (errno, stdout, stderr) => {
                delete window[cbName];
                resolve({
                    errno: typeof errno === "number" ? errno : 0,
                    stdout: stdout || "",
                    stderr: stderr || "",
                });
            };
            try {
                execFn(command, {}, cbName);
            } catch (err) {
                delete window[cbName];
                reject(err);
            }
        });
    }

    if (execFn.length >= 2) {
        return await new Promise((resolve, reject) => {
            try {
                execFn(command, (res, stdout, stderr) => {
                    if (res && typeof res === "object") {
                        resolve(res);
                        return;
                    }
                    resolve({
                        errno: typeof res === "number" ? res : 0,
                        stdout: stdout || "",
                        stderr: stderr || "",
                    });
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    if (lastError) throw lastError;
    throw new Error("exec API 不兼容");
}

function detectBridge() {
    if (typeof ksu !== "undefined" && typeof ksu.exec === "function") {
        const execFn = ksu.exec.bind(ksu);
        return {
            name: "KernelSU",
            exec: async (command) => normalizeExecResult(await callExecWithFallback(execFn, command)),
            toast: (message) => {
                if (typeof ksu.toast === "function") ksu.toast(message);
                else console.log(message);
            },
        };
    }

    if (typeof window !== "undefined") {
        const candidates = [
            window.webui,
            window.WebUI,
            window.webuix,
            window.wx,
            window.$wx,
            window.$webui,
            window.$ksuwebui,
            window.$ksuwebui_demo,
        ].filter(Boolean);

        for (const candidate of candidates) {
            if (typeof candidate.exec === "function") {
                const execFn = candidate.exec.bind(candidate);
                return {
                    name: "WebUI X",
                    exec: async (command) => normalizeExecResult(await callExecWithFallback(execFn, command)),
                    toast: (message) => {
                        if (typeof candidate.toast === "function") candidate.toast(message);
                        else if (window.webui && typeof window.webui.toast === "function") window.webui.toast(message);
                        else console.log(message);
                    },
                };
            }
        }
    }

    return null;
}

function getBridge() {
    if (cachedBridge) return cachedBridge;
    const detected = detectBridge();
    if (detected) cachedBridge = detected;
    return cachedBridge;
}

async function waitForBridge(retries = BRIDGE_WAIT_RETRIES, delay = BRIDGE_WAIT_DELAY) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const bridge = getBridge();
        if (bridge) return bridge;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return null;
}

function ensureBridge() {
    const bridge = getBridge();
    if (!bridge) {
        throw new Error("未检测到 KernelSU / WebUI X JS API");
    }
    return bridge;
}

function decodeBase64Utf8(b64) {
    const clean = (b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
}

async function execCommand(cmd) {
    const bridge = ensureBridge();
    logStep(`执行命令: ${cmd}`);
    const result = await bridge.exec(cmd);
    const normalized = normalizeExecResult(result);
    if (normalized.errno !== 0) {
        const reason = normalized.stderr || `命令执行失败 (exit ${normalized.errno})`;
        throw new Error(reason);
    }
    return normalized.stdout;
}

function getSafeAreaInsets() {
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    const computed = getComputedStyle(document.documentElement);
    const cssTop = parseFloat(computed.getPropertyValue("--safe-area-top")) || 0;
    const cssBottom = parseFloat(computed.getPropertyValue("--safe-area-bottom")) || 0;
    return { top: Math.max(top, cssTop, 0), bottom: Math.max(bottom, cssBottom, 0) };
}

function applySafeAreaInsets() {
    const insets = getSafeAreaInsets();
    document.documentElement.style.setProperty("--safe-area-top", `${insets.top}px`);
    document.documentElement.style.setProperty("--safe-area-bottom", `${insets.bottom}px`);
    document.documentElement.style.setProperty("--window-inset-top", `${insets.top}px`);
    document.documentElement.style.setProperty("--window-inset-bottom", `${insets.bottom}px`);
}

async function fetchPackagesFromWebroot() {
    logStep("使用前端副本读取 packages.txt");
    const resp = await fetch("data/packages.txt", { cache: "no-store" });
    if (!resp.ok) {
        throw new Error(`获取 packages.txt 失败 (HTTP ${resp.status})`);
    }
    return await resp.text();
}

function splitMeta(meta) {
    const cleaned = (meta || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return { label: "", description: "" };
    const firstSpace = cleaned.indexOf(" ");
    if (firstSpace === -1) return { label: cleaned, description: "" };
    const label = cleaned.slice(0, firstSpace).trim();
    const description = cleaned.slice(firstSpace + 1).trim();
    return { label, description };
}

function parsePackagesText(text) {
    const header = [];
    const groups = [];
    const lines = text.replace(/\r/g, "").split("\n");
    let currentGroup = null;

    const startGroup = (title) => {
        currentGroup = { title, preamble: [], items: [], _hasItems: false };
        groups.push(currentGroup);
    };

    lines.forEach((line, idx) => {
        const original = line;
        const trimmed = line.replace(/^\uFEFF/, "").trim();

        if (!trimmed) {
            if (!currentGroup) header.push("");
            else if (!currentGroup._hasItems) currentGroup.preamble.push("");
            return;
        }

        const isTitle = /^\s*#\s*===.*===\s*$/.test(trimmed) || (trimmed.includes("===") && /^#+/.test(trimmed));
        if (isTitle) {
            const cleaned = trimmed.replace(/^\s*#\s*/, "").trim();
            startGroup(cleaned);
            return;
        }

        if (!currentGroup) {
            header.push(original);
            return;
        }

        let working = trimmed;
        let commentLevel = 0;
        while (working.startsWith("#")) {
            commentLevel += 1;
            working = working.slice(1);
        }
        working = working.replace(/^\s+/, "");
        const ignored = commentLevel >= 2;
        const enabled = commentLevel === 0;

        if (!working || working.startsWith("=") || working.indexOf(".") === -1) {
            currentGroup.preamble.push(original);
            return;
        }

        let pkgPart = working;
        let metaPart = "";
        const hashPos = working.indexOf("#");
        if (hashPos !== -1) {
            pkgPart = working.slice(0, hashPos).trim();
            metaPart = working.slice(hashPos + 1).trim();
            if (metaPart.startsWith("#")) metaPart = metaPart.slice(1).trim();
        }

        if (!pkgPart) {
            logStep(`警告：第 ${idx + 1} 行未识别包名，已跳过`);
            return;
        }

        const { label, description } = splitMeta(metaPart);
        currentGroup.items.push({ id: pkgPart, label, description, enabled, ignored });
        currentGroup._hasItems = true;
    });

    groups.forEach((group) => delete group._hasItems);
    return { header, groups };
}

function buildPackagesText(data) {
    const lines = [];
    const pushLine = (line) => {
        if (line === undefined || line === null) return;
        lines.push(line);
    };

    data.header.forEach((line) => pushLine(line));
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");

    data.groups.forEach((group, index) => {
        pushLine(`# ${group.title || "=== 未命名组 ==="}`);
        (group.preamble || []).forEach((line) => pushLine(line));
        (group.items || []).forEach((item) => {
            if (!item.id) return;
            const parts = [];
            if (item.label) parts.push(item.label);
            if (item.description) parts.push(item.description);
            const meta = parts.join(" ").trim();
            let line = item.id.trim();
            if (meta) line += ` # ${meta}`;
            if (item.ignored) line = `##${line}`;
            else if (!item.enabled) line = `#${line}`;
            pushLine(line);
        });
        if (index !== data.groups.length - 1 && lines[lines.length - 1] !== "") {
            lines.push("");
        }
    });

    return `${lines.join("\n").replace(/\n+$/g, "")}\n`;
}

function cleanTitle(title) {
    if (!title) return "未命名组";
    const cleaned = title.replace(/^=+/g, "").replace(/=+$/g, "").trim();
    return cleaned || "未命名组";
}

function render() {
    const container = document.getElementById("groups");
    if (!container) return;
    container.innerHTML = "";

    state.groups.forEach((group) => {
        const card = document.createElement("div");
        card.className = "group-card";

        const title = document.createElement("h2");
        title.textContent = cleanTitle(group.title);
        card.appendChild(title);

        if (group.preamble && group.preamble.length) {
            const pre = document.createElement("pre");
            pre.textContent = group.preamble.join("\n");
            card.appendChild(pre);
        }

        group.items.forEach((item) => {
            if (item.ignored) return;
            const row = document.createElement("div");
            row.className = "package-row";

            const checkWrapper = document.createElement("div");
            checkWrapper.className = "package-checkbox-wrapper";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = item.enabled;
            checkbox.addEventListener("click", (e) => {
                e.stopPropagation();
                item.enabled = checkbox.checked;
            });
            checkWrapper.appendChild(checkbox);

            const info = document.createElement("div");
            info.className = "package-info";

            const labelEl = document.createElement("div");
            labelEl.className = "package-label";
            labelEl.textContent = item.label || item.id;
            info.appendChild(labelEl);

            if (item.label) {
                const idEl = document.createElement("div");
                idEl.className = "package-id";
                idEl.textContent = item.id;
                info.appendChild(idEl);
            }

            const desc = document.createElement("div");
            desc.className = "package-desc";
            desc.textContent = item.description || "无描述";
            info.appendChild(desc);

            row.appendChild(checkWrapper);
            row.appendChild(info);

            row.addEventListener("click", () => {
                checkbox.checked = !checkbox.checked;
                item.enabled = checkbox.checked;
            });

            card.appendChild(row);
        });

        container.appendChild(card);
    });
}

async function loadPackages() {
    setStatus("");
    logStep("开始加载包列表...");
    let text = "";
    let shellError = null;

    try {
        const b64 = await execCommand(`cat "${PACKAGE_FILE}" | base64 | tr -d '\\n'`);
        text = decodeBase64Utf8(b64);
        logStep(`通过 Shell(base64) 读取完成，长度: ${text.length}`);
    } catch (err) {
        shellError = err;
        logStep(`Shell base64 读取失败，尝试直接 cat: ${err.message}`);
        try {
            text = await execCommand(`cat "${PACKAGE_FILE}"`);
            logStep(`通过 Shell(cat) 读取完成，长度: ${text.length}`);
        } catch (errCat) {
            shellError = errCat;
            logStep(`Shell cat 读取失败，尝试前端副本: ${errCat.message}`);
        }
    }

    if (!text || !text.trim()) {
        try {
            text = await fetchPackagesFromWebroot();
        } catch (fallbackErr) {
            const reason = shellError ? `${shellError.message}; ${fallbackErr.message}` : fallbackErr.message;
            setStatus(`包列表加载失败：${reason}`, "error");
            logStep(`加载失败: ${reason}`, { statusLevel: "error" });
            return;
        }
    }

    const tryParse = (payload, label) => {
        const parsed = parsePackagesText(payload);
        logStep(`${label} 解析完成，分组数 ${parsed.groups.length}，文本长度: ${payload.length}`);
        return parsed;
    };

    let parsed = tryParse(text, "Shell 读取");
    if (!parsed.groups.length) {
        logStep("未解析到任何包，尝试使用前端副本重新解析");
        try {
            const fallbackText = await fetchPackagesFromWebroot();
            parsed = tryParse(fallbackText, "前端副本");
            text = fallbackText;
        } catch (fallbackErr) {
            setStatus(`前端副本读取失败：${fallbackErr.message}`, "error");
            logStep(`前端副本读取失败: ${fallbackErr.message}`, { statusLevel: "error" });
        }
    }

    state.header = parsed.header;
    state.groups = parsed.groups;
    // snapshot 当前载入时的启用状态，用于保存时计算“变动”数量
    state._snapshot = {};
    (state.groups || []).forEach((g) => {
        (g.items || []).forEach((it) => {
            if (it && it.id && !it.ignored) state._snapshot[it.id] = !!it.enabled;
        });
    });
    render();
    if (!state.groups.length) {
        const sample = text.split("\n").slice(0, 5).join("\\n");
        setStatus("未解析到任何包，请检查 packages.txt 格式", "error");
        logStep(`警告：未解析到任何包，样本预览: ${sample}`, { statusLevel: "error" });
    }
}

async function savePackages(applyImmediately) {
    if (!getBridge()) {
        const msg = "未检测到 KernelSU / WebUI X，无法保存";
        setStatus(msg, "error");
        logStep(msg, { statusLevel: "error" });
        return;
    }

    logStep(applyImmediately ? "保存并应用..." : "保存中...");
    try {
        const payload = buildPackagesText(state);
        const b64 = btoa(unescape(encodeURIComponent(payload)));
        await execCommand(`sh "${SAVE_SCRIPT}" "${b64}"`);

        // 计算“变动”数量（与加载时 snapshot 对比）
        let newDisable = 0; // 原本未屏蔽，现在勾选 -> 新屏蔽
        let newEnable = 0;  // 原本屏蔽，现在取消勾选 -> 新解除屏蔽
        (state.groups || []).forEach((g) => {
            (g.items || []).forEach((it) => {
                if (!it || !it.id || it.ignored) return;
                const prev = state._snapshot && Object.prototype.hasOwnProperty.call(state._snapshot, it.id) ? !!state._snapshot[it.id] : null;
                const curr = !!it.enabled;
                if (prev === null) return; // 无法判断的（新行）跳过
                if (!prev && curr) newDisable++;
                if (prev && !curr) newEnable++;
            });
        });

        if (applyImmediately) {
            let applyOutput = "";
            try {
                applyOutput = await execCommand(`sh "${APPLY_SCRIPT}" 2>&1`);
                if (applyOutput && applyOutput.trim()) {
                    logStep(`应用输出: ${applyOutput.trim().slice(0, 400)}`);
                }
            } catch (err) {
                const reason = err?.message || err;
                showToast("保存或应用失败：" + reason);
                setStatus(`保存或应用失败：${reason}`, "error");
                logStep("保存或应用失败: " + reason, { statusLevel: "error" });
                return;
            }

            // 尝试解析 service.sh 的统计输出
            const parsed = parseServiceSummary(applyOutput || "");
            // 优先根据变动数量显示简洁的变动信息
            let message = `保存并应用成功。新屏蔽 ${newDisable} 个组件，新解除 ${newEnable} 个组件。`;
            // 若解析到 service 输出并发现失败数，可追加说明
            if (parsed) {
                const failParts = [];
                if (parsed.disable && parsed.disable.failed) failParts.push(`屏蔽失败 ${parsed.disable.failed} 个`);
                if (parsed.enable && parsed.enable.failed) failParts.push(`解除失败 ${parsed.enable.failed} 个`);
                if (failParts.length) message += " 但部分操作失败：" + failParts.join("，") + "。";
            }
            showToast(message);
            logStep(message);
        } else {
            const message = `保存成功。新屏蔽 ${newDisable} 个组件，新解除 ${newEnable} 个组件（应用后生效）。`;
            showToast(message);
            logStep(message);
        }

        setStatus("");
        await loadPackages();
    } catch (err) {
        console.error(err);
        const reason = err?.message || err;
        showToast(`保存失败：${reason}`);
        setStatus(`保存失败：${reason}`, "error");
        logStep("保存失败: " + reason, { statusLevel: "error" });
    }
}

function parseServiceSummary(output) {
    if (!output) return null;
    try {
        const res = {
            disable: { total: 0, ok: 0, skipped: 0, failed: 0 },
            enable: { total: 0, ok: 0, skipped: 0, failed: 0 },
        };

        const disableRe = /Disable\s*-\s*total:\s*(\d+)[\s\S]*?ok:\s*(\d+)[\s\S]*?skipped[^:]*:\s*(\d+)[\s\S]*?failed:\s*(\d+)/i;
        const enableRe = /Enable\s*-\s*total:\s*(\d+)[\s\S]*?ok:\s*(\d+)[\s\S]*?skipped[^:]*:\s*(\d+)[\s\S]*?failed:\s*(\d+)/i;

        const d = output.match(disableRe);
        if (d) {
            res.disable.total = parseInt(d[1], 10);
            res.disable.ok = parseInt(d[2], 10);
            res.disable.skipped = parseInt(d[3], 10);
            res.disable.failed = parseInt(d[4], 10);
        }
        const e = output.match(enableRe);
        if (e) {
            res.enable.total = parseInt(e[1], 10);
            res.enable.ok = parseInt(e[2], 10);
            res.enable.skipped = parseInt(e[3], 10);
            res.enable.failed = parseInt(e[4], 10);
        }

        // only return if we successfully parsed at least one value
        if ((res.disable.total || res.disable.ok || res.disable.failed) || (res.enable.total || res.enable.ok || res.enable.failed)) return res;
    } catch (err) {
        // ignore parse errors
    }
    return null;
}

function initUI() {
    const saveBtn = document.getElementById("save");
    const saveApplyBtn = document.getElementById("saveApply");
    const debugEl = document.getElementById("debug");
    const debugPanel = document.getElementById("debug-panel");

    if (saveBtn) saveBtn.addEventListener("click", () => savePackages(false));
    if (saveApplyBtn) saveApplyBtn.addEventListener("click", () => savePackages(true));
    if (saveBtn) saveBtn.disabled = true;
    if (saveApplyBtn) saveApplyBtn.disabled = true;

    applySafeAreaInsets();
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", applySafeAreaInsets);
        window.visualViewport.addEventListener("scroll", applySafeAreaInsets);
    }
    window.addEventListener("resize", applySafeAreaInsets);

    if (debugPanel && debugEl) {
        debugPanel.addEventListener("toggle", () => {
            if (debugPanel.open) {
                debugEl.scrollTop = debugEl.scrollHeight;
            }
        });
        const copyBtn = document.getElementById("copyDebug");
        if (copyBtn) {
            // hide by default (unless details already open)
            copyBtn.style.display = debugPanel.open ? "inline-block" : "none";
            if (debugPanel.open) copyBtn.setAttribute("aria-hidden", "false");
            debugPanel.addEventListener("toggle", () => {
                if (debugPanel.open) {
                    copyBtn.style.display = "inline-block";
                    copyBtn.setAttribute("aria-hidden", "false");
                } else {
                    copyBtn.style.display = "none";
                    copyBtn.setAttribute("aria-hidden", "true");
                }
            });

            copyBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                e.preventDefault();
                try {
                    await navigator.clipboard.writeText(debugEl.textContent || "");
                    showToast("调试日志已复制");
                    logStep("调试日志已复制");
                } catch (err) {
                    const reason = err?.message || err;
                    showToast("复制调试日志失败: " + reason);
                    logStep("复制调试日志失败: " + reason, { statusLevel: "error" });
                }
            });
        }
    }
}

async function bootstrap() {
    initUI();
    await loadPackages();

    const bridge = await waitForBridge();
    if (!bridge) {
        setStatus("未检测到 KernelSU / WebUI X，包列表仅可浏览", "warning");
        logStep("未检测到 KernelSU / WebUI X JS API，包列表仅可浏览", { statusLevel: "warning" });
        return;
    }

    logStep(`检测到桥接: ${bridge.name}`);
    const saveBtn = document.getElementById("save");
    const saveApplyBtn = document.getElementById("saveApply");
    if (saveBtn) saveBtn.disabled = false;
    if (saveApplyBtn) saveApplyBtn.disabled = false;

    await loadPackages();
}

window.addEventListener("DOMContentLoaded", bootstrap);
