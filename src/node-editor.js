import { hitTestEdges } from "./edge-geometry.js";
import { GraphWorkerClient } from "./graph-worker-client.js";
import { normalizeNodeEditorModel } from "./model.js";
import { WebGpuGraphSurface } from "./webgpu-graph-surface.js";

function element(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
}

function clampZoom(value) {
    return Math.max(0.35, Math.min(2.5, value));
}

function finitePosition(position) {
    return Boolean(
        position
        && Number.isFinite(position.x)
        && Number.isFinite(position.y)
    );
}

function positionObject(positions) {
    return Object.fromEntries([...positions].map(([id, value]) => [
        id,
        { x: value.x, y: value.y }
    ]));
}

function spatialCell(scene, point) {
    const cellSize = scene.spatialIndex.cellSize;
    return scene.spatialIndex.cells[
        `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`
    ];
}

function portDistance(point, node, port) {
    return Math.hypot(
        point.x - (node.x + port.x),
        point.y - (node.y + port.y)
    );
}

export class NodeEditor {
    constructor(container, {
        gpuDevice = null,
        layout = {},
        onError = null,
        onRendererChange = null,
        workerFactory = undefined
    } = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError("NodeEditor requires a container");
        }
        this.container = container;
        this.layoutOptions = layout;
        this.onError = onError;
        this.callbacks = {};
        this.model = null;
        this.positions = new Map();
        this.layout = null;
        this.scene = null;
        this.previewStates = new Map();
        this.selectedNodeId = null;
        this.selectedEdgeId = null;
        this.hoveredEdgeId = null;
        this.selectedPort = null;
        this.view = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
        this.prepareRevision = 0;
        this.drag = null;
        this.destroyed = false;
        this.cleanup = [];

        container.classList.add("node-editor", "node-editor-gpu-only");
        this.viewport = element("div", "node-editor-viewport");
        this.viewport.tabIndex = 0;
        this.viewport.setAttribute("role", "application");
        this.viewport.setAttribute(
            "aria-label",
            "WebGPU node graph editor. Drag node headers to move. Alt-drag or middle-drag to pan."
        );
        this.canvas = document.createElement("canvas");
        this.canvas.className = "node-editor-gpu-surface";
        this.selectionStatus = element(
            "div",
            "node-editor-selection-status",
            "WebGPU graph surface"
        );
        this.selectionStatus.setAttribute("aria-live", "polite");
        this.viewport.append(this.canvas, this.selectionStatus);
        container.replaceChildren(this.viewport);

