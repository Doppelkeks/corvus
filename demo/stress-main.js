import { createNodeEditor } from "../src/index.js";
import "../src/styles.css";
import "./styles.css";
import "./stress.css";
import { createStressScene } from "./stress-scene.js";

const number = new Intl.NumberFormat("en-US");
const container = document.querySelector("#editor");
const sizeControl = document.querySelector("#stress-size");
const rebuildButton = document.querySelector('[data-action="rebuild"]');
const status = document.querySelector("#stress-status");
const metrics = {
    nodes: document.querySelector('[data-metric="nodes"]'),
    edges: document.querySelector('[data-metric="edges"]'),
    segments: document.querySelector('[data-metric="segments"]'),
    prepare: document.querySelector('[data-metric="prepare"]')
};
let positions = {};
let rendererBackend = "starting";
let loadRevision = 0;

const editor = createNodeEditor(container, {
    accent: "#b8c1ca",
    onRendererChange(renderer) {
        rendererBackend = renderer.backend === "error"
            ? "unavailable"
            : renderer.backend;
    },
    onError(error) {
        rendererBackend = "unavailable";
        status.textContent = error.message;
        console.error(error);
    }
});

async function loadScene() {
    const revision = ++loadRevision;
    const count = Number(sizeControl.value);
    sizeControl.disabled = true;
    rebuildButton.disabled = true;
    status.textContent = `Building ${number.format(count)} nodes…`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const generationStarted = performance.now();
    const scene = createStressScene(count);
    const generationTime = performance.now() - generationStarted;
    positions = scene.positions;
    const preparationStarted = performance.now();
    editor.update(scene.model, {
        positions,
        viewState: { zoom: 0.5, scrollLeft: 0, scrollTop: 0 },
        onPositionsChange(nextPositions) {
            positions = { ...nextPositions };
        }
    });
    await editor.prepared;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (revision !== loadRevision) return;
    const preparationTime = performance.now() - preparationStarted;
    const renderer = editor.stats();
    metrics.nodes.textContent = number.format(renderer.nodeCount);
    metrics.edges.textContent = number.format(renderer.edgeCount);
    metrics.segments.textContent = number.format(renderer.edgeSegments);
    metrics.prepare.textContent = `${preparationTime.toFixed(1)} ms`;
    status.textContent = `${rendererBackend} · generated in ${generationTime.toFixed(1)} ms · one viewport-sized canvas`;
    sizeControl.disabled = false;
    rebuildButton.disabled = false;
}

sizeControl.addEventListener("change", loadScene);
rebuildButton.addEventListener("click", loadScene);
window.addEventListener("beforeunload", () => editor.destroy(), { once: true });

loadScene();
