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
    prepare: document.querySelector('[data-metric="prepare"]')
};
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

async function presentGraphMutation(revision, label, selection) {
    const preparationStarted = performance.now();
    const preparation = renderStressModel(
        revision,
        editor.getView(),
        selection
    );
    await preparation.presented;
    await new Promise((resolve) => requestAnimationFrame(resolve));
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
    status.textContent = `${rendererBackend} · ${label} · completing updated graph in background`;
    await preparation.prepared;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (
        revision !== loadRevision
        || editor.prepared !== preparation.prepared
    ) {
        return;
    }
    const preparationTime = performance.now() - preparationStarted;
    updateRendererMetrics();
    metrics.prepare.textContent = `${preparationTime.toFixed(1)} ms`;
    status.textContent = `${rendererBackend} · ${label} · ${number.format(model.nodes.length)} nodes · ${number.format(model.edges.length)} connections · updated in ${preparationTime.toFixed(1)} ms`;
    sizeControl.disabled = false;
    rebuildButton.disabled = false;
}

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
    model = scene.model;
    positions = scene.positions;
    copiedNodeIds = [];
    const preparationStarted = performance.now();
    const preparation = renderStressModel(
        revision,
        { zoom: 0.5, scrollLeft: 0, scrollTop: 0 }
    );
    await preparation.presented;
    await new Promise((resolve) => requestAnimationFrame(resolve));
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
    status.textContent = `${rendererBackend} · graph presented · completing in background`;
    await preparation.prepared;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (
        revision !== loadRevision
        || editor.prepared !== preparation.prepared
    ) {
        return;
    }
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
