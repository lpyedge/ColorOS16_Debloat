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
        
        // 尝试解析 JSON 响应
        let result;
        try {
            result = await res.json();
        } catch (e) {
            // 如果解析失败，可能是旧版脚本返回了纯文本，或者发生了其他错误
            console.warn("JSON parse failed, falling back to text check", e);
            // 重新读取流是不可能的，但如果 res.json() 失败，通常意味着响应不是 JSON
            // 这里我们假设如果状态码是 200 且解析失败，可能是旧版逻辑返回了 "Save OK"
            // 但由于我们已经修改了 packages.sh，这里应该能正常解析
            throw new Error("服务器返回了无效的格式");
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
        const commentIndex = working.indexOf("  #");
        if (commentIndex !== -1) {
            comment = working.slice(commentIndex + 3).trim();
            pkgPart = working.slice(0, commentIndex).trim();
        } else {
            const hashIndex = working.indexOf("#");
            if (hashIndex !== -1) {
                comment = working.slice(hashIndex + 1).trim();
                pkgPart = working.slice(0, hashIndex).trim();
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
                line += `  # ${item.comment.trim()}`;
            }
            if (!item.enabled) {
                line = `# ${line}`;
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
