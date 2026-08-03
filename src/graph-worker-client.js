import { buildGraphScene } from "./graph-scene.js";
import { layoutNodeEditorModel } from "./layout.js";

export function workerSafeGraphModel(model) {
    return {
        id: model.id,
        label: model.label,
        nodes: model.nodes.map((node) => ({
            id: node.id,
            label: node.label,
            type: node.type,
            category: node.category,
            color: node.color,
            order: node.order,
            terminal: node.terminal,
            preview: node.preview ? {
                label: node.preview.label,
                aspectRatio: node.preview.aspectRatio
            } : null,
            inputs: node.inputs.map((port) => ({
                id: port.id,
                label: port.label,
                type: port.type
            })),
            outputs: node.outputs.map((port) => ({
                id: port.id,
                label: port.label,
                type: port.type
            })),
            summary: node.summary.map((entry) => ({
                label: entry.label,
                value: entry.value
            }))
        })),
        edges: model.edges.map((edge) => ({
            id: edge.id,
            type: edge.type,
            from: {
                nodeId: edge.from.nodeId,
                port: edge.from.port
            },
            to: {
                nodeId: edge.to.nodeId,
                port: edge.to.port
            }
        }))
    };
}

export function prepareGraphSynchronously({
    model,
    positions,
    layoutOptions,
    sceneOptions
}) {
    const layout = layoutNodeEditorModel(model, {
        ...layoutOptions,
        positions
    });
    return {
        layout,
        scene: buildGraphScene(model, layout, sceneOptions)
    };
}

export class GraphWorkerClient {
    constructor({
        workerFactory = () => new Worker(
            new URL("./graph-layout.worker.js", import.meta.url),
            { type: "module", name: "corvus-graph-layout" }
        )
    } = {}) {
        this.nextRequestId = 1;
        this.pending = new Map();
        this.worker = typeof Worker === "function" ? workerFactory() : null;
        this.worker?.addEventListener("message", (event) =>
            this.#handleMessage(event.data));
        this.worker?.addEventListener("error", (event) =>
            this.#failAll(new Error(event.message || "Graph worker failed")));
    }

    prepare(payload) {
        const safePayload = {
            ...payload,
            model: workerSafeGraphModel(payload.model)
        };
        if (!this.worker) {
            return Promise.resolve(prepareGraphSynchronously(safePayload));
        }
        const requestId = this.nextRequestId++;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.worker.postMessage({
                type: "prepare",
                requestId,
                ...safePayload
            });
        });
    }

    #handleMessage(message) {
        const pending = this.pending.get(message?.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (message.type === "error") {
            pending.reject(new Error(message.message));
            return;
        }
        pending.resolve({
            layout: message.layout,
            scene: message.scene
        });
    }

    #failAll(error) {
        for (const { reject } of this.pending.values()) reject(error);
        this.pending.clear();
    }

    destroy() {
        this.#failAll(new Error("Graph worker was destroyed"));
        this.worker?.terminate();
        this.worker = null;
    }
}
