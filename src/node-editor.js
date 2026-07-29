import { hitTestEdges } from "./edge-geometry.js";
import {
    normalizeGraphView,
    screenToGraphPoint,
    zoomGraphViewFromWheel
} from "./graph-camera.js";
import { GraphWorkerClient } from "./graph-worker-client.js";
import {
    GRAPH_ANNOTATION_GEOMETRY,
    GRAPH_ANNOTATION_KINDS,
    graphAnnotationRectangle,
    nodesContainedByCommentSection,
    normalizeGraphAnnotations,
    resizeGraphAnnotation
} from "./graph-annotations.js";
import { normalizeNodeEditorModel } from "./model.js";
import {
    hasNodeTypeDragPayload,
    readNodeTypeDragPayload
} from "./node-drag-payload.js";
import { NODE_CARD_GEOMETRY } from "./node-card-geometry.js";
import { nodeEditorCommandForKey } from "./node-editor-command.js";
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
        accent = null,
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
        this.annotations = Object.freeze([]);
        this.selectedNodeId = null;
        this.selectedNodeIds = new Set();
        this.selectedAnnotationId = null;
        this.selectedEdgeId = null;
        this.hoveredEdgeId = null;
        this.selectedPort = null;
        this.view = normalizeGraphView();
        this.prepareRevision = 0;
        this.drag = null;
        this.nodeDropPreview = null;
        this.annotationCreationMode = null;
        this.destroyed = false;
        this.cleanup = [];

        container.classList.add("node-editor", "node-editor-gpu-only");
        this.viewport = element("div", "node-editor-viewport");
        this.viewport.tabIndex = 0;
        this.viewport.setAttribute("role", "application");
        this.viewport.setAttribute(
            "aria-label",
            "Node graph editor. Drag library nodes here to add them. Drag ports to connect. Drag empty space to select. Alt-drag or middle-drag to pan."
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
            accent,
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
        const onDragOver = (event) => this.#handleNodeDragOver(event);
        const onDragLeave = (event) => this.#handleNodeDragLeave(event);
        const onDrop = (event) => this.#handleNodeDrop(event);
        this.viewport.addEventListener("wheel", onWheel, { passive: false });
        this.viewport.addEventListener("pointerdown", onPointerDown);
        this.viewport.addEventListener("pointermove", onPointerMove);
        this.viewport.addEventListener("pointerup", onPointerUp);
        this.viewport.addEventListener("pointercancel", onPointerUp);
        this.viewport.addEventListener("pointerleave", onPointerLeave);
        this.viewport.addEventListener("contextmenu", onContextMenu);
        this.viewport.addEventListener("keydown", onKeyDown);
        this.viewport.addEventListener("dragover", onDragOver);
        this.viewport.addEventListener("dragleave", onDragLeave);
        this.viewport.addEventListener("drop", onDrop);
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
            () => this.viewport.removeEventListener("keydown", onKeyDown),
            () => this.viewport.removeEventListener("dragover", onDragOver),
            () => this.viewport.removeEventListener(
                "dragleave",
                onDragLeave
            ),
            () => this.viewport.removeEventListener("drop", onDrop)
        );
    }

    update(model, {
        positions = null,
        annotations = this.annotations,
        viewState = null,
        selectedNodeId = this.selectedNodeId,
        selectedNodeIds = this.selectedNodeIds,
        selectedAnnotationId = this.selectedAnnotationId,
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
            this.selectedAnnotationId = null;
            this.selectedEdgeId = null;
            this.selectedPort = null;
            this.previewStates.clear();
        }
        this.model = normalized;
        this.annotations = normalizeGraphAnnotations(annotations);
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
        this.selectedAnnotationId = this.annotations.some(
            (annotation) => annotation.id === selectedAnnotationId
        )
            ? selectedAnnotationId
            : null;
        if (this.selectedAnnotationId) {
            this.selectedNodeId = null;
            this.selectedNodeIds.clear();
            this.selectedEdgeId = null;
            this.selectedPort = null;
        }
        this.selectedEdgeId = this.selectedAnnotationId
            ? null
            : selectedEdgeId;
        this.selectedPort = this.selectedAnnotationId
            ? null
            : selectedPort;
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
            sceneOptions: {
                ...this.layoutOptions,
                annotations: this.annotations
            }
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
            `${this.model.nodes.length} nodes · ${this.model.edges.length} connections · ${this.annotations.length} notes · accelerated rendering`;
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

    #nodeDropRectangle(graphPoint) {
        const width = Number.isFinite(this.layoutOptions.nodeWidth)
            ? this.layoutOptions.nodeWidth
            : NODE_CARD_GEOMETRY.nodeWidth;
        const height = Number.isFinite(this.layoutOptions.minimumNodeHeight)
            ? this.layoutOptions.minimumNodeHeight
            : NODE_CARD_GEOMETRY.minimumNodeHeight;
        return Object.freeze({
            left: graphPoint.x - width / 2,
            top: graphPoint.y - height / 2,
            right: graphPoint.x + width / 2,
            bottom: graphPoint.y + height / 2
        });
    }

    #clearNodeDropPreview() {
        if (!this.nodeDropPreview) return;
        this.nodeDropPreview = null;
        this.viewport.classList.remove("accepting-node-drop");
        this.#syncInteraction();
    }

    #handleNodeDragOver(event) {
        if (!hasNodeTypeDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const graphPoint = this.#graphPoint(event);
        this.nodeDropPreview = this.#nodeDropRectangle(graphPoint);
        this.viewport.classList.add("accepting-node-drop");
        this.#syncInteraction();
    }

    #handleNodeDragLeave(event) {
        if (
            event.relatedTarget
            && this.viewport.contains(event.relatedTarget)
        ) {
            return;
        }
        this.#clearNodeDropPreview();
    }

    #handleNodeDrop(event) {
        const nodeTypeId = readNodeTypeDragPayload(event.dataTransfer);
        if (!nodeTypeId) return;
        event.preventDefault();
        const requestPoint = this.#requestPoint(event);
        const nodeRectangle = this.#nodeDropRectangle(
            requestPoint.graphPoint
        );
        this.#clearNodeDropPreview();
        this.callbacks.onDropNode?.({
            nodeTypeId,
            ...requestPoint,
            nodePosition: Object.freeze({
                x: nodeRectangle.left,
                y: nodeRectangle.top
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

    #annotationAt(point) {
        if (!this.scene?.hitAnnotations) return null;
        const border = 8 / this.view.zoom;
        for (
            let index = this.scene.hitAnnotations.length - 1;
            index >= 0;
            index -= 1
        ) {
            const annotation = this.scene.hitAnnotations[index];
            const right = annotation.x + annotation.width;
            const bottom = annotation.y + annotation.height;
            if (
                point.x < annotation.x - border
                || point.x > right + border
                || point.y < annotation.y - border
                || point.y > bottom + border
            ) {
                continue;
            }
            const resize = annotation.resizeHandleSize > 0
                && point.x >= right
                    - annotation.resizeHandleSize
                    - border
                && point.y >= bottom
                    - annotation.resizeHandleSize
                    - border;
            if (resize) return { annotation, region: "resize" };
            if (annotation.kind === GRAPH_ANNOTATION_KINDS.comment) {
                return { annotation, region: "body" };
            }
            const header = point.y <= annotation.y + annotation.headerHeight;
            const onBorder = point.x <= annotation.x + border
                || point.x >= right - border
                || point.y <= annotation.y + border
                || point.y >= bottom - border;
            if (header || onBorder) {
                return {
                    annotation,
                    region: header ? "header" : "border"
                };
            }
        }
        return null;
    }

    #replaceAnnotation(nextAnnotation) {
        this.annotations = normalizeGraphAnnotations(
            this.annotations.map((annotation) =>
                annotation.id === nextAnnotation.id
                    ? nextAnnotation
                    : annotation)
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
        const rect = this.canvas.getBoundingClientRect();
        const local = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
        this.setView(zoomGraphViewFromWheel(
            this.view,
            event,
            local,
            this.viewport.clientHeight
        ));
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
        const annotationHit = this.#annotationAt(point);
        if (annotationHit) {
            const { annotation, region } = annotationHit;
            this.selectAnnotation(annotation.id);
            const startingPositions = {};
            if (annotation.kind === GRAPH_ANNOTATION_KINDS.section) {
                const containedNodeIds = nodesContainedByCommentSection(
                    annotation,
                    this.#liveNodes()
                );
                containedNodeIds.forEach((nodeId) => {
                    const index = this.scene.nodeIndexById[nodeId];
                    if (!Number.isInteger(index)) return;
                    const liveNode = this.#liveNode(index);
                    startingPositions[nodeId] = {
                        x: liveNode.x,
                        y: liveNode.y
                    };
                });
            }
            this.drag = {
                kind: region === "resize"
                    ? "annotation-resize"
                    : "annotation",
                pointerId,
                annotationId: annotation.id,
                start: point,
                current: point,
                clientX: event.clientX,
                clientY: event.clientY,
                startingAnnotation: { ...annotation },
                startingPositions
            };
            this.viewport.classList.add(
                region === "resize"
                    ? "resizing-annotation"
                    : "dragging-annotation"
            );
            this.viewport.setPointerCapture(pointerId);
            return;
        }
        const edge = this.#edgeAt(point);
        if (edge) {
            this.selectEdge(edge.id);
            return;
        }
        if (
            this.annotationCreationMode
            === GRAPH_ANNOTATION_KINDS.section
        ) {
            this.drag = {
                kind: "annotation-create",
                pointerId,
                start: point,
                current: point,
                clientX: event.clientX,
                clientY: event.clientY,
                moved: false
            };
            this.selectedNodeId = null;
            this.selectedNodeIds.clear();
            this.selectedAnnotationId = null;
            this.selectedEdgeId = null;
            this.selectedPort = null;
            this.viewport.classList.add("creating-annotation");
            this.viewport.setPointerCapture(pointerId);
            this.#syncInteraction();
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
            this.selectedAnnotationId = null;
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
            if (
                this.drag.kind === "annotation-create"
                || this.drag.kind === "annotation-resize"
            ) {
                const rawPoint = this.#graphPoint(event);
                const point = this.drag.kind === "annotation-resize"
                    ? {
                        x: Math.max(
                            this.drag.startingAnnotation.x
                                + GRAPH_ANNOTATION_GEOMETRY[
                                    this.drag.startingAnnotation.kind
                                ].minimumWidth,
                            rawPoint.x
                        ),
                        y: Math.max(
                            this.drag.startingAnnotation.y
                                + GRAPH_ANNOTATION_GEOMETRY[
                                    this.drag.startingAnnotation.kind
                                ].minimumHeight,
                            rawPoint.y
                        )
                    }
                    : rawPoint;
                this.drag.current = point;
                this.drag.moved ||= Math.hypot(
                    event.clientX - this.drag.clientX,
                    event.clientY - this.drag.clientY
                ) >= 3;
                this.#syncInteraction();
                return;
            }
            const delta = {
                x: (event.clientX - this.drag.clientX) / this.view.zoom,
                y: (event.clientY - this.drag.clientY) / this.view.zoom
            };
            if (this.drag.kind === "annotation") {
                const annotation = {
                    ...this.drag.startingAnnotation,
                    x: this.drag.startingAnnotation.x + delta.x,
                    y: this.drag.startingAnnotation.y + delta.y
                };
                this.#replaceAnnotation(annotation);
                this.surface.setNodePosition(
                    this.drag.annotationId,
                    annotation
                );
            }
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
        const annotation = node ? null : this.#annotationAt(point);
        this.viewport.classList.toggle("port-hovered", Boolean(port));
        this.viewport.classList.toggle(
            "node-header-hovered",
            Boolean(node && point.y - node.y <= node.headerHeight)
        );
        this.viewport.classList.toggle(
            "annotation-hovered",
            Boolean(annotation)
        );
        this.viewport.classList.toggle(
            "annotation-resize-hovered",
            annotation?.region === "resize"
        );
        const edge = node || annotation ? null : this.#edgeAt(point, 7);
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
            "dragging-annotation",
            "resizing-annotation",
            "creating-annotation",
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
        if (drag.kind === "annotation") {
            this.callbacks.onAnnotationsChange?.(
                this.getAnnotations(),
                {
                    kind: "move",
                    annotationId: drag.annotationId,
                    positions: this.getPositions()
                }
            );
            this.prepared = this.#prepareScene();
            return;
        }
        if (drag.kind === "annotation-resize") {
            const annotation = resizeGraphAnnotation(
                drag.startingAnnotation,
                {
                    left: drag.startingAnnotation.x,
                    top: drag.startingAnnotation.y,
                    right: drag.current.x,
                    bottom: drag.current.y
                }
            );
            this.#replaceAnnotation(annotation);
            this.callbacks.onAnnotationsChange?.(
                this.getAnnotations(),
                {
                    kind: "resize",
                    annotationId: drag.annotationId,
                    positions: this.getPositions()
                }
            );
            this.prepared = this.#prepareScene();
            this.#syncInteraction();
            return;
        }
        if (drag.kind === "annotation-create") {
            const rectangle = selectionRectangle(
                drag.start,
                drag.moved
                    ? drag.current
                    : {
                        x: drag.start.x
                            + GRAPH_ANNOTATION_GEOMETRY.section.width,
                        y: drag.start.y
                            + GRAPH_ANNOTATION_GEOMETRY.section.height
                    }
            );
            this.annotationCreationMode = null;
            this.viewport.classList.remove("creating-comment-section");
            this.callbacks.onCreateAnnotation?.({
                kind: GRAPH_ANNOTATION_KINDS.section,
                x: rectangle.left,
                y: rectangle.top,
                width: Math.max(
                    GRAPH_ANNOTATION_GEOMETRY.section.minimumWidth,
                    rectangle.width
                ),
                height: Math.max(
                    GRAPH_ANNOTATION_GEOMETRY.section.minimumHeight,
                    rectangle.height
                )
            });
            this.#syncInteraction();
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
        this.viewport.focus({ preventScroll: true });
        if (this.#portAt(point)) return;
        const node = this.#nodeAt(point);
        if (node) {
            if (node.terminal) return;
            if (!this.selectedNodeIds.has(node.id)) {
                this.selectNode(node.id);
            }
            this.callbacks.onRequestSelectionActions?.({
                ...this.#requestPoint(event),
                nodeIds: [...this.selectedNodeIds],
                primaryNodeId: this.selectedNodeId
            });
            return;
        }
        if (this.#annotationAt(point) || this.#edgeAt(point)) return;
        this.callbacks.onRequestNode?.({
            ...this.#requestPoint(event),
            sourcePort: null
        });
    }

    #handleKeyDown(event) {
        const command = nodeEditorCommandForKey(event, {
            hasSelection: this.selectedNodeIds.size > 0
        });
        if (command) {
            event.preventDefault();
            if (command === "copy") {
                this.callbacks.onCopyNodes?.([...this.selectedNodeIds]);
            } else if (command === "duplicate") {
                this.callbacks.onDuplicateNodes?.(
                    [...this.selectedNodeIds]
                );
            } else {
                this.callbacks.onPasteNodes?.({
                    graphPoint: this.graphViewportCenter()
                });
            }
            return;
        }
        if (event.key === "Escape") {
            if (this.annotationCreationMode) {
                this.annotationCreationMode = null;
                this.viewport.classList.remove("creating-comment-section");
                this.selectionStatus.textContent =
                    "Comment section creation cancelled";
                return;
            }
            this.clearSelection();
            return;
        }
        if (!["Delete", "Backspace"].includes(event.key)) return;
        if (this.selectedAnnotationId) {
            event.preventDefault();
            const annotation = this.annotations.find(
                (entry) => entry.id === this.selectedAnnotationId
            );
            if (annotation) {
                this.callbacks.onDeleteAnnotation?.(
                    annotation.id,
                    annotation
                );
            }
        } else if (this.selectedEdgeId) {
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
            selectedAnnotationId: this.selectedAnnotationId,
            selectedEdgeId: this.selectedEdgeId,
            hoveredEdgeId: this.hoveredEdgeId,
            selectedPort: this.selectedPort,
            connectionPreview: this.drag?.kind === "connection"
                ? {
                    sourcePort: this.drag.sourcePort,
                    point: this.drag.point
                }
                : null,
            selectionRect: (
                this.drag?.kind === "selection"
                || this.drag?.kind === "annotation-create"
            ) && this.drag.moved
                ? selectionRectangle(this.drag.start, this.drag.current)
                : this.drag?.kind === "annotation-resize"
                    ? selectionRectangle(
                        {
                            x: this.drag.startingAnnotation.x,
                            y: this.drag.startingAnnotation.y
                        },
                        this.drag.current
                    )
                    : null,
            dropRect: this.nodeDropPreview
        });
        const edge = this.model?.edges.find(
            (entry) => entry.id === this.selectedEdgeId
        );
        const annotation = this.annotations.find(
            (entry) => entry.id === this.selectedAnnotationId
        );
        if (annotation) {
            this.selectionStatus.textContent =
                `${annotation.title} selected · drag to move · Delete removes`;
        } else if (edge) {
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
                `${this.selectedNodeIds.size} nodes selected - Ctrl C copies - Ctrl D duplicates`;
        } else if (this.selectedNodeId) {
            const node = this.model?.nodes.find(
                (entry) => entry.id === this.selectedNodeId
            );
            this.selectionStatus.textContent =
                `${node?.label ?? "Node"} selected - Ctrl D duplicates`;
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
        this.selectedAnnotationId = null;
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
        this.selectedAnnotationId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.callbacks.onSelectEdge?.(edgeId, edge);
    }

    selectAnnotation(annotationId) {
        const annotation = this.annotations.find(
            (entry) => entry.id === annotationId
        );
        if (!annotation) return;
        this.selectedAnnotationId = annotationId;
        this.selectedNodeId = null;
        this.selectedNodeIds.clear();
        this.selectedEdgeId = null;
        this.selectedPort = null;
        this.#syncInteraction();
        this.callbacks.onSelectAnnotation?.(annotationId, annotation);
    }

    clearSelection() {
        if (
            !this.selectedNodeId
            && this.selectedNodeIds.size === 0
            && !this.selectedAnnotationId
            && !this.selectedEdgeId
            && !this.selectedPort
        ) {
            return;
        }
        this.selectedNodeId = null;
        this.selectedNodeIds.clear();
        this.selectedAnnotationId = null;
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

    beginCommentSectionCreation() {
        this.annotationCreationMode = GRAPH_ANNOTATION_KINDS.section;
        this.clearSelection();
        this.viewport.classList.add("creating-comment-section");
        this.selectionStatus.textContent =
            "Draw a rectangle on empty graph space to create a comment section";
        this.viewport.focus({ preventScroll: true });
    }

    graphViewportCenter() {
        return screenToGraphPoint(this.view, {
            x: this.canvas.clientWidth / 2,
            y: this.canvas.clientHeight / 2
        });
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

    getAnnotations() {
        return Object.freeze(this.annotations.map(
            (annotation) => Object.freeze({ ...annotation })
        ));
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
