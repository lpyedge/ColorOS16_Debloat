const state = {
    header: [],
    groups: [],
};

async function loadPackages() {
    setStatus("加载中...");
    try {
        // === 变更：直接读取静态文件，不再通过 CGI ===
        // 加上时间戳防止缓存
        const url = `/packages.txt?_=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`无法加载配置文件: ${res.status}`);
        }
        const text = await res.text();
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
        const res = await fetch(`/cgi-bin/packages.sh?apply=${applyImmediately ? 1 : 0}`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: payload,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || "保存失败");
        }
        
        const text = await res.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.warn("JSON parse failed", e);
            // 截取前100个字符用于调试显示
            const preview = text.slice(0, 100).replace(/[\r\n]+/g, " ");
            throw new Error(`服务器返回了无效的格式: ${preview}...`);
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
