export interface CutsceneDef {
    id: string;
    imageUrl: string;
    duration: number; // In seconds
}

export class CutsceneManager {
    private cutscenes: Map<string, CutsceneDef> = new Map();
    private overlayEl = document.getElementById("cutscene-overlay")!;
    private imageEl = document.getElementById("cutscene-image") as HTMLImageElement;
    private circleEl = document.getElementById("skip-circle")!;

    private isHolding: boolean = false;
    private onCompleteCallback: (() => void) | null = null;

    private currentDuration: number = 0;
    private elapsedTime: number = 0;
    private isPlaying: boolean = false;
    private lastTime: number = 0;

    constructor(cutsceneData: CutsceneDef[]) {
        cutsceneData.forEach(c => this.cutscenes.set(c.id, c));
        this.setupListeners();
    }

    private setupListeners() {
        const startHold = () => { if (this.isPlaying) this.isHolding = true; };
        const endHold = () => { this.isHolding = false; };

        this.overlayEl.addEventListener("mousedown", startHold);
        this.overlayEl.addEventListener("touchstart", startHold);

        window.addEventListener("mouseup", endHold);
        window.addEventListener("touchend", endHold);
        window.addEventListener("mouseleave", endHold);
    }

    public play(id: string, onComplete: () => void) {
        const scene = this.cutscenes.get(id);
        if (!scene) {
            console.error(`Cutscene ${id} not found!`);
            onComplete();
            return;
        }

        this.onCompleteCallback = onComplete;
        this.imageEl.src = scene.imageUrl;
        this.currentDuration = scene.duration;
        this.elapsedTime = 0;

        this.overlayEl.style.display = "flex";
        this.isPlaying = true;
        this.lastTime = performance.now();

        requestAnimationFrame((t) => this.loop(t));
    }

    private loop(currentTime: number) {
        if (!this.isPlaying) return;

        let deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        // Fast-forward time if holding mouse
        if (this.isHolding) deltaTime *= 100;

        this.elapsedTime += deltaTime;

        const percent = Math.min((this.elapsedTime / this.currentDuration) * 100, 100);
        this.circleEl.style.background = `conic-gradient(#10b981 ${percent}%, #1e293b 0%)`;

        if (this.elapsedTime >= this.currentDuration) {
            this.finish();
        } else {
            requestAnimationFrame((t) => this.loop(t));
        }
    }

    private finish() {
        this.isPlaying = false;
        this.isHolding = false;
        this.overlayEl.style.display = "none";

        if (this.onCompleteCallback) {
            this.onCompleteCallback();
            this.onCompleteCallback = null;
        }
    }
}