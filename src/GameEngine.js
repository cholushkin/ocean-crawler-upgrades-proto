import upgradesData from "../data/upgrades.json";
import divesData from "../data/dives.json";
export var Resource;
(function (Resource) {
    Resource["PEL"] = "PEL";
    Resource["PLS"] = "PLS";
    Resource["COG"] = "COG";
    Resource["XEN"] = "XEN";
    Resource["VOD"] = "VOD";
    Resource["THA"] = "THA";
})(Resource || (Resource = {}));
export const RES_EMOJI = { PEL: "🪨", PLS: "🔋", COG: "💠", XEN: "🦠", VOD: "💎", THA: "🧿" };
export class GameEngine {
    inventory = { PEL: 0, PLS: 0, COG: 0, XEN: 0, VOD: 0, THA: 0 };
    prestige = 0;
    // Core Progression
    parameters = { maxDepthTier: 1, baseIntegrity: 100, scannerEfficiency: 1, batteryCapacity: 100 };
    unlockedUpgrades = new Set();
    completedNodeOrder = [];
    logs = [];
    activeTasks = [];
    // Data Maps
    availableUpgrades = new Map(upgradesData.map(u => [u.id, u]));
    diveTiers = new Map(divesData.map(d => [d.tier, d]));
    // Upgrades grouped into visual "nodes" - a group with >1 entry is a level-upgrade node,
    // sharing one tree node across levels; a group with exactly 1 entry is a feature node.
    nodeGroups = new Map();
    idToGroup = new Map();
    totalWaitTime = 0;
    totalUpgrades = 0;
    totalDives = 0;
    constructor() {
        for (const u of this.availableUpgrades.values()) {
            const key = this.groupKeyOf(u);
            if (!this.nodeGroups.has(key))
                this.nodeGroups.set(key, []);
            this.nodeGroups.get(key).push(u);
        }
        for (const [key, entries] of this.nodeGroups) {
            entries.sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
            for (const e of entries)
                this.idToGroup.set(e.id, key);
        }
    }
    groupKeyOf(u) {
        return u.node ?? u.id;
    }
    pushLog(message) {
        const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.logs.push(`[${timeStr}] ${message}`);
        if (this.logs.length > 50)
            this.logs.shift(); // Keep log size manageable
    }
    canAfford(cost) {
        return Object.entries(cost).every(([res, amt]) => (this.inventory[res] || 0) >= amt);
    }
    startDive(depthLevel) {
        if (this.activeTasks.some(t => t.type === "dive"))
            return false;
        const diveDef = this.diveTiers.get(depthLevel);
        if (!diveDef)
            return false;
        this.activeTasks.push({
            id: `dive_task_${depthLevel}`,
            name: `Ocean Dive (Tier ${depthLevel})`,
            duration: diveDef.duration,
            timeRemaining: diveDef.duration,
            type: "dive",
            depthLevel: depthLevel
        });
        return true;
    }
    executeDiveRewards(depthLevel) {
        const diveDef = this.diveTiers.get(depthLevel);
        if (!diveDef)
            return;
        const gains = [];
        for (const [res, [min, max]] of Object.entries(diveDef.rewards)) {
            const amount = Math.floor(Math.random() * (max - min + 1)) + min;
            if (this.inventory[res] !== undefined) {
                this.inventory[res] += amount;
                if (amount > 0)
                    gains.push(`+${amount}${RES_EMOJI[res] || res}`);
            }
        }
        this.prestige += depthLevel * 250;
        this.pushLog(`Tier ${depthLevel} outcome: ${gains.join(" ")}`);
    }
    startUpgrade(upgradeId) {
        const upgrade = this.availableUpgrades.get(upgradeId);
        if (!upgrade || this.unlockedUpgrades.has(upgradeId))
            return false;
        if (this.activeTasks.some(t => t.id === upgradeId))
            return false;
        if (upgrade.requires.some(req => !this.unlockedUpgrades.has(req)))
            return false;
        if (!this.canAfford(upgrade.cost))
            return false;
        for (const [res, amt] of Object.entries(upgrade.cost)) {
            this.inventory[res] -= amt;
        }
        this.activeTasks.push({
            id: upgrade.id,
            name: upgrade.name,
            duration: upgrade.duration,
            timeRemaining: upgrade.duration,
            type: "upgrade"
        });
        return true;
    }
    // Groups upgrades sharing a `node` key into a single visual tree node. A node with
    // multiple entries is a level-upgrade (same feature, repeatedly improved); a node with
    // one entry is a plain feature upgrade. Requires pointing at another entry in the same
    // group are treated as an internal level-ordering chain, not a tree dependency edge.
    getUpgradeNodes() {
        const nodes = [];
        for (const [key, entries] of this.nodeGroups) {
            const isLevel = entries.length > 1;
            const currentLevel = entries.filter(e => this.unlockedUpgrades.has(e.id)).length;
            const nextEntry = entries.find(e => !this.unlockedUpgrades.has(e.id));
            const activeEntry = nextEntry ?? entries[entries.length - 1];
            const externalRequires = new Set();
            for (const e of entries) {
                for (const r of e.requires) {
                    const rGroup = this.idToGroup.get(r) ?? r;
                    if (rGroup !== key)
                        externalRequires.add(rGroup);
                }
            }
            let status;
            if (!nextEntry) {
                status = "maxed";
            }
            else if (this.activeTasks.some(t => t.id === nextEntry.id)) {
                status = "in-progress";
            }
            else if (nextEntry.requires.every(r => this.unlockedUpgrades.has(r))) {
                status = "available";
            }
            else {
                status = "locked";
            }
            const levels = entries.map((e, i) => ({
                level: e.level ?? i + 1,
                id: e.id,
                description: e.description,
                modifiers: e.modifiers ?? [],
                unlocked: this.unlockedUpgrades.has(e.id),
            }));
            nodes.push({
                key,
                name: entries[0].name,
                description: activeEntry.description,
                isLevel,
                currentLevel,
                maxLevel: entries.length,
                requires: [...externalRequires],
                nextEntry,
                status,
                levels,
            });
        }
        return nodes;
    }
    getCompletedDisplay() {
        return this.completedNodeOrder.map(key => {
            const entries = this.nodeGroups.get(key);
            return {
                name: entries[0].name,
                level: entries.filter(e => this.unlockedUpgrades.has(e.id)).length,
                isLevel: entries.length > 1,
            };
        });
    }
    tick(deltaTimeInSeconds) {
        for (let i = this.activeTasks.length - 1; i >= 0; i--) {
            const task = this.activeTasks[i];
            task.timeRemaining -= deltaTimeInSeconds;
            if (task.timeRemaining <= 0) {
                this.completeTask(i);
            }
        }
    }
    forceCompleteTask(taskId) {
        const index = this.activeTasks.findIndex(t => t.id === taskId);
        if (index !== -1) {
            this.completeTask(index);
        }
    }
    completeTask(index) {
        const task = this.activeTasks[index];
        this.totalWaitTime += task.duration;
        if (task.type === "upgrade") {
            this.unlockedUpgrades.add(task.id);
            this.totalUpgrades++;
            const upgradeDef = this.availableUpgrades.get(task.id);
            const groupKey = this.groupKeyOf(upgradeDef);
            if (!this.completedNodeOrder.includes(groupKey)) {
                this.completedNodeOrder.push(groupKey);
            }
            if (upgradeDef.modifiers && upgradeDef.modifiers.length > 0) {
                const modStrings = upgradeDef.modifiers.map(mod => {
                    if (this.parameters[mod.param] === undefined) {
                        this.parameters[mod.param] = mod.isMultiplier ? 1 : 0;
                    }
                    if (mod.isMultiplier) {
                        this.parameters[mod.param] *= mod.value;
                        return `[x${mod.value} ${mod.param}]`;
                    }
                    else {
                        this.parameters[mod.param] += mod.value;
                        return `[+${mod.value} ${mod.param}]`;
                    }
                });
                const entries = this.nodeGroups.get(groupKey);
                const isLevel = entries.length > 1;
                const level = entries.filter(e => this.unlockedUpgrades.has(e.id)).length;
                const levelTag = isLevel ? ` (LVL ${level})` : "";
                this.pushLog(`Upgrade ${upgradeDef.name}${levelTag}: ${modStrings.join(" ")}`);
            }
        }
        else if (task.type === "dive") {
            this.executeDiveRewards(task.depthLevel);
            this.totalDives++;
        }
        this.activeTasks.splice(index, 1);
    }
}
