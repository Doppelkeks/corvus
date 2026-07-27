import {
    hitTestEdges,
    sampleCubicEdge
} from "./edge-geometry.js";
import { layoutNodeEditorModel } from "./layout.js";
import { normalizeNodeEditorModel } from "./model.js";
import { WebGpuEdgeLayer } from "./webgpu-edge-layer.js";

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

function portRow(node, port, direction, callbacks) {
    const row = element("li", `node-editor-port ${direction}`);
    const socket = element("button", `node-editor-socket type-${port.type}`);
    socket.type = "button";
    socket.dataset.nodeId = node.id;
    socket.dataset.port = port.id;
    socket.dataset.direction = direction;
    socket.title = `${direction === "input" ? "Connect to" : "Connect from"} ${node.label}.${port.label}`;
    if (
        callbacks.selectedPort?.nodeId === node.id
        && callbacks.selectedPort?.port === port.id
        && callbacks.selectedPort?.direction === direction
    ) {
        socket.classList.add("selected");
    }
    socket.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.onSelectPort?.({
            nodeId: node.id,
            port: port.id,
            direction,
            type: port.type
        });
    });
    const label = element("span", "node-editor-port-label", port.label);
    const type = element("small", "", port.type);
    if (direction === "input") row.append(socket, label, type);
    else row.append(type, label, socket);
    return row;
}

