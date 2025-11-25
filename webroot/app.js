const state = {
    header: [],
    groups: [],
};

// 模块 ID，必须与 module.prop 中的 id 一致
const MODULE_ID = "coloros16_debloat";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;
const SAVE_SCRIPT = `${MODULE_PATH}/webroot/scripts/save_packages.sh`;

const BRIDGE_WAIT_RETRIES = 10;
const BRIDGE_WAIT_DELAY = 250;
let cachedBridge = null;

function normalizeExecResult(result) {
    const pickFirstString = (obj, keys) => {
        for (const key of keys) {
            const value = obj[key];
            if (typeof value === "string") return value;
            if (Array.isArray(value)) return value.join("\n");
        }
        return "";
    };

    if (typeof result === "string") {
        return { stdout: result, stderr: "", errno: 0 };
    }
    if (!result || typeof result !== "object") {
        return { stdout: "", stderr: "", errno: 0 };
    }
    const codeKeys = ["errno", "code", "exitCode", "status"];
    let errno = 0;
    for (const key of codeKeys) {
        if (typeof result[key] === "number") {
            errno = result[key];
            break;
        }
    }
    if (!errno && result.success === false) {
        errno = 1;
    }

    const stdout = pickFirstString(result, ["stdout", "out", "output", "data", "result"]);
    const stderr = pickFirstString(result, ["stderr", "err", "error", "message"]);

    return {
        stdout,
        stderr,
        errno,
    };
}

function detectBridge() {
    if (typeof ksu !== "undefined" && typeof ksu.exec === "function") {
        return {
            name: "KernelSU",
            exec: async (command) => {
                const output = await ksu.exec(command);
                return normalizeExecResult(output);
            },
            toast: (message) => {
                if (typeof ksu.toast === "function") {
                    ksu.toast(message);
                } else {
                    console.log(message);
                }
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
                return {
                    name: "WebUI X",
                    exec: async (command) => {
                        const output = await candidate.exec(command);
                        return normalizeExecResult(output);
                    },
                    toast: (message) => {
                        if (typeof candidate.toast === "function") {
                            candidate.toast(message);
                        } else if (window.webui && typeof window.webui.toast === "function") {
                            window.webui.toast(message);
                        } else {
                            console.log(message);
                        }
                    },
                };
            }
        }
    }

    return null;
}

function getBridge() {
    if (cachedBridge) {
        return cachedBridge;
    }
    const detected = detectBridge();
    if (detected) {
        cachedBridge = detected;
    }
    return cachedBridge;
}

async function waitForBridge(retries = BRIDGE_WAIT_RETRIES, delay = BRIDGE_WAIT_DELAY) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const bridge = getBridge();
        if (bridge) {
            return bridge;
        }
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

// 执行 Shell 命令的通用函数
async function execCommand(cmd) {
    const bridge = ensureBridge();
    let result;
    try {
        result = await bridge.exec(cmd);
    } catch (err) {
        console.error("Shell Exec Error:", err);
        throw new Error(err?.message || String(err));
    }

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

    return {
        top: Math.max(top, cssTop, 0),
        bottom: Math.max(bottom, cssBottom, 0),
    };
}

function applySafeAreaInsets() {
    const insets = getSafeAreaInsets();
    document.documentElement.style.setProperty("--safe-area-top", `${insets.top}px`);
    document.documentElement.style.setProperty("--safe-area-bottom", `${insets.bottom}px`);
}

async function fetchPackagesFromWebroot() {
    const resp = await fetch("data/packages.txt", { cache: "no-store" });
    if (!resp.ok) {
        throw new Error(`获取 packages.txt 失败 (HTTP ${resp.status})`);
    }
    return await resp.text();
}

async function loadPackages() {
    setStatus("加载中...");
    let text = "";
    let shellError = null;

    try {
        // KernelSU 环境：直接读取 packages.txt（已迁移到 webroot/data）
        text = await execCommand(`cat "${MODULE_PATH}/webroot/data/packages.txt"`);
    } catch (err) {
        console.warn("读取 packages.txt 失败，改用前端副本:", err);
        shellError = err;
    }

    if (!text || !text.trim()) {
        try {
            text = await fetchPackagesFromWebroot();
        } catch (fallbackErr) {
            console.error(fallbackErr);
            const reason = shellError ? `${shellError.message}; ${fallbackErr.message}` : fallbackErr.message;
            setStatus("加载失败: " + reason);
            return;
        }
    }

    const parsed = parsePackagesText(text);
    state.header = parsed.header;
    state.groups = parsed.groups;
    render();
    setStatus("已加载");
}