        this.worker = new GraphWorkerClient(
            workerFactory ? { workerFactory } : undefined
        );
        this.surface = new WebGpuGraphSurface(this.canvas, {
            device: gpuDevice,
            onStatus: onRendererChange
        });
        this.ready = this.surface.initialize(gpuDevice).catch((error) => {
            container.classList.add("gpu-unavailable");
            this.selectionStatus.textContent =
                "WebGPU graph renderer unavailable";
            this.onError?.(error);
            throw error;
        });
        this.ready.catch(() => {});
        this.#bindEvents();
    }

    #bindEvents() {
        const onWheel = (event) => this.#handleWheel(event);
        const onPointerDown = (event) => this.#handlePointerDown(event);
        const onPointerMove = (event) => this.#handlePointerMove(event);
        const onPointerUp = (event) => this.#handlePointerUp(event);
        const onPointerLeave = () => {
            if (this.drag || !this.hoveredEdgeId) return;
            this.hoveredEdgeId = null;
            this.#syncInteraction();
        };
        const onKeyDown = (event) => this.#handleKeyDown(event);
        this.viewport.addEventListener("wheel", onWheel, { passive: false });
        this.viewport.addEventListener("pointerdown", onPointerDown);
        this.viewport.addEventListener("pointermove", onPointerMove);
        this.viewport.addEventListener("pointerup", onPointerUp);
        this.viewport.addEventListener("pointercancel", onPointerUp);
        this.viewport.addEventListener("pointerleave", onPointerLeave);
        this.viewport.addEventListener("keydown", onKeyDown);
        this.cleanup.push(
            () => this.viewport.removeEventListener("wheel", onWheel),
            () => this.viewport.removeEventListener(
                "pointerdown",
                onPointerDown
            ),
            () => this.viewport.removeEventListener(
                "pointermove",
                onPointerMove
            ),
            () => this.viewport.removeEventListener("pointerup", onPointerUp),
            () => this.viewport.removeEventListener(
                "pointercancel",
                onPointerUp
            ),
            () => this.viewport.removeEventListener(
                "pointerleave",
                onPointerLeave
            ),
            () => this.viewport.removeEventListener("keydown", onKeyDown)
        );
    }

    update(model, {
        positions = null,
        viewState = null,
        selectedNodeId = this.selectedNodeId,
        selectedEdgeId = this.selectedEdgeId,
        selectedPort = this.selectedPort,
        ...callbacks
    } = {}) {
        const normalized = normalizeNodeEditorModel(model);
        const graphChanged = this.model && this.model.id !== normalized.id;
        if (graphChanged) {
            this.positions.clear();
            this.selectedNodeId = null;
            this.selectedEdgeId = null;
            this.selectedPort = null;
            this.previewStates.clear();
        }
        this.model = normalized;
        this.callbacks = callbacks;
        this.selectedNodeId = selectedNodeId;
        this.selectedEdgeId = selectedEdgeId;
        this.selectedPort = selectedPort;
        const liveIds = new Set(normalized.nodes.map((node) => node.id));
        for (const id of [...this.positions.keys()]) {
            if (!liveIds.has(id)) this.positions.delete(id);
        }
        if (positions) {
            Object.entries(positions).forEach(([id, position]) => {
                if (liveIds.has(id) && finitePosition(position)) {
                    this.positions.set(id, {
                        x: position.x,
                        y: position.y
                    });
                }
            });
        }
        if (viewState) {
            this.view = {
                zoom: clampZoom(Number(viewState.zoom) || 1),
                scrollLeft: Math.max(
                    0,
                    Number(viewState.scrollLeft) || 0
                ),
                scrollTop: Math.max(0, Number(viewState.scrollTop) || 0)
            };
        }
        this.surface.setView(this.view);
        this.#syncInteraction();
        this.prepared = this.#prepareScene();
        return this.stats();
    }

    async #prepareScene({ notifyPositions = false } = {}) {
        const revision = ++this.prepareRevision;
        const result = await this.worker.prepare({
            model: this.model,
            positions: positionObject(this.positions),
            layoutOptions: this.layoutOptions,
            sceneOptions: this.layoutOptions
        });
        await this.ready;
        if (revision !== this.prepareRevision || this.destroyed) return null;
        this.layout = result.layout;
        this.scene = result.scene;
        result.layout.nodes.forEach((entry) => {
            if (!this.positions.has(entry.nodeId)) {
                this.positions.set(entry.nodeId, {
                    x: entry.x,
                    y: entry.y
                });
            }
        });
        this.surface.setScene(result.scene);
        this.surface.setView(this.view);
        this.surface.setPreviewTextures(this.previewStates);
        this.selectionStatus.textContent =
            `${this.model.nodes.length} nodes · ${this.model.edges.length} connections · WebGPU compute`;
        this.#syncInteraction();
        if (notifyPositions) {
            this.callbacks.onPositionsChange?.(this.getPositions());
        }
        return result;
    }

    #graphPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (
                this.view.scrollLeft
                + event.clientX
                - rect.left
            ) / this.view.zoom,
            y: (
                this.view.scrollTop
                + event.clientY
                - rect.top
            ) / this.view.zoom
        };
    }

    #liveNode(index) {
        const metadata = this.scene.hitNodes[index];
        const offset = index * 4;
        return {
            ...metadata,
            x: this.scene.nodeRecords[offset],
            y: this.scene.nodeRecords[offset + 1],
            width: this.scene.nodeRecords[offset + 2],
            height: this.scene.nodeRecords[offset + 3]
        };
    }

    #candidateNodeIndexes(point) {
        const indexes = spatialCell(this.scene, point)?.nodes;
        return indexes ?? [];
    }

    #nodeAt(point) {
        if (!this.scene) return null;
        const indexes = this.#candidateNodeIndexes(point);
        for (let offset = indexes.length - 1; offset >= 0; offset -= 1) {
            const node = this.#liveNode(indexes[offset]);
            if (
                point.x >= node.x
                && point.x <= node.x + node.width
                && point.y >= node.y
                && point.y <= node.y + node.height
            ) {
                return node;
            }
        }
        return null;
    }

    #portAt(point) {
        if (!this.scene) return null;
        const radius = 11 / this.view.zoom;
        for (const index of this.#candidateNodeIndexes(point)) {
            const node = this.#liveNode(index);
            for (const port of node.ports) {
                if (portDistance(point, node, port) <= radius) {
                    return { node, port };
                }
            }
        }
        return null;
    }

    #edgeAt(point, tolerance = 9) {
        if (!this.scene) return null;
        const candidateIndexes = spatialCell(
            this.scene,
            point
        )?.edges;
        const candidates = (candidateIndexes ?? []).map(
            (index) => this.scene.hitEdges[index]
        );
        return hitTestEdges(
            candidates,
            point,
            tolerance / this.view.zoom
        );
    }

    #handleWheel(event) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            const rect = this.canvas.getBoundingClientRect();
            const local = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            const graphPoint = {
                x: (this.view.scrollLeft + local.x) / this.view.zoom,
                y: (this.view.scrollTop + local.y) / this.view.zoom
            };
            const zoom = clampZoom(
                this.view.zoom + (event.deltaY < 0 ? 0.1 : -0.1)
            );
            this.setView({
                zoom,
                scrollLeft: graphPoint.x * zoom - local.x,
                scrollTop: graphPoint.y * zoom - local.y
            });
            return;
        }
        this.setView({
            ...this.view,
            scrollLeft: this.view.scrollLeft + event.deltaX,
            scrollTop: this.view.scrollTop + event.deltaY
        });
    }

    #handlePointerDown(event) {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        this.viewport.focus({ preventScroll: true });
        const pointerId = event.pointerId;
        if (event.button === 1 || event.altKey) {
            this.drag = {
                kind: "pan",
                pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                scrollLeft: this.view.scrollLeft,
                scrollTop: this.view.scrollTop
            };
            this.viewport.classList.add("panning");
            this.viewport.setPointerCapture(pointerId);
            return;
        }
        const point = this.#graphPoint(event);
        const portHit = this.#portAt(point);
        if (portHit) {
            this.selectedPort = {
                nodeId: portHit.node.id,
                port: portHit.port.id,
                direction: portHit.port.direction,
                type: portHit.port.type
            };
            this.selectedNodeId = portHit.node.id;
            this.selectedEdgeId = null;
            this.#syncInteraction();
            this.callbacks.onSelectPort?.({ ...this.selectedPort });
            return;
        }
        const node = this.#nodeAt(point);
        if (node) {
            this.selectNode(node.id);
            if (point.y - node.y <= node.headerHeight) {
                this.drag = {
                    kind: "node",
                    pointerId,
                    nodeId: node.id,
                    nodeIndex: node.index,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    x: node.x,
                    y: node.y
                };
                this.viewport.classList.add("dragging-node");
                this.viewport.setPointerCapture(pointerId);
            }
            return;
        }
        const edge = this.#edgeAt(point);
        if (edge) {
            this.selectEdge(edge.id);
            return;
        }
        this.clearSelection();
    }

    #handlePointerMove(event) {
        if (this.drag?.pointerId === event.pointerId) {
            if (this.drag.kind === "pan") {
                this.setView({
                    ...this.view,
                    scrollLeft: this.drag.scrollLeft
                        - (event.clientX - this.drag.clientX),
                    scrollTop: this.drag.scrollTop
                        - (event.clientY - this.drag.clientY)
                });
                return;
            }
            const position = {
                x: Math.max(
                    12,
                    this.drag.x
                        + (event.clientX - this.drag.clientX) / this.view.zoom
                ),
                y: Math.max(
                    12,
                    this.drag.y
                        + (event.clientY - this.drag.clientY) / this.view.zoom
                )
            };
            this.positions.set(this.drag.nodeId, position);
            this.surface.setNodePosition(this.drag.nodeId, position);
            return;
        }
        const point = this.#graphPoint(event);
        const port = this.#portAt(point);
        const node = port ? port.node : this.#nodeAt(point);
        this.viewport.classList.toggle("port-hovered", Boolean(port));
        this.viewport.classList.toggle(
            "node-header-hovered",
            Boolean(node && point.y - node.y <= node.headerHeight)
        );
        const edge = node ? null : this.#edgeAt(point, 7);
        const id = edge?.id ?? null;
        if (id === this.hoveredEdgeId) return;
        this.hoveredEdgeId = id;
        this.viewport.classList.toggle("edge-hovered", Boolean(id));
        this.#syncInteraction();
    }

    #handlePointerUp(event) {
        if (this.drag?.pointerId !== event.pointerId) return;
        if (this.viewport.hasPointerCapture(event.pointerId)) {
            this.viewport.releasePointerCapture(event.pointerId);
        }
        const drag = this.drag;
        this.drag = null;
        this.viewport.classList.remove("panning", "dragging-node");
        if (drag.kind !== "node") return;
        const position = this.positions.get(drag.nodeId);
        this.callbacks.onMoveNode?.(drag.nodeId, { ...position });
        this.callbacks.onPositionsChange?.(this.getPositions());
        this.prepared = this.#prepareScene();
    }

    #handleKeyDown(event) {
        if (event.key === "Escape") {
            this.clearSelection();
            return;
        }
        if (!["Delete", "Backspace"].includes(event.key)) return;
        if (this.selectedEdgeId) {
            const edge = this.model.edges.find(
                (entry) => entry.id === this.selectedEdgeId
            );
            if (edge) {
                event.preventDefault();
                this.callbacks.onDeleteEdge?.(edge.id, edge);
            }
        } else if (this.selectedNodeId) {
            event.preventDefault();
            this.callbacks.onDeleteNode?.(this.selectedNodeId);
        }
    }

    #syncInteraction() {
        this.surface.setInteraction({
            selectedNodeId: this.selectedNodeId,
            selectedEdgeId: this.selectedEdgeId,
            hoveredEdgeId: this.hoveredEdgeId,
            selectedPort: this.selectedPort
        });
        const edge = this.model?.edges.find(
            (entry) => entry.id === this.selectedEdgeId
        );
        if (edge) {
            const source = this.model.nodes.find(
                (node) => node.id === edge.from.nodeId
            );
            const target = this.model.nodes.find(
                (node) => node.id === edge.to.nodeId
            );
            this.selectionStatus.textContent =
                `${source?.label ?? "Node"} → ${target?.label ?? "Node"} selected · Delete removes connection`;
        } else if (this.selectedNodeId) {
            const node = this.model?.nodes.find(
                (entry) => entry.id === this.selectedNodeId
            );
            this.selectionStatus.textContent =
                `${node?.label ?? "Node"} selected`;
        }
    }

    selectNode(nodeId) {
        if (!this.model?.nodes.some((node) => node.id === nodeId)) return;
        this.selectedNodeId = nodeId;
        this.selectedEdgeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.callbacks.onSelectNode?.(nodeId);
    }

    selectEdge(edgeId) {
        const edge = this.model?.edges.find((entry) => entry.id === edgeId);
        if (!edge) return;
        this.selectedEdgeId = edgeId;
        this.selectedNodeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.callbacks.onSelectEdge?.(edgeId, edge);
    }

    clearSelection() {
        if (
            !this.selectedNodeId
            && !this.selectedEdgeId
            && !this.selectedPort
        ) {
            return;
        }
        this.selectedNodeId = null;
        this.selectedEdgeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.selectionStatus.textContent = "WebGPU graph surface";
        this.callbacks.onClearSelection?.();
    }

    autoLayout() {
        this.positions.clear();
        this.prepared = this.#prepareScene({ notifyPositions: true });
    }

    setView(view) {
        this.view = {
            zoom: clampZoom(Number(view.zoom) || this.view.zoom),
            scrollLeft: Math.max(0, Number(view.scrollLeft) || 0),
            scrollTop: Math.max(0, Number(view.scrollTop) || 0)
        };
        this.surface.setView(this.view);
        this.callbacks.onViewChange?.(this.getView());
    }

    zoomBy(amount) {
        this.setView({ ...this.view, zoom: this.view.zoom + amount });
    }

    resetView() {
        this.setView({ zoom: 1, scrollLeft: 0, scrollTop: 0 });
    }

    getView() {
        return Object.freeze({ ...this.view });
    }

    getPositions() {
        return Object.freeze(positionObject(this.positions));
    }

    getPreviewTargets() {
        if (!this.model) return Object.freeze([]);
        return Object.freeze(this.model.nodes
            .filter((node) => node.preview)
            .map((node) => Object.freeze({ id: node.id, node })));
    }

    setPreviewStates(states) {
        this.previewStates = states instanceof Map
            ? new Map(states)
            : new Map(Object.entries(states ?? {}));
        this.surface.setPreviewTextures(this.previewStates);
    }

    setPreviewTextures(textures) {
        this.setPreviewStates(textures);
    }

    stats() {
        return Object.freeze({
            nodeCount: this.model?.nodes.length ?? 0,
            edgeCount: this.model?.edges.length ?? 0,
            ...this.surface.stats(),
            zoom: this.view.zoom
        });
    }

    destroy() {
        this.destroyed = true;
        this.prepareRevision += 1;
        this.cleanup.forEach((cleanup) => cleanup());
        this.worker.destroy();
        this.surface.destroy();
        this.container.replaceChildren();
        this.container.classList.remove(
            "node-editor",
            "node-editor-gpu-only",
            "gpu-unavailable"
        );
    }
}

export function createNodeEditor(container, options) {
    return new NodeEditor(container, options);
}