export class NodeEditor {
    constructor(container, {
        gpuDevice = null,
        layout = {},
        onError = null,
        onRendererChange = null
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
        this.layoutById = new Map();
        this.edgeGeometry = [];
        this.nodeById = new Map();
        this.selectedNodeId = null;
        this.selectedEdgeId = null;
        this.hoveredEdgeId = null;
        this.selectedPort = null;
        this.view = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
        this.scrollFrame = 0;
        this.edgeFrame = 0;
        this.cleanup = [];

        container.classList.add("node-editor");
        this.viewport = element("div", "node-editor-viewport");
        this.viewport.tabIndex = 0;
        this.viewport.setAttribute("role", "application");
        this.viewport.setAttribute("aria-label", "Node graph editor");
        this.canvas = element("div", "node-editor-canvas");
        this.scene = element("div", "node-editor-scene");
        this.wireCanvas = document.createElement("canvas");
        this.wireCanvas.className = "node-editor-wire-surface";
        this.nodeLayer = element("div", "node-editor-node-layer");
        this.edgeControls = element("div", "node-editor-a11y-edges");
        this.selectionStatus = element(
            "div",
            "node-editor-selection-status",
            "WebGPU graph surface"
        );
        this.selectionStatus.setAttribute("aria-live", "polite");
        this.scene.append(this.wireCanvas, this.nodeLayer);
        this.canvas.append(this.scene);
        this.viewport.append(this.canvas, this.edgeControls, this.selectionStatus);
        container.replaceChildren(this.viewport);

        this.edgeLayer = new WebGpuEdgeLayer(this.wireCanvas, {
            device: gpuDevice,
            onStatus: onRendererChange
        });
        this.ready = this.edgeLayer.initialize(gpuDevice).catch((error) => {
            container.classList.add("gpu-unavailable");
            this.selectionStatus.textContent = "WebGPU graph renderer unavailable";
            this.onError?.(error);
            throw error;
        });
        // Callers may treat ready as optional. Avoid an unhandled rejection
        // while still preserving the rejecting promise for explicit awaits.
        this.ready.catch(() => {});
        this.#bindEvents();
    }

    #bindEvents() {
        const onScroll = () => {
            cancelAnimationFrame(this.scrollFrame);
            this.scrollFrame = requestAnimationFrame(() => {
                this.view = {
                    ...this.view,
                    scrollLeft: this.viewport.scrollLeft,
                    scrollTop: this.viewport.scrollTop
                };
                this.callbacks.onViewChange?.(this.getView());
            });
        };
        const onWheel = (event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const rect = this.viewport.getBoundingClientRect();
            const point = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            const graphPoint = {
                x: (this.viewport.scrollLeft + point.x) / this.view.zoom,
                y: (this.viewport.scrollTop + point.y) / this.view.zoom
            };
            const zoom = clampZoom(
                this.view.zoom + (event.deltaY < 0 ? 0.1 : -0.1)
            );
            this.setView({
                zoom,
                scrollLeft: graphPoint.x * zoom - point.x,
                scrollTop: graphPoint.y * zoom - point.y
            });
        };
        const onPointerDown = (event) => this.#handleBackgroundPointerDown(event);
        const onPointerMove = (event) => this.#handleBackgroundPointerMove(event);
        const onPointerLeave = () => {
            if (this.hoveredEdgeId) {
                this.hoveredEdgeId = null;
                this.#scheduleEdges();
            }
        };
        const onKeyDown = (event) => this.#handleKeyDown(event);
        this.viewport.addEventListener("scroll", onScroll);
        this.viewport.addEventListener("wheel", onWheel, { passive: false });
        this.viewport.addEventListener("pointerdown", onPointerDown);
        this.viewport.addEventListener("pointermove", onPointerMove);
        this.viewport.addEventListener("pointerleave", onPointerLeave);
        this.viewport.addEventListener("keydown", onKeyDown);
        this.cleanup.push(
            () => this.viewport.removeEventListener("scroll", onScroll),
            () => this.viewport.removeEventListener("wheel", onWheel),
            () => this.viewport.removeEventListener("pointerdown", onPointerDown),
            () => this.viewport.removeEventListener("pointermove", onPointerMove),
            () => this.viewport.removeEventListener("pointerleave", onPointerLeave),
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
        }
        this.model = normalized;
        this.callbacks = callbacks;
        this.selectedNodeId = selectedNodeId;
        this.selectedEdgeId = selectedEdgeId;
        this.selectedPort = selectedPort;
        this.nodeById = new Map(normalized.nodes.map((node) => [node.id, node]));

        const liveIds = new Set(normalized.nodes.map((node) => node.id));
        for (const id of [...this.positions.keys()]) {
            if (!liveIds.has(id)) this.positions.delete(id);
        }
        if (positions) {
            Object.entries(positions).forEach(([id, position]) => {
                if (liveIds.has(id) && finitePosition(position)) {
                    this.positions.set(id, { x: position.x, y: position.y });
                }
            });
        }
        const firstLayout = layoutNodeEditorModel(normalized, {
            ...this.layoutOptions,
            positions: positionObject(this.positions)
        });
        firstLayout.nodes.forEach((entry) => {
            if (!this.positions.has(entry.nodeId)) {
                this.positions.set(entry.nodeId, { x: entry.x, y: entry.y });
            }
        });
        this.#calculateLayout();
        if (viewState) this.view = {
            zoom: clampZoom(Number(viewState.zoom) || 1),
            scrollLeft: Math.max(0, Number(viewState.scrollLeft) || 0),
            scrollTop: Math.max(0, Number(viewState.scrollTop) || 0)
        };
        this.#renderNodes();
        this.#renderAccessibleEdges();
        this.#sizeScene();
        this.#calculateEdges();
        this.#syncSelection();
        this.#applyView();
        return this.stats();
    }

