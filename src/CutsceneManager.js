export class CutsceneManager {
    cutscenes = new Map();
    overlayEl = document.getElementById("cutscene-overlay");
    imageEl = document.getElementById("cutscene-image");
    circleEl = document.getElementById("skip-circle");
    isHolding = false;
    onCompleteCallback = null;
    currentDuration = 0;
    elapsedTime = 0;
    isPlaying = false;
    lastTime = 0;
    constructor(cutsceneData) {
        cutsceneData.forEach(c => this.cutscenes.set(c.id, c));
        this.setupListeners();
    }
    setupListeners() {
        const startHold = () => { if (this.isPlaying)
            this.isHolding = true; };
        const endHold = () => { this.isHolding = false; };
        this.overlayEl.addEventListener("mousedown", startHold);
        this.overlayEl.addEventListener("touchstart", startHold);
        window.addEventListener("mouseup", endHold);
        window.addEventListener("touchend", endHold);
        window.addEventListener("mouseleave", endHold);
    }
    play(id, onComplete) {
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
    loop(currentTime) {
        if (!this.isPlaying)
            return;
        let deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        // Fast-forward time if holding mouse
        if (this.isHolding)
            deltaTime *= 100;
        this.elapsedTime += deltaTime;
        const percent = Math.min((this.elapsedTime / this.currentDuration) * 100, 100);
        this.circleEl.style.background = `conic-gradient(#10b981 ${percent}%, #1e293b 0%)`;
        if (this.elapsedTime >= this.currentDuration) {
            this.finish();
        }
        else {
            requestAnimationFrame((t) => this.loop(t));
        }
    }
    finish() {
        this.isPlaying = false;
        this.isHolding = false;
        this.overlayEl.style.display = "none";
        if (this.onCompleteCallback) {
            this.onCompleteCallback();
            this.onCompleteCallback = null;
        }
    }
}
