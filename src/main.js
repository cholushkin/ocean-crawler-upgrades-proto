import { GameEngine, RES_EMOJI } from "./GameEngine";
import { UpgradeTreeView } from "./UpgradeTree";
import { CutsceneManager } from "./CutsceneManager";
import cutsceneData from "../data/cutscenes.json";
const engine = new GameEngine();
const emojiMap = RES_EMOJI;
// Tooltip Definitions
const resourceDescriptions = {
    PEL: "Pelagite: Common, used for structures, repairs, crafting.",
    PLS: "Plasmite: Consume for power, fuel, generators, etc.",
    COG: "Cognite: Blue substance used to upgrade the AI, computer core, drones.",
    XEN: "Xenoplasm: Harvested from alien organisms for medicine, biotech, crafting.",
    VOD: "Voidsteel: Very expensive, extremely rare late-game resource.",
    THA: "Thalassyn: Almost mythical, like something that shouldn't exist."
};
// DOM Elements
const resContainer = document.getElementById("resources");
const prestigeLabel = document.getElementById("prestige");
const upgradeList = document.getElementById("upgrade-list");
const schedulerList = document.getElementById("scheduler-list");
const bottomPanel = document.getElementById("bottom-panel");
const gameUI = document.getElementById("game-ui");
const openTreeBtn = document.getElementById("open-tree-btn");
const treeBackBtn = document.getElementById("tree-back-btn");
const treeCanvas = document.getElementById("tree-canvas");
let treeOverlayOpen = false;
const treeView = new UpgradeTreeView(engine, treeCanvas, (id) => {
    if (engine.startUpgrade(id)) {
        updateSchedulerUI();
        updateUI();
    }
}, (id) => {
    engine.forceCompleteTask(id);
    updateSchedulerUI();
    updateUI();
});
// --- Event Listeners ---
openTreeBtn.addEventListener("click", () => {
    treeOverlayOpen = true;
    gameUI.classList.add("tree-open");
    treeView.render();
});
treeBackBtn.addEventListener("click", () => {
    treeOverlayOpen = false;
    gameUI.classList.remove("tree-open");
});
schedulerList.addEventListener("click", (e) => {
    const target = e.target.closest(".active-task");
    if (target) {
        const id = target.getAttribute("data-task-id");
        if (id) {
            engine.forceCompleteTask(id);
            updateSchedulerUI();
            updateUI();
        }
    }
});
// --- Formatting Helpers ---
function getPrestigeLevel(score) {
    if (score >= 25000)
        return 5;
    if (score >= 15000)
        return 4;
    if (score >= 10000)
        return 3;
    if (score >= 5000)
        return 2;
    if (score >= 1000)
        return 1;
    return 0;
}
function formatTime(totalSeconds) {
    const d = Math.floor(totalSeconds / (3600 * 24));
    const h = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${d.toString().padStart(2, '0')}d:${h.toString().padStart(2, '0')}h:${m.toString().padStart(2, '0')}m:${s.toString().padStart(2, '0')}s`;
}
// --- UI Rendering ---
function drawDiveButtons() {
    bottomPanel.innerHTML = "";
    const isDiving = engine.activeTasks.some(t => t.type === "dive");
    engine.diveTiers.forEach((diveDef, tier) => {
        // Enforce the progressive tier unlocking logic based on our parameter
        if (tier > (engine.parameters.maxDepthTier || 1))
            return;
        const btn = document.createElement("button");
        btn.className = "dive-btn";
        btn.disabled = isDiving;
        // Build the tooltip (Resource Ranges + Duration)
        const rewardStrings = Object.entries(diveDef.rewards).map(([res, range]) => {
            return `${emojiMap[res] || res} ${range[0]}-${range[1]}`;
        });
        const tooltipText = `Duration: ${diveDef.duration}s\n\nRewards:\n${rewardStrings.join("\n")}`;
        btn.setAttribute("title", tooltipText);
        // Compact button display
        const btnStatus = isDiving ? "Diving..." : `DIVE<br>Tier ${tier}`;
        btn.innerHTML = `<strong>🌊 ${btnStatus}</strong>`;
        btn.addEventListener("click", () => {
            if (engine.startDive(tier)) {
                updateSchedulerUI();
                updateUI();
            }
        });
        bottomPanel.appendChild(btn);
    });
}
function drawUpgrades() {
    upgradeList.innerHTML = "";
    engine.availableUpgrades.forEach(upg => {
        if (engine.unlockedUpgrades.has(upg.id))
            return;
        if (upg.requires.some(req => !engine.unlockedUpgrades.has(req)))
            return;
        const card = document.createElement("div");
        card.className = "upgrade-card";
        const costStr = Object.entries(upg.cost).map(([r, a]) => `${a} ${emojiMap[r]}`).join(" | ");
        const afford = engine.canAfford(upg.cost);
        const levelTag = upg.level ? ` <span class="level-tag">Lvl ${upg.level}</span>` : "";
        // Build Modifiers Text (if any exist)
        let modsHtml = "";
        if (upg.modifiers && upg.modifiers.length > 0) {
            modsHtml = `<div style="font-size: 0.8rem; color: #10b981; margin-top: 5px;">` +
                upg.modifiers.map(m => `↳ ${m.param}: ${m.isMultiplier ? 'x' : '+'}${m.value}`).join("<br>") +
                `</div>`;
        }
        card.innerHTML = `
            <strong>${upg.name}</strong>${levelTag}<br>
            <span style="font-size: 0.85em; color: #cbd5e1; display: block; margin: 6px 0; font-style: italic;">
                ${upg.description}
            </span>
            ${modsHtml}
            <small style="display:block; margin-top:5px;">⏱ ${upg.duration}s | ${costStr}</small>
            <button class="buy-btn" data-id="${upg.id}" style="margin-top: 8px;" ${afford ? "" : "disabled"}>Build</button>
        `;
        upgradeList.appendChild(card);
    });
    document.querySelectorAll(".buy-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const id = e.target.getAttribute("data-id");
            if (engine.startUpgrade(id)) {
                updateSchedulerUI();
                updateUI();
            }
        });
    });
}
function drawCenterColumns() {
    const statsCol = document.getElementById("stats-content");
    const upgradesCol = document.getElementById("completed-upgrades-content");
    const logsCol = document.getElementById("game-log-content");
    // 1. Render Parameters
    statsCol.innerHTML = Object.entries(engine.parameters)
        .map(([key, val]) => `<div class="stat-entry"><span>${key}</span><strong>${val}</strong></div>`)
        .join("");
    // 2. Render Completed Upgrades (level upgrades update in place: "Name [LVL n]")
    upgradesCol.innerHTML = engine.getCompletedDisplay()
        .map(({ name, level, isLevel }) => `<div class="completed-upg-entry">✔️ ${name}${isLevel ? ` [LVL ${level}]` : ""}</div>`)
        .join("");
    // 3. Render Game Logs (Reverse to show newest on top)
    logsCol.innerHTML = [...engine.logs].reverse()
        .map(msg => `<div class="log-entry">${msg}</div>`)
        .join("");
}
function updateUI() {
    resContainer.innerHTML = Object.entries(engine.inventory)
        .map(([res, amt]) => `<span class="resource-item" title="${resourceDescriptions[res]}">${emojiMap[res]} ${amt}</span>`).join("");
    prestigeLabel.innerHTML = `<span title="Prestige" style="cursor: help;">🔱 L${getPrestigeLevel(engine.prestige)} (${engine.prestige})</span>`;
    drawDiveButtons();
    drawUpgrades();
    drawCenterColumns();
    if (treeOverlayOpen)
        treeView.render();
}
function updateSchedulerUI() {
    schedulerList.innerHTML = `
        <div id="stats-container" style="margin-bottom:15px; font-weight:bold; color:#10b981; border-bottom: 2px solid #334155; padding-bottom: 10px;">
            <div id="time-tracker">Total Wait Time: ${formatTime(engine.totalWaitTime)}</div>
            <div id="upgrades-tracker">Total Upgrades: ${engine.totalUpgrades}</div>
            <div id="dives-tracker">Dives Count: ${engine.totalDives}</div>
        </div>
    `;
    engine.activeTasks.forEach(task => {
        schedulerList.innerHTML += `
            <div class="active-task" data-task-id="${task.id}" title="Click to instantly finish! (Cheat)">
                <strong>${task.name}</strong>
                <div id="timer-${task.id}">${Math.ceil(task.timeRemaining)}s remaining</div>
                <div style="background:#0f172a; height:6px; margin-top:5px; border-radius:3px; overflow:hidden;">
                    <div id="bar-${task.id}" style="background:#10b981; height:100%; width:0%; border-radius:3px;"></div>
                </div>
            </div>
        `;
    });
}
// --- Game Loop ---
let lastTime = performance.now();
let previousTaskCount = -1;
function gameLoop(currentTime) {
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    engine.tick(deltaTime);
    if (engine.activeTasks.length !== previousTaskCount) {
        updateSchedulerUI();
        updateUI();
        previousTaskCount = engine.activeTasks.length;
    }
    engine.activeTasks.forEach(task => {
        const timerEl = document.getElementById(`timer-${task.id}`);
        const barEl = document.getElementById(`bar-${task.id}`);
        if (timerEl && barEl) {
            timerEl.innerText = `${Math.ceil(task.timeRemaining)}s remaining`;
            const percent = Math.max(0, 100 - (task.timeRemaining / task.duration) * 100);
            barEl.style.width = `${percent}%`;
        }
    });
    const tracker = document.getElementById("time-tracker");
    if (tracker)
        tracker.innerText = `Total Wait Time: ${formatTime(engine.totalWaitTime)}`;
    const upgTracker = document.getElementById("upgrades-tracker");
    if (upgTracker)
        upgTracker.innerText = `Total Upgrades: ${engine.totalUpgrades}`;
    const diveTracker = document.getElementById("dives-tracker");
    if (diveTracker)
        diveTracker.innerText = `Dives Count: ${engine.totalDives}`;
    requestAnimationFrame(gameLoop);
}
// --- Initialization & Boot Sequence ---
const cutsceneManager = new CutsceneManager(cutsceneData);
updateUI();
updateSchedulerUI();
cutsceneManager.play("intro", () => {
    gameUI.style.display = "flex";
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
});