    #calculateLayout() {
        this.layout = layoutNodeEditorModel(this.model, {
            ...this.layoutOptions,
            positions: positionObject(this.positions)
        });
        this.layoutById = new Map(this.layout.nodes.map((entry) => [
            entry.nodeId,
            { ...entry }
        ]));
    }

    #sizeScene() {
        const minimumWidth = Math.max(
            1,
            this.viewport.clientWidth / this.view.zoom
        );
        const minimumHeight = Math.max(
            1,
            this.viewport.clientHeight / this.view.zoom
        );
        this.sceneWidth = Math.max(this.layout.width + 180, minimumWidth);
        this.sceneHeight = Math.max(this.layout.height + 180, minimumHeight);
        Object.assign(this.scene.style, {
            width: `${this.sceneWidth}px`,
            height: `${this.sceneHeight}px`
        });
        Object.assign(this.nodeLayer.style, {
            width: `${this.sceneWidth}px`,
            height: `${this.sceneHeight}px`
        });
        Object.assign(this.wireCanvas.style, {
            width: `${this.sceneWidth}px`,
            height: `${this.sceneHeight}px`
        });
        this.#applyView();
    }

    #applyView() {
        this.scene.style.transform = `scale(${this.view.zoom})`;
        this.canvas.style.width = `${this.sceneWidth * this.view.zoom}px`;
        this.canvas.style.height = `${this.sceneHeight * this.view.zoom}px`;
        this.viewport.scrollLeft = this.view.scrollLeft;
        this.viewport.scrollTop = this.view.scrollTop;
    }

    #renderNodes() {
        const fragment = document.createDocumentFragment();
        for (const node of this.model.nodes) {
            const box = this.layoutById.get(node.id);
            const card = element(
                "article",
                `node-editor-node category-${node.category}`
            );
            card.dataset.nodeId = node.id;
            card.style.transform = `translate(${box.x}px, ${box.y}px)`;
            card.style.width = `${box.width}px`;
            card.style.minHeight = `${box.height}px`;
            card.tabIndex = 0;
            card.setAttribute("aria-label", `${node.label} node`);
            card.addEventListener("click", () => this.selectNode(node.id));
            card.addEventListener("keydown", (event) => {
                if (!["Enter", " "].includes(event.key)) return;
                event.preventDefault();
                this.selectNode(node.id);
            });

            const header = element("header", "node-editor-node-header");
            header.dataset.nodeDragHandle = "";
            const title = element("div", "node-editor-node-title");
            title.append(
                element("strong", "", node.label),
                element("small", "", node.type)
            );
            header.append(
                element("span", "node-editor-node-index", String(node.order + 1)),
                title,
                element("span", "node-editor-node-category", node.category)
            );
            header.title = "Drag to move node";
            this.#bindNodeDrag(header, card, node, box);
            card.append(header);

            const ports = element("div", "node-editor-ports");
            const inputs = element("ul", "node-editor-inputs");
            node.inputs.forEach((port) =>
                inputs.append(portRow(node, port, "input", {
                    selectedPort: this.selectedPort,
                    onSelectPort: this.callbacks.onSelectPort
                })));
            const outputs = element("ul", "node-editor-outputs");
            node.outputs.forEach((port) => {
                const row = portRow(node, port, "output", {
                    selectedPort: this.selectedPort,
                    onSelectPort: this.callbacks.onSelectPort
                });
                if (port.graphOutput) row.classList.add("graph-output");
                outputs.append(row);
            });
            ports.append(inputs, outputs);
            card.append(ports);

            if (node.summary.length > 0) {
                const summary = element("dl", "node-editor-node-summary");
                node.summary.slice(0, 3).forEach((item) => {
                    const entry = element("div");
                    entry.append(
                        element("dt", "", item.label),
                        element("dd", "", item.value)
                    );
                    summary.append(entry);
                });
                if (node.summary.length > 3) {
                    summary.append(element(
                        "p",
                        "",
                        `+${node.summary.length - 3} parameters`
                    ));
                }
                card.append(summary);
            }
            fragment.append(card);
        }
        this.nodeLayer.replaceChildren(fragment);
    }

    #bindNodeDrag(header, card, node, box) {
        header.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.selectNode(node.id);
            const origin = { x: box.x, y: box.y };
            const pointer = { x: event.clientX, y: event.clientY };
            header.setPointerCapture(event.pointerId);
            card.classList.add("dragging");
            const move = (moveEvent) => {
                box.x = Math.max(
                    12,
                    origin.x + (moveEvent.clientX - pointer.x) / this.view.zoom
                );
                box.y = Math.max(
                    12,
                    origin.y + (moveEvent.clientY - pointer.y) / this.view.zoom
                );
                this.positions.set(node.id, { x: box.x, y: box.y });
                card.style.transform = `translate(${box.x}px, ${box.y}px)`;
                this.layout = {
                    ...this.layout,
                    width: Math.max(this.layout.width, box.x + box.width + 36),
                    height: Math.max(this.layout.height, box.y + box.height + 36)
                };
                this.#sizeScene();
                this.#calculateEdges();
            };
            const finish = (upEvent) => {
                if (header.hasPointerCapture(upEvent.pointerId)) {
                    header.releasePointerCapture(upEvent.pointerId);
                }
                header.removeEventListener("pointermove", move);
                header.removeEventListener("pointerup", finish);
                header.removeEventListener("pointercancel", finish);
                card.classList.remove("dragging");
                const position = { x: box.x, y: box.y };
                this.callbacks.onMoveNode?.(node.id, position);
                this.callbacks.onPositionsChange?.(this.getPositions());
            };
            header.addEventListener("pointermove", move);
            header.addEventListener("pointerup", finish);
            header.addEventListener("pointercancel", finish);
        });
    }

    #portAnchor(box, node, portId, direction) {
        const ports = direction === "output" ? node.outputs : node.inputs;
        const index = Math.max(0, ports.findIndex((port) => port.id === portId));
        return {
            x: direction === "output" ? box.x + box.width : box.x,
            y: box.y + 48 + (index + 0.5) * 20
        };
    }

    #calculateEdges() {
        this.edgeGeometry = this.model.edges.map((edge) => {
            const source = this.layoutById.get(edge.from.nodeId);
            const target = this.layoutById.get(edge.to.nodeId);
            const sourceNode = this.nodeById.get(edge.from.nodeId);
            const targetNode = this.nodeById.get(edge.to.nodeId);
            return Object.freeze({
                ...edge,
                points: sampleCubicEdge(
                    this.#portAnchor(
                        source,
                        sourceNode,
                        edge.from.port,
                        "output"
                    ),
                    this.#portAnchor(
                        target,
                        targetNode,
                        edge.to.port,
                        "input"
                    )
                )
            });
        });
        this.#scheduleEdges();
    }

    #scheduleEdges() {
        cancelAnimationFrame(this.edgeFrame);
        this.edgeFrame = requestAnimationFrame(() => this.edgeLayer.setEdges(
            this.edgeGeometry,
            {
                selectedEdgeId: this.selectedEdgeId,
                hoveredEdgeId: this.hoveredEdgeId,
                width: this.sceneWidth,
                height: this.sceneHeight
            }
        ));
    }

    #renderAccessibleEdges() {
        const fragment = document.createDocumentFragment();
        this.model.edges.forEach((edge) => {
            const source = this.nodeById.get(edge.from.nodeId);
            const target = this.nodeById.get(edge.to.nodeId);
            const button = element(
                "button",
                "",
                `${source.label}.${edge.from.port} to ${target.label}.${edge.to.port}`
            );
            button.type = "button";
            button.addEventListener("click", () => this.selectEdge(edge.id));
            fragment.append(button);
        });
        this.edgeControls.replaceChildren(fragment);
    }

    #graphPoint(event) {
        const rect = this.scene.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / this.view.zoom,
            y: (event.clientY - rect.top) / this.view.zoom
        };
    }

    #backgroundTarget(target) {
        return [
            this.viewport,
            this.canvas,
            this.scene,
            this.wireCanvas,
            this.nodeLayer
        ].includes(target);
    }

    #handleBackgroundPointerDown(event) {
        if (!this.#backgroundTarget(event.target)) return;
        this.viewport.focus({ preventScroll: true });
        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            this.#beginPan(event);
            return;
        }
        if (event.button !== 0) return;
        const edge = hitTestEdges(
            this.edgeGeometry,
            this.#graphPoint(event),
            9 / this.view.zoom
        );
        if (edge) {
            event.preventDefault();
            this.selectEdge(edge.id);
        } else {
            this.clearSelection();
        }
    }

    #handleBackgroundPointerMove(event) {
        if (!this.#backgroundTarget(event.target)) return;
        const edge = hitTestEdges(
            this.edgeGeometry,
            this.#graphPoint(event),
            7 / this.view.zoom
        );
        const id = edge?.id ?? null;
        if (id === this.hoveredEdgeId) return;
        this.hoveredEdgeId = id;
        this.viewport.classList.toggle("edge-hovered", Boolean(id));
        this.#scheduleEdges();
    }

    #beginPan(event) {
        event.preventDefault();
        const start = {
            x: event.clientX,
            y: event.clientY,
            left: this.viewport.scrollLeft,
            top: this.viewport.scrollTop
        };
        this.viewport.setPointerCapture(event.pointerId);
        this.viewport.classList.add("panning");
        const move = (moveEvent) => {
            this.viewport.scrollLeft =
                start.left - (moveEvent.clientX - start.x);
            this.viewport.scrollTop =
                start.top - (moveEvent.clientY - start.y);
        };
        const finish = (upEvent) => {
            if (this.viewport.hasPointerCapture(upEvent.pointerId)) {
                this.viewport.releasePointerCapture(upEvent.pointerId);
            }
            this.viewport.removeEventListener("pointermove", move);
            this.viewport.removeEventListener("pointerup", finish);
            this.viewport.removeEventListener("pointercancel", finish);
            this.viewport.classList.remove("panning");
        };
        this.viewport.addEventListener("pointermove", move);
        this.viewport.addEventListener("pointerup", finish);
        this.viewport.addEventListener("pointercancel", finish);
    }

    #handleKeyDown(event) {
        if (event.target.closest("input, select, textarea")) return;
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

    #syncSelection() {
        this.nodeLayer.querySelectorAll(".node-editor-node").forEach((node) =>
            node.classList.toggle(
                "selected",
                node.dataset.nodeId === this.selectedNodeId
            ));
        const edge = this.model.edges.find(
            (entry) => entry.id === this.selectedEdgeId
        );
        if (edge) {
            const source = this.nodeById.get(edge.from.nodeId);
            const target = this.nodeById.get(edge.to.nodeId);
            this.selectionStatus.textContent =
                `${source.label} → ${target.label} selected · Delete removes connection`;
        } else if (this.selectedNodeId) {
            this.selectionStatus.textContent =
                `${this.nodeById.get(this.selectedNodeId)?.label ?? "Node"} selected`;
        } else {
            this.selectionStatus.textContent = "WebGPU graph surface";
        }
        this.#scheduleEdges();
    }

    selectNode(nodeId) {
        if (!this.nodeById.has(nodeId)) return;
        this.selectedNodeId = nodeId;
        this.selectedEdgeId = null;
        this.#syncSelection();
        this.callbacks.onSelectNode?.(nodeId);
    }

    selectEdge(edgeId) {
        const edge = this.model.edges.find((entry) => entry.id === edgeId);
        if (!edge) return;
        this.selectedEdgeId = edgeId;
        this.selectedNodeId = null;
        this.#syncSelection();
        this.callbacks.onSelectEdge?.(edgeId, edge);
    }

    clearSelection() {
        if (!this.selectedNodeId && !this.selectedEdgeId) return;
        this.selectedNodeId = null;
        this.selectedEdgeId = null;
        this.#syncSelection();
        this.callbacks.onClearSelection?.();
    }

    autoLayout() {
        this.positions.clear();
        const layout = layoutNodeEditorModel(this.model, this.layoutOptions);
        layout.nodes.forEach((entry) =>
            this.positions.set(entry.nodeId, { x: entry.x, y: entry.y }));
        this.#calculateLayout();
        this.#renderNodes();
        this.#sizeScene();
        this.#calculateEdges();
        this.#syncSelection();
        this.callbacks.onPositionsChange?.(this.getPositions());
    }

    setView(view) {
        this.view = {
            zoom: clampZoom(Number(view.zoom) || this.view.zoom),
            scrollLeft: Math.max(0, Number(view.scrollLeft) || 0),
            scrollTop: Math.max(0, Number(view.scrollTop) || 0)
        };
        this.#sizeScene();
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

    stats() {
        return Object.freeze({
            nodeCount: this.model?.nodes.length ?? 0,
            edgeCount: this.model?.edges.length ?? 0,
            backend: this.edgeLayer.pipeline ? "webgpu" : "initializing",
            zoom: this.view.zoom
        });
    }

    destroy() {
        cancelAnimationFrame(this.scrollFrame);
        cancelAnimationFrame(this.edgeFrame);
        this.cleanup.forEach((cleanup) => cleanup());
        this.edgeLayer.destroy();
        this.container.replaceChildren();
        this.container.classList.remove("node-editor", "gpu-unavailable");
    }
}

export function createNodeEditor(container, options) {
    return new NodeEditor(container, options);
}
