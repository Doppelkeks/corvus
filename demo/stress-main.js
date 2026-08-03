import { createNodeEditor } from "../src/index.js";
import "../src/styles.css";
import "./styles.css";
import "./stress.css";
import {
    connectStressScenePorts,
    createStressScene,
    duplicateStressSceneNodes,
    removeStressSceneEdge,
    removeStressSceneNodes
} from "./stress-scene.js";

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
    prepare: document.querySelector('[data-metric="prepare"]'),
    liveFps: document.querySelector('[data-metric="live-fps"]'),
    liveFrame: document.querySelector('[data-metric="live-frame"]')
};
const LIVE_PAN_FRAME_COUNT = 30;
let positions = {};
let model = null;
let rendererBackend = "starting";
let loadRevision = 0;
let metricFrame = 0;
let duplicationIndex = 0;
let copiedNodeIds = [];

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

async function waitForRenderedFrame() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await editor.whenRendererIdle();
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

function reportMutationError(error) {
    status.textContent = error.message;
    console.error(error);
}

function renderStressModel(revision, viewState, selection = {}) {
    editor.update(model, {
        positions,
        viewState,
        ...selection,
        onViewChange() {
            scheduleRendererMetrics();
        },
        onPositionsChange(nextPositions) {
            positions = { ...nextPositions };
        },
        onConnectPorts(connection) {
            const result = connectStressScenePorts(model, connection);
            model = result.model;
            presentGraphMutation(revision, "connection created", {
                selectedNodeId: null,
                selectedNodeIds: [],
                selectedEdgeId: result.edge.id
            }).catch(reportMutationError);
        },
        onDeleteNode(nodeId) {
            deleteNodes(revision, [nodeId]);
        },
        onDeleteNodes(nodeIds) {
            deleteNodes(revision, nodeIds);
        },
        onDeleteEdge(edgeId) {
            deleteConnection(revision, edgeId);
        },
        onCopyNodes(nodeIds) {
            copiedNodeIds = [...nodeIds];
            status.textContent = `${number.format(nodeIds.length)} node${nodeIds.length === 1 ? "" : "s"} copied`;
        },
        onDuplicateNodes(nodeIds) {
            duplicateNodes(revision, nodeIds);
        },
        onPasteNodes({ graphPoint }) {
            pasteNodes(revision, graphPoint);
        }
    });
    return {
        presented: editor.presented,
        prepared: editor.prepared
    };
}

function clearSelection() {
    return {
        selectedNodeId: null,
        selectedNodeIds: [],
        selectedEdgeId: null
    };
}

function deleteConnection(revision, edgeId) {
    if (revision !== loadRevision) return;
    const nextModel = removeStressSceneEdge(model, edgeId);
    if (nextModel === model) return;
    model = nextModel;
    presentGraphMutation(revision, "connection removed", clearSelection())
        .catch(reportMutationError);
}

function deleteNodes(revision, nodeIds) {
    if (revision !== loadRevision) return;
    const result = removeStressSceneNodes(model, positions, nodeIds);
    if (result.model === model) return;
    model = result.model;
    positions = result.positions;
    const label = nodeIds.length === 1
        ? "node removed"
        : `${number.format(nodeIds.length)} nodes removed`;
    presentGraphMutation(revision, label, clearSelection())
        .catch(reportMutationError);
}

function duplicateNodes(revision, nodeIds, offset = undefined) {
    if (revision !== loadRevision || nodeIds.length === 0) return;
    duplicationIndex += 1;
    const result = duplicateStressSceneNodes(
        model,
        positions,
        nodeIds,
        duplicationIndex,
        offset
    );
    if (result.model === model) return;
    model = result.model;
    positions = result.positions;
    copiedNodeIds = [...nodeIds];
    const label = result.nodeIds.length === 1
        ? "node duplicated"
        : `${number.format(result.nodeIds.length)} nodes duplicated`;
    presentGraphMutation(revision, label, {
        selectedNodeId: result.nodeIds.at(-1),
        selectedNodeIds: result.nodeIds,
        selectedEdgeId: null
    }).catch(reportMutationError);
}

function pasteNodes(revision, graphPoint) {
    const positionedIds = copiedNodeIds.filter((nodeId) => positions[nodeId]);
    if (positionedIds.length === 0) return;
    let minimumX = Infinity;
    let minimumY = Infinity;
    for (let index = 0; index < positionedIds.length; index += 1) {
        const position = positions[positionedIds[index]];
        minimumX = Math.min(minimumX, position.x);
        minimumY = Math.min(minimumY, position.y);
    }
    duplicateNodes(revision, positionedIds, {
        x: graphPoint.x - minimumX,
        y: graphPoint.y - minimumY
    });
}

function preparationIsCurrent(revision, preparation) {
    return revision === loadRevision
        && editor.presented === preparation.presented
        && editor.prepared === preparation.prepared;
}

