import { hitTestEdges } from "./edge-geometry.js";
import {
    normalizeGraphView,
    screenToGraphPoint,
    zoomGraphViewAt
} from "./graph-camera.js";
import { GraphWorkerClient } from "./graph-worker-client.js";
import { normalizeNodeEditorModel } from "./model.js";
import { connectionForPorts } from "./port-connection.js";
import {
    nodesInSelection,
    selectionRectangle
} from "./selection-geometry.js";
import { WebGpuGraphSurface } from "./webgpu-graph-surface.js";

function element(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
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
        this.selectedNodeIds = new Set();
        this.selectedEdgeId = null;
        this.hoveredEdgeId = null;
        this.selectedPort = null;
        this.view = normalizeGraphView();
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
            "Node graph editor. Drag ports to connect. Drag empty space to select. Alt-drag or middle-drag to pan."
        );
        this.canvas = document.createElement("canvas");
        this.canvas.className = "node-editor-gpu-surface";
        this.selectionStatus = element(
            "div",
            "node-editor-selection-status",
            "Accelerated graph surface"
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
                "Graph renderer unavailable";
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
        const onContextMenu = (event) => this.#handleContextMenu(event);
        const onKeyDown = (event) => this.#handleKeyDown(event);
        this.viewport.addEventListener("wheel", onWheel, { passive: false });
        this.viewport.addEventListener("pointerdown", onPointerDown);
        this.viewport.addEventListener("pointermove", onPointerMove);
        this.viewport.addEventListener("pointerup", onPointerUp);
        this.viewport.addEventListener("pointercancel", onPointerUp);
        this.viewport.addEventListener("pointerleave", onPointerLeave);
        this.viewport.addEventListener("contextmenu", onContextMenu);
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
            () => this.viewport.removeEventListener(
                "contextmenu",
                onContextMenu
            ),
            () => this.viewport.removeEventListener("keydown", onKeyDown)
        );
    }

    update(model, {
        positions = null,
        viewState = null,
        selectedNodeId = this.selectedNodeId,
        selectedNodeIds = this.selectedNodeIds,
        selectedEdgeId = this.selectedEdgeId,
        selectedPort = this.selectedPort,
        ...callbacks
    } = {}) {
        const normalized = normalizeNodeEditorModel(model);
        const graphChanged = this.model && this.model.id !== normalized.id;
        if (graphChanged) {
            this.positions.clear();
            this.selectedNodeId = null;
            this.selectedNodeIds.clear();
            this.selectedEdgeId = null;
            this.selectedPort = null;
            this.previewStates.clear();
        }
        this.model = normalized;
        this.callbacks = callbacks;
        const requestedNodeIds = selectedNodeIds instanceof Set
            ? [...selectedNodeIds]
            : Array.isArray(selectedNodeIds)
                ? selectedNodeIds
                : [];
        if (selectedNodeId && requestedNodeIds.length === 0) {
            requestedNodeIds.push(selectedNodeId);
        }
        const liveIds = new Set(normalized.nodes.map((node) => node.id));
        this.selectedNodeIds = new Set(
            requestedNodeIds.filter((id) => liveIds.has(id))
        );
        this.selectedNodeId = this.selectedNodeIds.has(selectedNodeId)
            ? selectedNodeId
            : [...this.selectedNodeIds][0] ?? null;
        this.selectedEdgeId = selectedEdgeId;
        this.selectedPort = selectedPort;
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
            this.view = normalizeGraphView(viewState, this.view);
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
            `${this.model.nodes.length} nodes · ${this.model.edges.length} connections · accelerated rendering`;
        this.#syncInteraction();
        if (notifyPositions) {
            this.callbacks.onPositionsChange?.(this.getPositions());
        }
        return result;
    }

    #graphPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return screenToGraphPoint(this.view, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        });
    }

    #requestPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return Object.freeze({
            graphPoint: this.#graphPoint(event),
            viewportPoint: Object.freeze({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            }),
            clientPoint: Object.freeze({
                x: event.clientX,
                y: event.clientY
            })
        });
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

    #portDescriptor(hit) {
        return Object.freeze({
            nodeId: hit.node.id,
            port: hit.port.id,
            direction: hit.port.direction,
            type: hit.port.type
        });
    }

    #liveNodes() {
        if (!this.scene) return [];
        return this.scene.hitNodes.map((_, index) => this.#liveNode(index));
    }

    #handleWheel(event) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            const rect = this.canvas.getBoundingClientRect();
            const local = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            this.setView(zoomGraphViewAt(
                this.view,
                this.view.zoom + (event.deltaY < 0 ? 0.1 : -0.1),
                local
            ));
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
            const sourcePort = this.#portDescriptor(portHit);
            this.selectedPort = sourcePort;
            this.selectedNodeId = portHit.node.id;
            this.selectedNodeIds = new Set([portHit.node.id]);
            this.selectedEdgeId = null;
            this.drag = {
                kind: "connection",
                pointerId,
                sourcePort,
                clientX: event.clientX,
                clientY: event.clientY,
                point,
                moved: false
            };
            this.viewport.classList.add("connecting-port");
            this.viewport.setPointerCapture(pointerId);
            this.#syncInteraction();
            this.#notifyNodeSelection();
            return;
        }
        const node = this.#nodeAt(point);
        if (node) {
            const additive = event.shiftKey || event.ctrlKey || event.metaKey;
            if (additive) {
                this.selectNode(node.id, { toggle: true });
            } else if (this.selectedNodeIds.has(node.id)) {
                this.selectedNodeId = node.id;
                this.selectedEdgeId = null;
                this.selectedPort = null;
                this.#syncInteraction();
                this.#notifyNodeSelection();
            } else {
                this.selectNode(node.id);
            }
            if (point.y - node.y <= node.headerHeight) {
                if (!this.selectedNodeIds.has(node.id)) return;
                const startingPositions = {};
                this.selectedNodeIds.forEach((nodeId) => {
                    const index = this.scene.nodeIndexById[nodeId];
                    if (!Number.isInteger(index)) return;
                    const liveNode = this.#liveNode(index);
                    startingPositions[nodeId] = {
                        x: liveNode.x,
                        y: liveNode.y
                    };
                });
                this.drag = {
                    kind: "node",
                    pointerId,
                    nodeId: node.id,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    startingPositions
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
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        this.drag = {
            kind: "selection",
            pointerId,
            start: point,
            current: point,
            clientX: event.clientX,
            clientY: event.clientY,
            initialNodeIds: additive ? [...this.selectedNodeIds] : [],
            moved: false
        };
        if (!additive) {
            this.selectedNodeId = null;
            this.selectedNodeIds.clear();
            this.selectedEdgeId = null;
            this.selectedPort = null;
        }
        this.viewport.classList.add("selecting-nodes");
        this.viewport.setPointerCapture(pointerId);
        this.#syncInteraction();
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
            if (this.drag.kind === "connection") {
                const point = this.#graphPoint(event);
                this.drag.point = point;
                this.drag.moved ||= Math.hypot(
                    event.clientX - this.drag.clientX,
                    event.clientY - this.drag.clientY
                ) >= 4;
                this.#syncInteraction();
                return;
            }
            if (this.drag.kind === "selection") {
                const point = this.#graphPoint(event);
                this.drag.current = point;
                this.drag.moved ||= Math.hypot(
                    event.clientX - this.drag.clientX,
                    event.clientY - this.drag.clientY
                ) >= 3;
                const selected = new Set(this.drag.initialNodeIds);
                nodesInSelection(
                    this.#liveNodes(),
                    this.drag.start,
                    point
                ).forEach((id) => selected.add(id));
                this.selectedNodeIds = selected;
                this.selectedNodeId = [...selected].at(-1) ?? null;
                this.#syncInteraction();
                return;
            }
            const delta = {
                x: (event.clientX - this.drag.clientX) / this.view.zoom,
                y: (event.clientY - this.drag.clientY) / this.view.zoom
            };
            Object.entries(this.drag.startingPositions).forEach(
                ([nodeId, start]) => {
                    const position = {
                        x: start.x + delta.x,
                        y: start.y + delta.y
                    };
                    this.positions.set(nodeId, position);
                    this.surface.setNodePosition(nodeId, position);
                }
            );
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
        this.viewport.classList.remove(
            "panning",
            "dragging-node",
            "connecting-port",
            "selecting-nodes"
        );
        if (drag.kind === "node") {
            const moved = Object.fromEntries(
                Object.keys(drag.startingPositions).map((nodeId) => [
                    nodeId,
                    { ...this.positions.get(nodeId) }
                ])
            );
            if (this.callbacks.onMoveNodes) {
                this.callbacks.onMoveNodes(moved);
            } else {
                Object.entries(moved).forEach(([nodeId, position]) =>
                    this.callbacks.onMoveNode?.(nodeId, position));
            }
            this.callbacks.onPositionsChange?.(this.getPositions());
            this.prepared = this.#prepareScene();
            return;
        }
        if (drag.kind === "connection") {
            const point = this.#graphPoint(event);
            const targetHit = this.#portAt(point);
            const targetPort = targetHit
                ? this.#portDescriptor(targetHit)
                : null;
            const connection = connectionForPorts(
                drag.sourcePort,
                targetPort
            );
            this.selectedPort = drag.moved ? null : drag.sourcePort;
            this.#syncInteraction();
            if (drag.moved && connection) {
                this.callbacks.onConnectPorts?.(connection);
            } else if (drag.moved && !targetHit) {
                this.callbacks.onRequestNode?.({
                    ...this.#requestPoint(event),
                    sourcePort: drag.sourcePort
                });
            } else if (!drag.moved) {
                this.callbacks.onSelectPort?.({ ...drag.sourcePort });
            }
            return;
        }
        if (drag.kind === "selection") {
            this.#syncInteraction();
            this.#notifyNodeSelection();
        }
    }

    #handleContextMenu(event) {
        const point = this.#graphPoint(event);
        event.preventDefault();
        if (
            this.#portAt(point)
            || this.#nodeAt(point)
            || this.#edgeAt(point)
        ) {
            return;
        }
        this.callbacks.onRequestNode?.({
            ...this.#requestPoint(event),
            sourcePort: null
        });
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
            const nodeIds = [...this.selectedNodeIds];
            if (nodeIds.length > 1 && this.callbacks.onDeleteNodes) {
                this.callbacks.onDeleteNodes(nodeIds);
            } else {
                nodeIds.forEach((nodeId) =>
                    this.callbacks.onDeleteNode?.(nodeId));
            }
        }
    }

    #syncInteraction() {
        this.surface.setInteraction({
            selectedNodeId: this.selectedNodeId,
            selectedNodeIds: [...this.selectedNodeIds],
            selectedEdgeId: this.selectedEdgeId,
            hoveredEdgeId: this.hoveredEdgeId,
            selectedPort: this.selectedPort,
            connectionPreview: this.drag?.kind === "connection"
                ? {
                    sourcePort: this.drag.sourcePort,
                    point: this.drag.point
                }
                : null,
            selectionRect: this.drag?.kind === "selection"
                && this.drag.moved
                ? selectionRectangle(this.drag.start, this.drag.current)
                : null
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
        } else if (this.selectedNodeIds.size > 1) {
            this.selectionStatus.textContent =
                `${this.selectedNodeIds.size} nodes selected`;
        } else if (this.selectedNodeId) {
            const node = this.model?.nodes.find(
                (entry) => entry.id === this.selectedNodeId
            );
            this.selectionStatus.textContent =
                `${node?.label ?? "Node"} selected`;
        }
    }

    #notifyNodeSelection() {
        const nodeIds = [...this.selectedNodeIds];
        if (nodeIds.length === 0) {
            this.callbacks.onClearSelection?.();
        } else if (this.callbacks.onSelectNodes) {
            this.callbacks.onSelectNodes(nodeIds, {
                primaryNodeId: this.selectedNodeId
            });
        } else {
            this.callbacks.onSelectNode?.(this.selectedNodeId);
        }
    }

    selectNode(nodeId, { toggle = false } = {}) {
        if (!this.model?.nodes.some((node) => node.id === nodeId)) return;
        if (toggle) {
            if (this.selectedNodeIds.has(nodeId)) {
                this.selectedNodeIds.delete(nodeId);
            } else {
                this.selectedNodeIds.add(nodeId);
            }
        } else {
            this.selectedNodeIds = new Set([nodeId]);
        }
        this.selectedNodeId = this.selectedNodeIds.has(nodeId)
            ? nodeId
            : [...this.selectedNodeIds].at(-1) ?? null;
        this.selectedEdgeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.#notifyNodeSelection();
    }

    selectEdge(edgeId) {
        const edge = this.model?.edges.find((entry) => entry.id === edgeId);
        if (!edge) return;
        this.selectedEdgeId = edgeId;
        this.selectedNodeId = null;
        this.selectedNodeIds.clear();
        this.selectedPort = null;
        this.#syncInteraction();
        this.callbacks.onSelectEdge?.(edgeId, edge);
    }

    clearSelection() {
        if (
            !this.selectedNodeId
            && this.selectedNodeIds.size === 0
            && !this.selectedEdgeId
            && !this.selectedPort
        ) {
            return;
        }
        this.selectedNodeId = null;
        this.selectedNodeIds.clear();
        this.selectedEdgeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.selectionStatus.textContent = "Accelerated graph surface";
        this.callbacks.onClearSelection?.();
    }

    autoLayout() {
        this.positions.clear();
        this.prepared = this.#prepareScene({ notifyPositions: true });
    }

    setView(view) {
        this.view = normalizeGraphView(view, this.view);
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
