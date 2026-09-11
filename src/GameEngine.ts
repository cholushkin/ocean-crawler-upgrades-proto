import upgradesData from "../data/upgrades.json";
import divesData from "../data/dives.json";

export enum Resource { PEL="PEL", PLS="PLS", COG="COG", XEN="XEN", VOD="VOD", THA="THA" }
export interface Modifier { param: string; value: number; isMultiplier: boolean; }
export interface Upgrade {
    id: string;
    name: string;
    description: string;
    duration: number;
    cost: Record<string, number>;
    requires: string[];
    modifiers?: Modifier[];
    node?: string;
    level?: number;
}
export interface DiveTierDef { tier: number; duration: number; rewards: Record<string, [number, number]>; }

export interface ActiveTask {
    id: string;
    name: string;
    duration: number;
    timeRemaining: number;
    type: "upgrade" | "dive";
    depthLevel?: number;
}

export interface UpgradeLevelView {
    level: number;
    id: string;
    description: string;
    modifiers: Modifier[];
    unlocked: boolean;
}

export interface UpgradeNodeView {
    key: string;
    name: string;
    description: string;
    isLevel: boolean;
    currentLevel: number;
    maxLevel: number;
    requires: string[];
    nextEntry?: Upgrade;
    status: "locked" | "available" | "in-progress" | "maxed";
    levels: UpgradeLevelView[];
}

export const RES_EMOJI: Record<string, string> = { PEL: "🪨", PLS: "🔋", COG: "💠", XEN: "🦠", VOD: "💎", THA: "🧿" };

export class GameEngine {
    public inventory: Record<string, number> = { PEL: 0, PLS: 0, COG: 0, XEN: 0, VOD: 0, THA: 0 };
    public prestige: number = 0;

    // Core Progression
    public parameters: Record<string, number> = { maxDepthTier: 1, baseIntegrity: 100, scannerEfficiency: 1, batteryCapacity: 100 };
    public unlockedUpgrades: Set<string> = new Set();
    public completedNodeOrder: string[] = [];
    public logs: string[] = [];

    public activeTasks: ActiveTask[] = [];

    // Data Maps
    public availableUpgrades: Map<string, Upgrade> = new Map((upgradesData as unknown as Upgrade[]).map(u => [u.id, u]));
    public diveTiers: Map<number, DiveTierDef> = new Map((divesData as unknown as DiveTierDef[]).map(d => [d.tier, d]));

    // Upgrades grouped into visual "nodes" - a group with >1 entry is a level-upgrade node,
    // sharing one tree node across levels; a group with exactly 1 entry is a feature node.
    private nodeGroups: Map<string, Upgrade[]> = new Map();
    private idToGroup: Map<string, string> = new Map();

    public totalWaitTime: number = 0;
    public totalUpgrades: number = 0;
    public totalDives: number = 0;

    constructor() {
        for (const u of this.availableUpgrades.values()) {
            const key = this.groupKeyOf(u);
            if (!this.nodeGroups.has(key)) this.nodeGroups.set(key, []);
            this.nodeGroups.get(key)!.push(u);
        }
        for (const [key, entries] of this.nodeGroups) {
            entries.sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
            for (const e of entries) this.idToGroup.set(e.id, key);
        }
    }

    private groupKeyOf(u: Upgrade): string {
        return u.node ?? u.id;
    }

    private pushLog(message: string): void {
        const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
        this.logs.push(`[${timeStr}] ${message}`);
        if (this.logs.length > 50) this.logs.shift(); // Keep log size manageable
    }

    public canAfford(cost: Record<string, number>): boolean {
        return Object.entries(cost).every(([res, amt]) => (this.inventory[res] || 0) >= amt);
    }

