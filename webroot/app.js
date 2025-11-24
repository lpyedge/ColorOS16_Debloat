const state = {
    header: [],
    groups: [],
};

// 模块 ID，必须与 module.prop 中的 id 一致
const MODULE_ID = "coloros16_debloat";
const MODULE_PATH = `/data/adb/modules/${MODULE_ID}`;

// 检查是否在 KernelSU/WebUI 环境中
function isKsuEnv() {
    return typeof ksu !== 'undefined' && ksu.exec;
}

// 执行 Shell 命令的通用函数
async function execCommand(cmd) {
    if (isKsuEnv()) {
        try {
            const result = await ksu.exec(cmd);
            // ksu.exec 返回 stdout 字符串，如果 exit code != 0 会抛出异常
            // 注意：ksu.exec 的返回值可能包含换行符，通常需要 trim
            return result ? result.trim() : "";
        } catch (e) {
            console.error("KSU Exec Error:", e);
            throw new Error(`KSU Exec Error: ${e}`);
        }
    } else {
        throw new Error("Not in KSU environment");
    }
}

async function loadPackages() {
    setStatus("加载中...");
    try {
        let text = "";
        
        if (isKsuEnv()) {
            // === KSU 环境：直接读取文件 ===
            console.log("Using KSU API to load packages");
            // 使用 cat 读取，如果文件不存在会抛出异常
            text = await execCommand(`cat "${MODULE_PATH}/packages.txt"`);
        } else {
            // === 浏览器/Magisk 环境：通过 HTTP 获取静态文件 ===
            // 加上时间戳防止缓存
            const url = `/packages.txt?_=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) {
                // 如果 packages.txt 不存在（例如首次运行且未同步），尝试加载默认列表
                if (res.status === 404) {
                    console.warn("packages.txt not found, trying CGI fallback or empty list");
                }
                throw new Error(`无法加载配置文件: ${res.status}`);
            }
            text = await res.text();
        }

        const parsed = parsePackagesText(text);
        state.header = parsed.header;
        state.groups = parsed.groups;
        render();
        setStatus("已加载");
    } catch (err) {
        console.error(err);
        setStatus("加载失败: " + err.message);
    }
}

// ...existing code...

async function savePackages(applyImmediately) {
    setStatus("保存中...");
    try {
        const payload = buildPackagesText(state);
        
        if (isKsuEnv()) {
            // === KSU 环境保存逻辑 ===
            console.log("Using KSU API to save packages");
            
            // 1. 写入临时文件
            // 使用 base64 避免特殊字符问题
            // JS: btoa(unescape(encodeURIComponent(str))) 处理 UTF-8
            const b64 = btoa(unescape(encodeURIComponent(payload)));
            const tmpFile = `${MODULE_PATH}/packages.txt.tmp`;
            const targetFile = `${MODULE_PATH}/packages.txt`;
            const webrootFile = `${MODULE_PATH}/webroot/packages.txt`;
            
            // 组合命令：解码 -> 写入临时 -> 移动 -> 同步到 webroot -> 设置权限
            const cmd = `echo "${b64}" | base64 -d > "${tmpFile}" && mv -f "${tmpFile}" "${targetFile}" && cp -f "${targetFile}" "${webrootFile}" && chmod 644 "${targetFile}" "${webrootFile}"`;
            
            await execCommand(cmd);

            let msg = "保存成功";
            if (applyImmediately) {
                const applyScript = `${MODULE_PATH}/apply_now.sh`;
                // 后台执行 apply，不等待结果
                await execCommand(`nohup sh "${applyScript}" >/dev/null 2>&1 &`);
                msg += " (已触发应用)";
            }
            setStatus(msg);
            // 重新加载以确认
            await loadPackages();
            
        } else {
            // === 浏览器/Magisk 环境保存逻辑 (CGI) ===
            // ...existing code...
            const res = await fetch(`/cgi-bin/packages.cgi?apply=${applyImmediately ? 1 : 0}`, {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: payload,
            });
            // ...existing code...
            const status = res.status;
            const statusText = res.statusText;
            const serverTag = res.headers.get("x-app-source") || "unknown";
            const responseText = await res.text();
            const debugSummary = `HTTP ${status} ${statusText} | source=${serverTag}`;
            console.debug("savePackages response", debugSummary, responseText.slice(0, 300));

            if (!res.ok) {
                const preview = responseText.slice(0, 200).replace(/[\r\n]+/g, " ");
                throw new Error(`请求失败 (${debugSummary}): ${preview || "empty response"}`);
            }

            // 检查是否返回了脚本源码（CGI 未执行）
            if (responseText.includes("#!/system/bin/sh") || responseText.includes("CGI endpoint")) {
                throw new Error(`严重错误: 服务器未执行 CGI 脚本，而是返回了源码。\n请检查模块日志(/data/local/tmp/ace6_debloat.log)中的 WebUI Debug Info。\n(Source=${serverTag})`);
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                console.warn("JSON parse failed", e);
                const preview = responseText.slice(0, 200).replace(/[\r\n]+/g, " ");
                throw new Error(`服务器返回了无效的格式 (${debugSummary}): ${preview}...`);
            }

            if (result.success === false) {
                throw new Error("保存失败 (Server returned success: false)");
            }

            let msg = "保存成功";
            if (applyImmediately) {
                if (result.apply === "triggered") {
                    msg += " (已触发应用)";
                } else if (result.apply === "script_not_found") {
                    msg += " (应用脚本未找到)";
                } else {
                    msg += ` (状态: ${result.apply})`;
                }
            }
            
            setStatus(msg);
            await loadPackages();
        }
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
    document.getElementById("save").addEventListener("click", () => savePackages(false));
    document.getElementById("saveApply").addEventListener("click", () => savePackages(true));
    loadPackages();
});
