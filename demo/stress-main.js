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
    visibleNodes: document.querySelector('[data-metric="visible-nodes"]'),
    edges: document.querySelector('[data-metric="edges"]'),
    visibleEdges: document.querySelector('[data-metric="visible-edges"]'),
    segments: document.querySelector('[data-metric="segments"]'),
    present: document.querySelector('[data-metric="present"]'),
    prepare: document.querySelector('[data-metric="prepare"]')
};
let positions = {};
let rendererBackend = "starting";
let loadRevision = 0;
let metricFrame = 0;

function updateRendererMetrics() {
    const renderer = editor.stats();
    metrics.nodes.textContent = number.format(renderer.nodeCount);
    metrics.visibleNodes.textContent = number.format(renderer.visibleNodeCount);
    metrics.edges.textContent = number.format(renderer.edgeCount);
    metrics.visibleEdges.textContent = number.format(renderer.visibleEdgeCount);
    metrics.segments.textContent = number.format(renderer.visibleEdgeSegments);
}

function scheduleRendererMetrics() {
    cancelAnimationFrame(metricFrame);
    metricFrame = requestAnimationFrame(updateRendererMetrics);
}

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
        onViewChange() {
            scheduleRendererMetrics();
        },
        onPositionsChange(nextPositions) {
            positions = { ...nextPositions };
        }
    });
    await editor.presented;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (revision !== loadRevision) return;
    const presentationTime = performance.now() - preparationStarted;
    updateRendererMetrics();
    metrics.present.textContent = `${presentationTime.toFixed(1)} ms`;
    metrics.prepare.textContent = "loading…";
    status.textContent = `${rendererBackend} · graph presented · completing in background`;
    await editor.prepared;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (revision !== loadRevision) return;
    const preparationTime = performance.now() - preparationStarted;
    updateRendererMetrics();
    metrics.prepare.textContent = `${preparationTime.toFixed(1)} ms`;
    status.textContent = `${rendererBackend} · progressive loading and viewport culling active · generated in ${generationTime.toFixed(1)} ms`;
    sizeControl.disabled = false;
    rebuildButton.disabled = false;
}

sizeControl.addEventListener("change", loadScene);
rebuildButton.addEventListener("click", loadScene);
window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(metricFrame);
    editor.destroy();
}, { once: true });

loadScene();
