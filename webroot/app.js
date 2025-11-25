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

// apatch 兼容：缺少 ksu 时尝试映射
if (typeof window !== "undefined" && window.apatch && !window.ksu) {
    window.ksu = window.apatch;
}

function logStep(message) {
    console.log("[WebUI]", message);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = message;
    const debugEl = document.getElementById("debug");
    if (debugEl) {
        const time = new Date().toLocaleTimeString();
        debugEl.textContent += `[${time}] ${message}\n`;
        debugEl.scrollTop = debugEl.scrollHeight;
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
        throw new Error("未检测到 KernelSU 或 WebUI X JS API，请在支持的管理器里打开 WebUI");
    }
    return bridge;
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

async function loadPackages() {
    logStep("开始加载包列表...");
    let text = "";
    let shellError = null;

    try {
        // 用 base64 读取，避免桥接输出被截断
        const b64 = await execCommand(`base64 "${PACKAGE_FILE}"`);
        text = decodeURIComponent(escape(atob(b64)));
        logStep(`通过 Shell(base64) 读取 packages.txt 成功，长度: ${text.length}`);
    } catch (err) {
        shellError = err;
        logStep(`Shell base64 读取失败，尝试直接 cat: ${err.message}`);
        try {
            text = await execCommand(`cat "${PACKAGE_FILE}"`);
            logStep(`通过 Shell(cat) 读取 packages.txt 成功，长度: ${text.length}`);
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
            logStep(`加载失败: ${reason}`);
            return;
        }
    }

    const tryParse = (payload, label) => {
        const parsed = parsePackagesText(payload);
        logStep(`${label} 解析完成，分组数: ${parsed.groups.length}，文本长度: ${payload.length}`);
        return parsed;
    };

    let parsed = tryParse(text, "Shell 读取");
    if (!parsed.groups.length) {
        // 解析失败时强制回退到前端副本再试
        logStep("未解析到分组，尝试使用前端副本重新解析");
        try {
            const fallbackText = await fetchPackagesFromWebroot();
            parsed = tryParse(fallbackText, "前端副本");
            text = fallbackText;
        } catch (fallbackErr) {
            logStep(`前端副本读取失败: ${fallbackErr.message}`);
        }
    }

    state.header = parsed.header;
    state.groups = parsed.groups;
    render();
    if (!state.groups.length) {
        const sample = text.split("\n").slice(0, 10).join("\\n");
        logStep(`警告：未解析到任何分组，请检查 packages.txt 标题格式（# === xxx ===）；预览前10行: ${sample}`);
    }
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

            const name = document.createElement("div");
            name.className = "package-name";
            name.textContent = item.package;

            const desc = document.createElement("div");
            desc.className = "package-desc";
            desc.textContent = item.comment || "无描述";

            info.appendChild(name);
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

function cleanTitle(title) {
    if (!title) return "未命名分组";
    return title.replace(/^=+/g, "").replace(/=+$/g, "").trim();
}

async function savePackages(applyImmediately) {
    if (!getBridge()) {
        logStep("未检测到 KernelSU / WebUI X，无法保存");
        return;
    }
    logStep(applyImmediately ? "保存并应用..." : "保存中...");
    try {
        const payload = buildPackagesText(state);
        const b64 = btoa(unescape(encodeURIComponent(payload)));
        await execCommand(`sh "${SAVE_SCRIPT}" "${b64}"`);

        let msg = "保存成功";
        if (applyImmediately) {
            const applyOutput = await execCommand(`sh "${APPLY_SCRIPT}" 2>&1`);
            msg += " (已执行应用)";
            if (applyOutput && applyOutput.trim()) {
                logStep(`应用输出: ${applyOutput.trim().slice(0, 400)}`);
            }
        }

        logStep(msg);
        await loadPackages();
    } catch (err) {
        console.error(err);
        logStep("保存失败: " + err.message);
    }
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

    const pushHeader = (line) => header.push(line);

    lines.forEach((line, idx) => {
        const original = line;
        const trimmed = line.replace(/^\uFEFF/, "").trim();

        if (!trimmed) {
            if (!currentGroup) pushHeader("");
            else if (!currentGroup._hasItems) currentGroup.preamble.push("");
            return;
        }

        // 允许前导 BOM、多个 #、以及标题前后有空格
        const titleMatch = trimmed.match(/^\s*#\s*===.*===\s*$/) || (trimmed.includes("===") && /^#+/.test(trimmed));
        if (titleMatch) {
            const cleaned = trimmed.replace(/^\s*#\s*/, "").trim();
            startGroup(cleaned);
            return;
        }

        if (!currentGroup) {
            pushHeader(original);
            return;
        }

        let working = trimmed;
        let enabled = true;
        if (working.startsWith("#")) {
            working = working.slice(1).trim();
            enabled = false;
        }

        if (working.indexOf(".") === -1 || working.startsWith("=")) {
            currentGroup.preamble.push(original);
            return;
        }

        let comment = "";
        let pkgPart = working;
        const commentIndex = working.indexOf(" # ");
        if (commentIndex !== -1) {
            comment = working.slice(commentIndex + 3).trim();
            pkgPart = working.slice(0, commentIndex).trim();
        } else {
            const looseIndex = working.indexOf(" #");
            if (looseIndex !== -1) {
                comment = working.slice(looseIndex + 2).trim();
                pkgPart = working.slice(0, looseIndex).trim();
            }
        }

        if (!pkgPart) {
            logStep(`警告：第 ${idx + 1} 行解析为空，已跳过`);
            return;
        }

        currentGroup.items.push({ package: pkgPart, comment, enabled });
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
        pushLine(`# ${group.title || "=== 未分组 ==="}`);
        (group.preamble || []).forEach((line) => pushLine(line));
        (group.items || []).forEach((item) => {
            if (!item.package) return;
            let line = item.package.trim();
            if (item.comment) line += ` # ${item.comment.trim()}`;
            if (!item.enabled) line = `#${line}`;
            pushLine(line);
        });
        if (index !== data.groups.length - 1 && lines[lines.length - 1] !== "") {
            lines.push("");
        }
    });

    return `${lines.join("\n").replace(/\n+$/g, "")}\n`;
}

function initUI() {
    const saveBtn = document.getElementById("save");
    const saveApplyBtn = document.getElementById("saveApply");

    saveBtn.addEventListener("click", () => savePackages(false));
    saveApplyBtn.addEventListener("click", () => savePackages(true));
    saveBtn.disabled = true;
    saveApplyBtn.disabled = true;

    applySafeAreaInsets();
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", applySafeAreaInsets);
        window.visualViewport.addEventListener("scroll", applySafeAreaInsets);
    }
    window.addEventListener("resize", applySafeAreaInsets);
}

async function bootstrap() {
    initUI();
    await loadPackages();

    const bridge = await waitForBridge();
    if (!bridge) {
        logStep("未检测到 KernelSU / WebUI X JS API，列表可浏览但无法保存");
        return;
    }

    logStep(`检测到桥接: ${bridge.name}`);
    const saveBtn = document.getElementById("save");
    const saveApplyBtn = document.getElementById("saveApply");
    saveBtn.disabled = false;
    saveApplyBtn.disabled = false;

    // 桥接就绪后再读一次，确保实时文件
    await loadPackages();
}

window.addEventListener("DOMContentLoaded", bootstrap);