    public startDive(depthLevel: number): boolean {
        if (this.activeTasks.some(t => t.type === "dive")) return false;
        const diveDef = this.diveTiers.get(depthLevel);
        if (!diveDef) return false;

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

    private executeDiveRewards(depthLevel: number): void {
        const diveDef = this.diveTiers.get(depthLevel);
        if (!diveDef) return;

        const gains: string[] = [];
        for (const [res, [min, max]] of Object.entries(diveDef.rewards)) {
            const amount = Math.floor(Math.random() * (max - min + 1)) + min;
            if (this.inventory[res] !== undefined) {
                this.inventory[res] += amount;
                if (amount > 0) gains.push(`+${amount}${RES_EMOJI[res] || res}`);
            }
        }

        this.prestige += depthLevel * 250;
        this.pushLog(`Tier ${depthLevel} outcome: ${gains.join(" ")}`);
    }

    public startUpgrade(upgradeId: string): boolean {
        const upgrade = this.availableUpgrades.get(upgradeId);
        if (!upgrade || this.unlockedUpgrades.has(upgradeId)) return false;
        if (this.activeTasks.some(t => t.id === upgradeId)) return false;
        if (upgrade.requires.some(req => !this.unlockedUpgrades.has(req))) return false;
        if (!this.canAfford(upgrade.cost)) return false;

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
    public getUpgradeNodes(): UpgradeNodeView[] {
        const nodes: UpgradeNodeView[] = [];
        for (const [key, entries] of this.nodeGroups) {
            const isLevel = entries.length > 1;
            const currentLevel = entries.filter(e => this.unlockedUpgrades.has(e.id)).length;
            const nextEntry = entries.find(e => !this.unlockedUpgrades.has(e.id));
            const activeEntry = nextEntry ?? entries[entries.length - 1];

            const externalRequires = new Set<string>();
            for (const e of entries) {
                for (const r of e.requires) {
                    const rGroup = this.idToGroup.get(r) ?? r;
                    if (rGroup !== key) externalRequires.add(rGroup);
                }
            }

            let status: UpgradeNodeView["status"];
            if (!nextEntry) {
                status = "maxed";
            } else if (this.activeTasks.some(t => t.id === nextEntry.id)) {
                status = "in-progress";
            } else if (nextEntry.requires.every(r => this.unlockedUpgrades.has(r))) {
                status = "available";
            } else {
                status = "locked";
            }

            const levels: UpgradeLevelView[] = entries.map((e, i) => ({
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

    public getCompletedDisplay(): { name: string; level: number; isLevel: boolean }[] {
        return this.completedNodeOrder.map(key => {
            const entries = this.nodeGroups.get(key)!;
            return {
                name: entries[0].name,
                level: entries.filter(e => this.unlockedUpgrades.has(e.id)).length,
                isLevel: entries.length > 1,
            };
        });
    }

    public tick(deltaTimeInSeconds: number): void {
        for (let i = this.activeTasks.length - 1; i >= 0; i--) {
            const task = this.activeTasks[i];
            task.timeRemaining -= deltaTimeInSeconds;
            if (task.timeRemaining <= 0) {
                this.completeTask(i);
            }
        }
    }

    public forceCompleteTask(taskId: string): void {
        const index = this.activeTasks.findIndex(t => t.id === taskId);
        if (index !== -1) {
            this.completeTask(index);
        }
    }

    private completeTask(index: number): void {
        const task = this.activeTasks[index];
        this.totalWaitTime += task.duration;

        if (task.type === "upgrade") {
            this.unlockedUpgrades.add(task.id);
            this.totalUpgrades++;

            const upgradeDef = this.availableUpgrades.get(task.id)!;
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
                    } else {
                        this.parameters[mod.param] += mod.value;
                        return `[+${mod.value} ${mod.param}]`;
                    }
                });

                const entries = this.nodeGroups.get(groupKey)!;
                const isLevel = entries.length > 1;
                const level = entries.filter(e => this.unlockedUpgrades.has(e.id)).length;
                const levelTag = isLevel ? ` (LVL ${level})` : "";
                this.pushLog(`Upgrade ${upgradeDef.name}${levelTag}: ${modStrings.join(" ")}`);
            }
        } else if (task.type === "dive") {
            this.executeDiveRewards(task.depthLevel!);
            this.totalDives++;
        }

        this.activeTasks.splice(index, 1);
    }
}