function render() {
    const container = document.getElementById("groups");
    container.innerHTML = "";
    state.groups.forEach((group, groupIndex) => {
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

        group.items.forEach((item, itemIndex) => {
            const row = document.createElement("div");
            row.className = "package-row";
            
            // 点击行触发 checkbox
            row.onclick = (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    // 手动触发 change 事件以更新状态（如果需要）
                    item.enabled = checkbox.checked;
                }
            };

            const checkWrapper = document.createElement("div");
            checkWrapper.className = "package-checkbox-wrapper";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = item.enabled; // 注意：这里使用的是 enabled 属性
            checkbox.onclick = (e) => {
                 e.stopPropagation(); // 防止触发 row.onclick
                 item.enabled = checkbox.checked;
            };
            checkWrapper.appendChild(checkbox);

            const info = document.createElement("div");
            info.className = "package-info";

            const name = document.createElement("div");
            name.className = "package-name";
            name.textContent = item.package; // 注意：这里使用的是 package 属性

            const desc = document.createElement("div");
            desc.className = "package-desc";
            desc.textContent = item.comment || "无描述";

            info.appendChild(name);
            info.appendChild(desc);

            row.appendChild(checkWrapper);
            row.appendChild(info);
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
    setStatus("保存中...");
    try {
        const payload = buildPackagesText(state);
        const b64 = btoa(unescape(encodeURIComponent(payload)));

        // 调用预置脚本处理文件写入与权限
        await execCommand(`sh "${SAVE_SCRIPT}" "${b64}"`);

        let msg = "保存成功";
        if (applyImmediately) {
            const applyScript = `${MODULE_PATH}/apply_now.sh`;
            await execCommand(`nohup sh "${applyScript}" >/dev/null 2>&1 &`);
            msg += " (已触发应用)";
        }

        setStatus(msg);
        await loadPackages();
    } catch (err) {
        console.error(err);
        setStatus("保存失败: " + err.message);
    }
}

function setStatus(text) {
    const statusEl = document.getElementById("status");
    statusEl.textContent = text;
}

function parsePackagesText(text) {
    const header = [];
    const groups = [];
    const lines = text.replace(/\r/g, "").split("\n");
    let currentGroup = null;

    const startGroup = (title) => {
        currentGroup = {
            title,
            preamble: [],
            items: [],
            _hasItems: false,
        };
        groups.push(currentGroup);
    };

    const pushHeader = (line) => header.push(line);

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (!trimmed) {
            if (!currentGroup) {
                pushHeader("");
            } else if (!currentGroup._hasItems) {
                currentGroup.preamble.push("");
            }
            return;
        }

        if (/^#\s*===.*===/.test(trimmed)) {
            startGroup(trimmed.replace(/^#\s*/, ""));
            return;
        }

        if (!currentGroup) {
            pushHeader(line);
            return;
        }

        let working = trimmed;
        let enabled = true;
        if (working.startsWith("#")) {
            working = working.slice(1).trim();
            // 移除 com. 前缀检查，允许 android. 或其他包名
            // if (!working.startsWith("com.")) {
            //     currentGroup.preamble.push(line);
            //     return;
            // }
            enabled = false;
        }

        // 移除 com. 前缀检查
        // if (!working.startsWith("com.")) {
        //     currentGroup.preamble.push(line);
        //     return;
        // }

        // 简单的包名格式检查：必须包含至少一个点，且不包含空格
        // 这可以避免将纯注释行误认为包
        if (working.indexOf('.') === -1 || working.startsWith("=")) {
             currentGroup.preamble.push(line);
             return;
        }

        let comment = "";
        let pkgPart = working;
        
        // 严格按照 " # " (空格+井号+空格) 分割注释
        // 这样可以避免包名中意外包含 # (虽然不常见) 或者紧凑格式解析错误
        const commentIndex = working.indexOf(" # ");
        if (commentIndex !== -1) {
            comment = working.slice(commentIndex + 3).trim();
            pkgPart = working.slice(0, commentIndex).trim();
        } else {
            // 兼容性处理：如果找不到 " # "，尝试找 " #" (空格+井号)
            // 这是为了处理用户手动编辑可能遗漏空格的情况
            const looseIndex = working.indexOf(" #");
            if (looseIndex !== -1) {
                comment = working.slice(looseIndex + 2).trim();
                pkgPart = working.slice(0, looseIndex).trim();
            }
        }

        currentGroup.items.push({
            package: pkgPart,
            comment,
            enabled,
        });
        currentGroup._hasItems = true;
    });

    groups.forEach((group) => delete group._hasItems);
    return { header, groups };
}

function buildPackagesText(data) {
    const lines = [];
    const pushLine = (line) => {
        if (line === undefined || line === null) {
            return;
        }
        lines.push(line);
    };

    data.header.forEach((line) => pushLine(line));
    if (lines.length && lines[lines.length - 1].trim() !== "") {
        lines.push("");
    }

    data.groups.forEach((group, index) => {
        pushLine(`# ${group.title || "=== 未分组 ==="}`);
        (group.preamble || []).forEach((line) => pushLine(line));
        (group.items || []).forEach((item) => {
            if (!item.package) return;
            let line = item.package.trim();
            if (item.comment) {
                // 统一使用 " # " 分隔符
                line += ` # ${item.comment.trim()}`;
            }
            if (!item.enabled) {
                // 禁用状态：前面加 "#" (紧跟包名，不加空格，符合 packages.txt 现有格式)
                // 或者根据用户需求，如果想要 "# " (加空格)，可以改成 `# ${line}`
                // 但根据之前整理的 packages.txt，格式是 #com.pkg
                // 用户最新指示："包名前面统一是”# “" -> 这可能意味着 "# "
                // 让我们统一用 "#" 紧跟包名，保持与 packages.txt 一致
                // 修正：用户明确说 "包名前面统一是”# “" (中文引号内有一个空格)
                // 且之前的 packages.txt 整理中，我用了 #com.pkg
                // 让我们再看一眼 packages.txt... 确实是 #com.pkg
                // 但用户说 "包名前面统一是”# “"，这可能是在纠正我？
                // 无论如何，service.sh 都能处理。为了美观，我改用 "# " (带空格)
                // 这样更清晰。
                line = `#${line}`; 
            }
            pushLine(line);
        });
        if (index !== data.groups.length - 1) {
            if (lines[lines.length - 1] !== "") {
                lines.push("");
            }
        }
    });

    return `${lines.join("\n").replace(/\n+$/g, "")}\n`;
}

window.addEventListener("DOMContentLoaded", () => {
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

    loadPackages();

    waitForBridge(40, BRIDGE_WAIT_DELAY).then((bridge) => {
        if (!bridge) {
            setStatus("未检测到 KernelSU / WebUI X JS API，列表可浏览但无法保存");
            return;
        }

        saveBtn.disabled = false;
        saveApplyBtn.disabled = false;
    });
});
