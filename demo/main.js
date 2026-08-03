import {
    createDockLayoutController,
    createEdgeId,
    createNodeEditor,
    createNodeInspector
} from "../src/index.js";
import "../src/styles.css";
import "./styles.css";

let nextNodeNumber = 1;
let positions = {};
let selectedNodeId = "validate";
let selectedNodeIds = new Set([selectedNodeId]);
let selectedEdgeId = null;
let rendererBackend = "starting";

let model = {
    id: "corvus-example",
    label: "Corvus example",
    nodes: [
        {
            id: "request",
            label: "Request",
            type: "source",
            category: "source",
            inputs: [],
            outputs: [{ id: "value", label: "Value", type: "value" }],
            summary: [{ label: "method", value: "GET" }]
        },
        {
            id: "validate",
            label: "Validate",
            type: "process",
            category: "process",
            inputs: [{ id: "input", label: "Input", type: "value" }],
            outputs: [{ id: "value", label: "Value", type: "value" }],
            summary: [{ label: "rules", value: "3" }]
        },
        {
            id: "response",
            label: "Response",
            type: "output",
            category: "output",
            terminal: true,
            inputs: [{ id: "input", label: "Input", type: "value" }],
            outputs: [],
            summary: [{ label: "status", value: "200" }]
        }
    ],
    edges: [
        {
            id: "request-to-validate",
            type: "value",
            from: { nodeId: "request", port: "value" },
            to: { nodeId: "validate", port: "input" }
        },
        {
            id: "validate-to-response",
            type: "value",
            from: { nodeId: "validate", port: "value" },
            to: { nodeId: "response", port: "input" }
        }
    ]
};

const container = document.querySelector("#editor");
const stats = document.querySelector("#graph-stats");
const inspector = createNodeInspector(document.querySelector("#inspector"));
const dockLayout = createDockLayoutController(document.querySelector("#workspace"), {
    storageKey: "corvus.example.docks.v1",
    panels: [{
        id: "inspector",
        label: "Inspector",
        element: document.querySelector(".corvus-inspector-panel"),
        defaultDock: "right",
        minWidth: 240,
        minHeight: 280,
        floatRect: { x: 860, y: 24, width: 320, height: 540 }
    }]
});
const editor = createNodeEditor(container, {
    onRendererChange(status) {
        rendererBackend = status.backend === "error"
            ? "unavailable"
            : status.backend;
        updateStats();
    },
    onError(error) {
        rendererBackend = "unavailable";
        updateStats(error.message);
        console.error(error);
    }
});

function updateStats(message = "") {
    const details = `${model.nodes.length} nodes · ${model.edges.length} connections · ${rendererBackend}`;
    stats.textContent = message ? `${details} · ${message}` : details;
}

function updateInspector(focus = false) {
    inspector.update(model, {
        selectedNodeId,
        selectedNodeIds,
        selectedEdgeId
    });
    if (focus) dockLayout.focusPanel("inspector");
}

function updateEditor() {
    editor.update(model, {
        positions,
        selectedNodeId,
        selectedNodeIds,
        selectedEdgeId,
        onSelectNode(nodeId) {
            selectedNodeId = nodeId;
            selectedNodeIds = new Set([nodeId].filter(Boolean));
            selectedEdgeId = null;
            updateInspector(true);
        },
        onSelectNodes(nodeIds, { primaryNodeId }) {
            selectedNodeId = primaryNodeId;
            selectedNodeIds = new Set(nodeIds);
            selectedEdgeId = null;
            updateInspector(true);
        },
        onSelectEdge(edgeId) {
            selectedNodeId = null;
            selectedNodeIds.clear();
            selectedEdgeId = edgeId;
            updateInspector(true);
        },
        onClearSelection() {
            selectedNodeId = null;
            selectedNodeIds.clear();
            selectedEdgeId = null;
            updateInspector();
        },
        onMoveNodes(nextPositions) {
            positions = { ...positions, ...nextPositions };
        },
        onPositionsChange(nextPositions) {
            positions = { ...nextPositions };
        },
        onConnectPorts(connection) {
            const edge = {
                type: connection.from.type,
                from: {
                    nodeId: connection.from.nodeId,
                    port: connection.from.port
                },
                to: {
                    nodeId: connection.to.nodeId,
                    port: connection.to.port
                }
            };
            edge.id = createEdgeId(edge);
            const retainedEdges = model.edges.filter((entry) =>
                entry.id !== edge.id
                && !(
                    entry.to.nodeId === edge.to.nodeId
                    && entry.to.port === edge.to.port
                ));
            model = { ...model, edges: [...retainedEdges, edge] };
            selectedEdgeId = edge.id;
            selectedNodeId = null;
            selectedNodeIds.clear();
            updateEditor();
        },
        onDeleteNode(nodeId) {
            deleteNodes([nodeId]);
        },
        onDeleteNodes(nodeIds) {
            deleteNodes(nodeIds);
        },
        onDeleteEdge(edgeId) {
            model = {
                ...model,
                edges: model.edges.filter((edge) => edge.id !== edgeId)
            };
            selectedEdgeId = null;
            updateEditor();
        }
    });
    updateInspector();
    updateStats();
}

function deleteNodes(nodeIds) {
    const deletedIds = new Set(nodeIds);
    model = {
        ...model,
        nodes: model.nodes.filter((node) => !deletedIds.has(node.id)),
        edges: model.edges.filter((edge) =>
            !deletedIds.has(edge.from.nodeId)
            && !deletedIds.has(edge.to.nodeId))
    };
    positions = Object.fromEntries(Object.entries(positions).filter(
        ([nodeId]) => !deletedIds.has(nodeId)));
    selectedNodeId = null;
    selectedNodeIds.clear();
    updateEditor();
}

function addNode() {
    const number = nextNodeNumber++;
    const id = `step-${number}`;
    model = {
        ...model,
        nodes: [...model.nodes, {
            id,
            label: `Step ${number}`,
            type: "process",
            category: "process",
            inputs: [{ id: "input", label: "Input", type: "value" }],
            outputs: [{ id: "value", label: "Value", type: "value" }],
            summary: [{ label: "mode", value: "ready" }]
        }]
    };
    selectedNodeId = id;
    selectedNodeIds = new Set([id]);
    selectedEdgeId = null;
    updateEditor();
}

document.querySelector('[data-action="add-node"]').addEventListener("click", addNode);
document.querySelector('[data-action="auto-layout"]').addEventListener("click", () => editor.autoLayout());
document.querySelector('[data-action="reset-view"]').addEventListener("click", () => editor.resetView());
window.addEventListener("beforeunload", () => {
    editor.destroy();
    inspector.destroy();
    dockLayout.destroy();
}, { once: true });

updateEditor();
