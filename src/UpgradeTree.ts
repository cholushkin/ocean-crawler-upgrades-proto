import { GameEngine, RES_EMOJI, UpgradeNodeView, UpgradeLevelView } from "./GameEngine";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100; // min-height baseline; actual height grows with content
const COL_GAP = 40; // horizontal gap between sibling nodes in the same row
const ROW_GAP = 60; // vertical gap between rows
const MARGIN = 40;

interface PositionedNode extends UpgradeNodeView {
    x: number;
    depth: number;
}

interface FinalNode extends PositionedNode {
    y: number;
    height: number;
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export class UpgradeTreeView {
    private selectedLevel: Map<string, number> = new Map();

    constructor(
        private engine: GameEngine,
        private container: HTMLElement,
        private onBuild: (id: string) => void,
        private onCheat: (id: string) => void
    ) {
        this.container.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            const cheatBtn = target.closest(".tree-cheat-btn") as HTMLButtonElement | null;
            if (cheatBtn) {
                this.onCheat(cheatBtn.getAttribute("data-id")!);
                return;
            }

            const buildBtn = target.closest(".tree-build-btn") as HTMLButtonElement | null;
            if (buildBtn && !buildBtn.disabled) {
                this.onBuild(buildBtn.getAttribute("data-id")!);
                return;
            }

            const cell = target.closest(".tree-level-cell.unlocked") as HTMLElement | null;
            if (cell) {
                const key = cell.getAttribute("data-node-key")!;
                const level = Number(cell.getAttribute("data-level"));
                if (this.selectedLevel.get(key) === level) {
                    this.selectedLevel.delete(key);
                } else {
                    this.selectedLevel.set(key, level);
                }
                this.render();
            }
        });
    }

    // Layered (Sugiyama-style) auto-layout: depth = longest path from any root (becomes the
    // row, top-to-bottom), then a few barycenter passes order each row by its parents' average
    // column position to minimize crossing lines and keep branching/merging paths readable.
    private assignPositions(nodes: UpgradeNodeView[]): PositionedNode[] {
        const byKey = new Map(nodes.map(n => [n.key, n]));
        const depthCache = new Map<string, number>();

        const depthOf = (key: string, seen: Set<string>): number => {
            if (depthCache.has(key)) return depthCache.get(key)!;
            if (seen.has(key)) return 0;
            seen.add(key);
            const node = byKey.get(key);
            if (!node || node.requires.length === 0) {
                depthCache.set(key, 0);
                return 0;
            }
            const d = 1 + Math.max(...node.requires.map(r => depthOf(r, seen)));
            depthCache.set(key, d);
            return d;
        };

        const rows: string[][] = [];
        for (const n of nodes) {
            const d = depthOf(n.key, new Set());
            (rows[d] ||= []).push(n.key);
        }

        const posInRow = new Map<string, number>();
        rows.forEach(row => row?.forEach((key, i) => posInRow.set(key, i)));

        for (let pass = 0; pass < 3; pass++) {
            for (let d = 1; d < rows.length; d++) {
                const row = rows[d];
                if (!row) continue;
                const scored = row.map(key => {
                    const node = byKey.get(key)!;
                    const parentPositions = node.requires
                        .map(r => posInRow.get(r))
                        .filter((p): p is number => p !== undefined);
                    const avg = parentPositions.length
                        ? parentPositions.reduce((a, b) => a + b, 0) / parentPositions.length
                        : posInRow.get(key)!;
                    return { key, avg };
                });
                scored.sort((a, b) => a.avg - b.avg);
                rows[d] = scored.map(s => s.key);
                rows[d].forEach((key, i) => posInRow.set(key, i));
            }
        }

        const positioned: PositionedNode[] = [];
        rows.forEach((row, depth) => {
            row?.forEach((key, i) => {
                const node = byKey.get(key)!;
                positioned.push({
                    ...node,
                    x: MARGIN + i * (NODE_WIDTH + COL_GAP),
                    depth,
                });
            });
        });
        return positioned;
    }

    public render(): void {
        const nodes = this.engine.getUpgradeNodes();
        if (nodes.length === 0) {
            this.container.innerHTML = "";
            return;
        }

        const positioned = this.assignPositions(nodes);

        // Rebuilding the canvas below momentarily leaves it with no size (children are all
        // position:absolute), which clamps the scrollable wrapper's scroll offset to 0. Restore
        // it once the canvas has its final size so a click doesn't yank the view back to the top.
        const scrollParent = this.container.parentElement;
        const scrollTop = scrollParent?.scrollTop ?? 0;
        const scrollLeft = scrollParent?.scrollLeft ?? 0;

        // Phase 1: mount nodes (positioned horizontally only) so we can measure their real
        // (variable) heights before computing row Y-offsets.
        const canvas = document.createElement("div");
        canvas.className = "tree-canvas";
        canvas.innerHTML = positioned.map(n => this.renderNode(n)).join("");

        this.container.innerHTML = "";
        this.container.appendChild(canvas);

        const elByKey = new Map<string, HTMLElement>();
        canvas.querySelectorAll<HTMLElement>(".tree-node").forEach(el => {
            elByKey.set(el.dataset.nodeKey!, el);
        });

        const maxDepth = Math.max(...positioned.map(n => n.depth));
        const rowHeights: number[] = [];
        for (let d = 0; d <= maxDepth; d++) {
            const inRow = positioned.filter(n => n.depth === d);
            rowHeights[d] = inRow.length
                ? Math.max(...inRow.map(n => elByKey.get(n.key)!.offsetHeight))
                : 0;
        }

        const rowY: number[] = [];
        let acc = MARGIN;
        for (let d = 0; d <= maxDepth; d++) {
            rowY[d] = acc;
            acc += rowHeights[d] + ROW_GAP;
        }

        const finalNodes: FinalNode[] = positioned.map(n => ({
            ...n,
            y: rowY[n.depth],
            height: elByKey.get(n.key)!.offsetHeight,
        }));

        finalNodes.forEach(n => {
            elByKey.get(n.key)!.style.top = `${n.y}px`;
        });

        const width = Math.max(...finalNodes.map(n => n.x)) + NODE_WIDTH + MARGIN;
        const height = Math.max(...finalNodes.map(n => n.y + n.height)) + MARGIN;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        // Phase 2: draw edges now that final positions/heights are known.
        const posByKey = new Map(finalNodes.map(n => [n.key, n]));
        let edgesSvg = "";
        for (const n of finalNodes) {
            for (const reqKey of n.requires) {
                const parent = posByKey.get(reqKey);
                if (!parent) continue;
                const x1 = parent.x + NODE_WIDTH / 2;
                const y1 = parent.y + parent.height;
                const x2 = n.x + NODE_WIDTH / 2;
                const y2 = n.y;
                const midY = (y1 + y2) / 2;
                const stroke = n.status !== "locked" ? "#38bdf8" : "#334155";
                edgesSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" stroke="${stroke}" stroke-width="2.5" fill="none" />`;
            }
        }
        canvas.insertAdjacentHTML("afterbegin", `<svg class="tree-edges" width="${width}" height="${height}">${edgesSvg}</svg>`);

        if (scrollParent) {
            scrollParent.scrollTop = scrollTop;
            scrollParent.scrollLeft = scrollLeft;
        }
    }

    private levelColor(level: number, maxLevel: number): string {
        const ratio = maxLevel > 1 ? (level - 1) / (maxLevel - 1) : 0;
        const lightness = 50 - ratio * 22;
        return `hsl(32, 80%, ${lightness}%)`;
    }

    private renderLevelCells(n: UpgradeNodeView): string {
        const selected = this.selectedLevel.get(n.key);
        const cells = n.levels.map(l => {
            const classes = ["tree-level-cell", l.unlocked ? "unlocked" : "locked"];
            if (selected === l.level) classes.push("selected");
            return `<span class="${classes.join(" ")}" data-node-key="${escapeAttr(n.key)}" data-level="${l.level}" title="${l.unlocked ? `Show Lvl ${l.level} details` : "Not yet unlocked"}">${l.level}</span>`;
        }).join("");
        return `<div class="tree-node-levels">${cells}</div>`;
    }

    private renderDetail(entry: UpgradeLevelView): string {
        const modsHtml = entry.modifiers.length
            ? `<div class="tree-node-mods">` +
                entry.modifiers.map(m => `↳ ${m.param}: ${m.isMultiplier ? "x" : "+"}${m.value}`).join("<br>") +
                `</div>`
            : "";
        return `
            <div class="tree-node-detail">
                <div class="tree-node-detail-desc">${escapeAttr(entry.description)}</div>
                ${modsHtml}
            </div>
        `;
    }

    private renderNode(n: PositionedNode): string {
        const classes = ["tree-node", n.isLevel ? "tree-node-level" : "tree-node-feature", `status-${n.status}`];
        let style = `left:${n.x}px; top:0px; width:${NODE_WIDTH}px; min-height:${NODE_HEIGHT}px;`;

        if (n.isLevel && n.currentLevel > 0) {
            const color = this.levelColor(n.currentLevel, n.maxLevel);
            // Background always reflects level intensity; border is left to the status
            // classes (green in-progress / maxed ring) except when "available", where the
            // level-tinted border reinforces the color-by-level cue on the buildable node.
            style += ` background:${color};`;
            if (n.status === "available") {
                style += ` border-color:${color};`;
            }
        }

        const levelBadge = n.isLevel
            ? `<span class="tree-node-level-badge">LVL ${n.currentLevel}/${n.maxLevel}</span>`
            : "";

        const cellsHtml = n.isLevel ? this.renderLevelCells(n) : "";

        let bodyHtml: string;
        if (n.status === "maxed" && !n.isLevel) {
            bodyHtml = this.renderDetail(n.levels[0]);
        } else if (n.status === "maxed") {
            bodyHtml = `<div class="tree-node-status">✔ Complete</div>`;
        } else if (n.status === "locked") {
            bodyHtml = `<div class="tree-node-status">🔒 Locked</div>`;
        } else if (n.nextEntry) {
            const costStr = Object.entries(n.nextEntry.cost)
                .map(([r, a]) => `${a}${RES_EMOJI[r] || r}`)
                .join(" ");
            const afford = this.engine.canAfford(n.nextEntry.cost);
            const inProgress = n.status === "in-progress";
            const label = inProgress ? "⏳ Building..." : (n.currentLevel > 0 ? "Upgrade" : "Build");
            const cheatBtn = inProgress
                ? `<button class="tree-cheat-btn" data-id="${n.nextEntry.id}" title="Cheat: instantly finish">⚡</button>`
                : "";
            bodyHtml = `
                <div class="tree-node-cost">${costStr}</div>
                <div class="tree-node-actions">
                    <button class="tree-build-btn" data-id="${n.nextEntry.id}" ${(!afford || inProgress) ? "disabled" : ""}>${label}</button>
                    ${cheatBtn}
                </div>
            `;
        } else {
            bodyHtml = "";
        }

        const selected = this.selectedLevel.get(n.key);
        let detailHtml = "";
        if (n.isLevel && selected !== undefined) {
            const lvl = n.levels.find(l => l.level === selected);
            if (lvl && lvl.unlocked) detailHtml = this.renderDetail(lvl);
        }

        return `
            <div class="${classes.join(" ")}" style="${style}" data-node-key="${escapeAttr(n.key)}" title="${escapeAttr(n.description)}">
                <div class="tree-node-header">
                    <strong>${n.name}</strong>
                    ${levelBadge}
                </div>
                ${cellsHtml}
                ${bodyHtml}
                ${detailHtml}
            </div>
        `;
    }
}