async function measureLivePan(revision, preparation) {
    const startingView = editor.getView();
    const frameTimes = new Float64Array(LIVE_PAN_FRAME_COUNT);
    for (let index = 0; index < LIVE_PAN_FRAME_COUNT; index += 1) {
        if (!preparationIsCurrent(revision, preparation)) return null;
        const frameStarted = performance.now();
        editor.setView({
            ...startingView,
            scrollLeft: startingView.scrollLeft + (index % 2) * 0.75
        });
        await waitForRenderedFrame();
        frameTimes[index] = performance.now() - frameStarted;
    }
    editor.setView(startingView);
    await waitForRenderedFrame();
    if (!preparationIsCurrent(revision, preparation)) return null;
    let totalFrameTime = 0;
    for (let index = 0; index < frameTimes.length; index += 1) {
        totalFrameTime += frameTimes[index];
    }
    const frameTime = totalFrameTime / frameTimes.length;
    return {
        frameTime,
        fps: 1000 / frameTime
    };
}

async function finishLiveBenchmark(revision, preparation, label) {
    metrics.liveFps.textContent = "measuring…";
    metrics.liveFrame.textContent = "forced camera frames";
    status.textContent = `${rendererBackend} · full graph ready · measuring live pan rendering`;
    const live = await measureLivePan(revision, preparation);
    if (!live) return false;
    metrics.liveFps.textContent = `${live.fps.toFixed(0)} FPS`;
    metrics.liveFrame.textContent = `${live.frameTime.toFixed(1)} ms / frame`;
    const renderer = editor.stats();
    status.textContent = `${rendererBackend} · ${label} · ${number.format(renderer.visibleNodeCount)} nodes in view · ${live.fps.toFixed(0)} FPS live pan`;
    sizeControl.disabled = false;
    rebuildButton.disabled = false;
    return true;
}

async function presentGraphMutation(revision, label, selection) {
    const preparationStarted = performance.now();
    const preparation = renderStressModel(
        revision,
        editor.getView(),
        selection
    );
    await preparation.presented;
    await waitForRenderedFrame();
    if (
        revision !== loadRevision
        || editor.presented !== preparation.presented
    ) {
        return;
    }
    const presentationTime = performance.now() - preparationStarted;
    updateRendererMetrics();
    metrics.present.textContent = `${presentationTime.toFixed(1)} ms`;
    metrics.prepare.textContent = "loading…";
    metrics.liveFps.textContent = "waiting…";
    metrics.liveFrame.textContent = "full graph first";
    status.textContent = `${rendererBackend} · ${label} · completing updated graph in background`;
    await preparation.prepared;
    await waitForRenderedFrame();
    if (
        revision !== loadRevision
        || editor.prepared !== preparation.prepared
    ) {
        return;
    }
    const preparationTime = performance.now() - preparationStarted;
    updateRendererMetrics();
    metrics.prepare.textContent = `${preparationTime.toFixed(1)} ms`;
    await finishLiveBenchmark(revision, preparation, label);
}

async function loadScene() {
    const revision = ++loadRevision;
    const count = Number(sizeControl.value);
    sizeControl.disabled = true;
    rebuildButton.disabled = true;
    status.textContent = `Building ${number.format(count)} nodes…`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const loadStarted = performance.now();
    const scene = createStressScene(count);
    model = scene.model;
    positions = scene.positions;
    copiedNodeIds = [];
    const preparation = renderStressModel(
        revision,
        { zoom: 0.5, scrollLeft: 0, scrollTop: 0 }
    );
    await preparation.presented;
    await waitForRenderedFrame();
    if (
        revision !== loadRevision
        || editor.presented !== preparation.presented
    ) {
        return;
    }
    const presentationTime = performance.now() - loadStarted;
    updateRendererMetrics();
    metrics.present.textContent = `${presentationTime.toFixed(1)} ms`;
    metrics.prepare.textContent = "loading…";
    metrics.liveFps.textContent = "waiting…";
    metrics.liveFrame.textContent = "full graph first";
    status.textContent = `${rendererBackend} · first view interactive · completing full graph in background`;
    await preparation.prepared;
    await waitForRenderedFrame();
    if (
        revision !== loadRevision
        || editor.prepared !== preparation.prepared
    ) {
        return;
    }
    const preparationTime = performance.now() - loadStarted;
    updateRendererMetrics();
    metrics.prepare.textContent = `${preparationTime.toFixed(1)} ms`;
    await finishLiveBenchmark(
        revision,
        preparation,
        `${number.format(model.nodes.length)} nodes ready`
    );
}

sizeControl.addEventListener("change", loadScene);
rebuildButton.addEventListener("click", loadScene);
window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(metricFrame);
    editor.destroy();
}, { once: true });

loadScene();
