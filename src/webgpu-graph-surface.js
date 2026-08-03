import { createGpuFontAtlas } from "./gpu-font-atlas.js";
import { resolveNodeEditorAccent } from "./node-editor-theme.js";
import {
    graphEdgeVisible,
    graphRectVisible,
    graphViewportBounds
} from "./viewport-culling.js";
import {
    EDGE_COMPUTE_SHADER,
    EDGE_RENDER_SHADER,
    GLYPH_SHADER,
    GRID_SHADER,
    INTERACTION_OVERLAY_SHADER,
    PREVIEW_SHADER,
    SHAPE_COMPUTE_SHADER,
    SHAPE_RENDER_SHADER
} from "./gpu-graph-shaders.js";

const CAMERA_FLOATS = 20;
const EDGE_SEGMENTS = 24;
const EDGE_VERTICES_PER_SEGMENT = 6;
const EDGE_VERTEX_BYTES = 32;

const ALPHA_BLEND = Object.freeze({
    color: {
        srcFactor: "src-alpha",
        dstFactor: "one-minus-src-alpha",
        operation: "add"
    },
    alpha: {
        srcFactor: "one",
        dstFactor: "one-minus-src-alpha",
        operation: "add"
    }
});

function createBuffer(device, label, data, usage) {
    const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
    const buffer = device.createBuffer({ label, size, usage });
    if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

function createEmptyBuffer(device, label, byteLength, usage) {
    const size = Math.max(16, Math.ceil(byteLength / 4) * 4);
    return device.createBuffer({ label, size, usage });
}

function shader(device, label, code) {
    return device.createShaderModule({ label, code });
}

function renderTarget(format, blend = undefined) {
    return [{ format, blend }];
}

function edgeTypeIndex(type) {
    return type === "grayscale" ? 0
        : type === "color" ? 1
            : type === "bundle" ? 2
                : 3;
}

export class WebGpuGraphSurface {
    constructor(canvas, {
        device = null,
        accent = null,
        onStatus = null
    } = {}) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("WebGpuGraphSurface requires a canvas");
        }
        this.canvas = canvas;
        this.device = device;
        this.accent = resolveNodeEditorAccent(canvas, accent);
        this.onStatus = onStatus;
        this.context = null;
        this.format = null;
        this.scene = null;
        this.view = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
        this.interaction = {
            selectedNodeId: null,
            selectedNodeIds: [],
            selectedAnnotationId: null,
            selectedEdgeId: null,
            hoveredEdgeId: null,
            selectedPort: null,
            highlightedPort: null,
            connectionPreview: null,
            selectionRect: null,
            dropRect: null
        };
        this.dynamicEdgeVisible = false;
        this.previewTextures = new Map();
        this.previewBindGroups = new WeakMap();
        this.visibility = {
            nodeCount: 0,
            transformCount: 0,
            shapeCount: 0,
            shapeBuckets: [0, 0, 0],
            glyphCount: 0,
            edgeCount: 0
        };
        this.sceneBuffers = [];
        this.frame = 0;
        this.destroyed = false;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
    }

    async initialize(device = this.device) {
        if (!device) {
            if (!navigator.gpu) {
                throw new Error("Graphics acceleration is required for the graph editor");
            }
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: "high-performance"
            });
            if (!adapter) throw new Error("No compatible graphics adapter is available");
            device = await adapter.requestDevice();
        }
        this.device = device;
        this.deviceErrorHandler = (event) => {
            const message = event.error?.message ?? "Unknown WebGPU error";
            console.error(`Node editor WebGPU error: ${message}`);
            this.onStatus?.({ backend: "error", message });
        };
        device.addEventListener("uncapturederror", this.deviceErrorHandler);
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) {
            throw new Error("Could not create the accelerated canvas context");
        }
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device,
            format: this.format,
            alphaMode: "opaque"
        });
        this.cameraBuffer = device.createBuffer({
            label: "Node editor camera",
            size: CAMERA_FLOATS * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.overlayBuffer = device.createBuffer({
            label: "Node editor interaction overlay",
            size: 4 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.previewSampler = device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge"
        });
        this.fontAtlas = await createGpuFontAtlas(device);
        device.pushErrorScope("validation");
        this.#createPipelines();
        const pipelineError = await device.popErrorScope();
        if (pipelineError) {
            throw new Error(
                `Node editor rendering pipeline failed: ${pipelineError.message}`
            );
        }
        this.resize();
        this.onStatus?.({
            backend: "webgpu",
            worker: true,
            compute: true
        });
        return this;
    }

    #createPipelines() {
        const device = this.device;
        const gridModule = shader(device, "Node editor grid", GRID_SHADER);
        const shapeComputeModule = shader(
            device,
            "Node editor shape compute",
            SHAPE_COMPUTE_SHADER
        );
        const shapeRenderModule = shader(
            device,
            "Node editor shape render",
            SHAPE_RENDER_SHADER
        );
        const edgeComputeModule = shader(
            device,
            "Node editor edge compute",
            EDGE_COMPUTE_SHADER
        );
        const edgeRenderModule = shader(
            device,
            "Node editor edge render",
            EDGE_RENDER_SHADER
        );
        const glyphModule = shader(device, "Node editor glyphs", GLYPH_SHADER);
        const previewModule = shader(
            device,
            "Node editor previews",
            PREVIEW_SHADER
        );
        const interactionOverlayModule = shader(
            device,
            "Node editor interaction overlay",
            INTERACTION_OVERLAY_SHADER
        );
        this.gridPipeline = device.createRenderPipeline({
            label: "Node editor grid pipeline",
            layout: "auto",
            vertex: { module: gridModule, entryPoint: "vertexMain" },
            fragment: {
                module: gridModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format)
            },
            primitive: { topology: "triangle-list" }
        });
        this.shapeComputePipeline = device.createComputePipeline({
            label: "Node editor shape compute pipeline",
            layout: "auto",
            compute: {
                module: shapeComputeModule,
                entryPoint: "computeMain"
            }
        });
        this.shapePipeline = device.createRenderPipeline({
            label: "Node editor shape pipeline",
            layout: "auto",
            vertex: {
                module: shapeRenderModule,
                entryPoint: "vertexMain"
            },
            fragment: {
                module: shapeRenderModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format, ALPHA_BLEND)
            },
            primitive: { topology: "triangle-list" }
        });
        this.edgeComputePipeline = device.createComputePipeline({
            label: "Node editor edge compute pipeline",
            layout: "auto",
            compute: {
                module: edgeComputeModule,
                entryPoint: "computeMain"
            }
        });
        this.edgePipeline = device.createRenderPipeline({
            label: "Node editor edge pipeline",
            layout: "auto",
            vertex: {
                module: edgeRenderModule,
                entryPoint: "vertexMain",
                buffers: [{
                    arrayStride: EDGE_VERTEX_BYTES,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x4"
                        },
                        {
                            shaderLocation: 1,
                            offset: 16,
                            format: "float32x4"
                        }
                    ]
                }]
            },
            fragment: {
                module: edgeRenderModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format, ALPHA_BLEND)
            },
            primitive: { topology: "triangle-list" }
        });
        this.glyphPipeline = device.createRenderPipeline({
            label: "Node editor glyph pipeline",
            layout: "auto",
            vertex: { module: glyphModule, entryPoint: "vertexMain" },
            fragment: {
                module: glyphModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format, ALPHA_BLEND)
            },
            primitive: { topology: "triangle-list" }
        });
        this.previewPipeline = device.createRenderPipeline({
            label: "Node editor preview pipeline",
            layout: "auto",
            vertex: { module: previewModule, entryPoint: "vertexMain" },
            fragment: {
                module: previewModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format)
            },
            primitive: { topology: "triangle-list" }
        });
        this.interactionOverlayPipeline = device.createRenderPipeline({
            label: "Node editor interaction overlay pipeline",
            layout: "auto",
            vertex: {
                module: interactionOverlayModule,
                entryPoint: "vertexMain"
            },
            fragment: {
                module: interactionOverlayModule,
                entryPoint: "fragmentMain",
                targets: renderTarget(this.format, ALPHA_BLEND)
            },
            primitive: { topology: "triangle-list" }
        });
        this.gridBindGroup = device.createBindGroup({
            label: "Node editor grid bindings",
            layout: this.gridPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
        });
        this.interactionOverlayBindGroup = device.createBindGroup({
            label: "Node editor interaction overlay bindings",
            layout: this.interactionOverlayPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.overlayBuffer } }
            ]
        });
    }

    setScene(scene) {
        if (!this.device) throw new Error("Graph surface is not initialized");
        this.#destroySceneBuffers();
        this.scene = scene;
        this.staticEdgeCount = scene.edges.length / 12;
        this.dynamicEdgeVisible = false;
        const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        const gpuNodeRecords = new Float32Array(
            scene.nodeRecords.length + 4
        );
        gpuNodeRecords.set(scene.nodeRecords);
        this.gpuNodeRecords = gpuNodeRecords;
        this.nodeBuffer = createBuffer(
            this.device,
            "Node editor nodes",
            gpuNodeRecords,
            storage
        );
        this.nodeSelection = new Uint32Array(Math.max(
            4,
            scene.nodeRecords.length / 4
        ));
        this.nodeSelectionBuffer = createBuffer(
            this.device,
            "Node editor selection flags",
            this.nodeSelection,
            storage
        );
        this.shapeInputBuffer = createBuffer(
            this.device,
            "Node editor shape input",
            scene.shapes,
            storage
        );
        this.shapeOutputBuffer = createBuffer(
            this.device,
            "Node editor shape output",
            scene.shapes,
            storage
        );
        this.gpuEdgeRecords = new Float32Array(scene.edges.length + 12);
        this.gpuEdgeRecords.set(scene.edges);
        this.edgeBuffer = createBuffer(
            this.device,
            "Node editor edge input",
            this.gpuEdgeRecords,
            storage
        );
        const edgeVertexSize = Math.max(
            16,
            (this.staticEdgeCount + 1)
                * EDGE_SEGMENTS
                * EDGE_VERTICES_PER_SEGMENT
                * EDGE_VERTEX_BYTES
        );
        this.edgeVertexBuffer = this.device.createBuffer({
            label: "Node editor computed edge vertices",
            size: edgeVertexSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
        });
        this.glyphBuffer = createBuffer(
            this.device,
            "Node editor glyph input",
            scene.glyphs,
            storage
        );
        this.previewBuffer = createBuffer(
            this.device,
            "Node editor preview input",
            scene.previews,
            storage
        );
        const shapeCount = scene.shapes.length / 16;
        const glyphCount = scene.glyphs.length / 16;
        this.visibleShapeIndexBuffer = createEmptyBuffer(
            this.device,
            "Node editor visible shape indexes",
            shapeCount * Uint32Array.BYTES_PER_ELEMENT,
            storage
        );
        this.visibleGlyphIndexBuffer = createEmptyBuffer(
            this.device,
            "Node editor visible glyph indexes",
            glyphCount * Uint32Array.BYTES_PER_ELEMENT,
            storage
        );
        this.visibleEdgeIndexBuffer = createEmptyBuffer(
            this.device,
            "Node editor visible edge indexes",
            (this.staticEdgeCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
            storage
        );
        this.sceneBuffers = [
            this.nodeBuffer,
            this.nodeSelectionBuffer,
            this.shapeInputBuffer,
            this.shapeOutputBuffer,
            this.edgeBuffer,
            this.edgeVertexBuffer,
            this.glyphBuffer,
            this.previewBuffer,
            this.visibleShapeIndexBuffer,
            this.visibleGlyphIndexBuffer,
            this.visibleEdgeIndexBuffer
        ];
        this.#prepareVisibilityState();
        this.#createSceneBindGroups();
        this.#writeNodeSelection();
        this.#writeConnectionPreview();
        this.render();
    }

    #prepareVisibilityState() {
        const scene = this.scene;
        const transformCount = scene.nodeRecords.length / 4;
        const shapeCount = scene.shapes.length / 16;
        const glyphCount = scene.glyphs.length / 16;
        const shapeIndicesByNode = Array.from(
            { length: transformCount },
            () => []
        );
        for (let index = 0; index < shapeCount; index += 1) {
            const nodeIndex = scene.shapes[index * 16 + 15];
            shapeIndicesByNode[nodeIndex].push(index);
        }
        const glyphIndicesByNode = Array.from(
            { length: transformCount },
            () => []
        );
        for (let index = 0; index < glyphCount; index += 1) {
            const nodeIndex = scene.glyphs[index * 16 + 12];
            glyphIndicesByNode[nodeIndex].push(index);
        }
        const backdropCount = scene.backdropShapeCount ?? 0;
        const underlayCount = scene.underlayShapeCount ?? shapeCount;
        this.shapeIndicesByNode = shapeIndicesByNode;
        this.glyphIndicesByNode = glyphIndicesByNode;
        this.visibleTransformFlags = new Uint8Array(transformCount);
        this.visibleShapeBuckets = [
            new Uint32Array(backdropCount),
            new Uint32Array(Math.max(0, underlayCount - backdropCount)),
            new Uint32Array(Math.max(0, shapeCount - underlayCount))
        ];
        this.visibleGlyphIndices = new Uint32Array(glyphCount);
        this.visibleEdgeIndices = new Uint32Array(this.staticEdgeCount + 1);
        this.visibility = {
            nodeCount: 0,
            transformCount: 0,
            shapeCount: 0,
            shapeBuckets: [0, 0, 0],
            glyphCount: 0,
            edgeCount: 0
        };
    }

    #createSceneBindGroups() {
        const device = this.device;
        this.shapeComputeBindGroup = device.createBindGroup({
            label: "Node editor shape compute bindings",
            layout: this.shapeComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.nodeBuffer } },
                { binding: 2, resource: { buffer: this.shapeInputBuffer } },
                { binding: 3, resource: { buffer: this.shapeOutputBuffer } },
                { binding: 4, resource: { buffer: this.nodeSelectionBuffer } },
                { binding: 5, resource: { buffer: this.visibleShapeIndexBuffer } }
            ]
        });
        this.shapeBindGroup = device.createBindGroup({
            label: "Node editor shape bindings",
            layout: this.shapePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.shapeOutputBuffer } }
            ]
        });
        this.edgeComputeBindGroup = device.createBindGroup({
            label: "Node editor edge compute bindings",
            layout: this.edgeComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.nodeBuffer } },
                { binding: 2, resource: { buffer: this.edgeBuffer } },
                { binding: 3, resource: { buffer: this.edgeVertexBuffer } },
                { binding: 4, resource: { buffer: this.visibleEdgeIndexBuffer } }
            ]
        });
        this.edgeBindGroup = device.createBindGroup({
            label: "Node editor edge bindings",
            layout: this.edgePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
        });
        this.glyphBindGroup = device.createBindGroup({
            label: "Node editor glyph bindings",
            layout: this.glyphPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.nodeBuffer } },
                { binding: 2, resource: { buffer: this.glyphBuffer } },
                { binding: 3, resource: this.fontAtlas.sampler },
                { binding: 4, resource: this.fontAtlas.view },
                { binding: 5, resource: { buffer: this.visibleGlyphIndexBuffer } }
            ]
        });
        this.previewSceneBindGroup = device.createBindGroup({
            label: "Node editor preview scene bindings",
            layout: this.previewPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.nodeBuffer } },
                { binding: 2, resource: { buffer: this.previewBuffer } }
            ]
        });
        this.previewBindGroups = new WeakMap();
    }

    setView(view) {
        this.view = { ...this.view, ...view };
        this.render();
    }

    setInteraction(interaction) {
        this.interaction = { ...this.interaction, ...interaction };
        this.#writeNodeSelection();
        this.#writeConnectionPreview();
        this.render();
    }

    #writeNodeSelection() {
        if (!this.scene || !this.nodeSelectionBuffer) return;
        this.nodeSelection.fill(0);
        const ids = [...(this.interaction.selectedNodeIds?.length
            ? this.interaction.selectedNodeIds
            : [this.interaction.selectedNodeId].filter(Boolean))];
        if (this.interaction.selectedAnnotationId) {
            ids.push(this.interaction.selectedAnnotationId);
        }
        ids.forEach((id) => {
            const index = this.scene.nodeIndexById[id]
                ?? this.scene.annotationIndexById?.[id];
            if (Number.isInteger(index)) this.nodeSelection[index] = 1;
        });
        this.device.queue.writeBuffer(
            this.nodeSelectionBuffer,
            0,
            this.nodeSelection
        );
    }

    #writeConnectionPreview() {
        if (!this.scene || !this.edgeBuffer || !this.nodeBuffer) return;
        const preview = this.interaction.connectionPreview;
        const source = preview?.sourcePort;
        const nodeIndex = source
            ? this.scene.nodeIndexById[source.nodeId]
            : null;
        const node = Number.isInteger(nodeIndex)
            ? this.scene.hitNodes[nodeIndex]
            : null;
        const port = node?.ports.find((entry) =>
            entry.id === source.port
            && entry.direction === source.direction);
        if (!preview?.point || !node || !port) {
            this.dynamicEdgeVisible = false;
            return;
        }
        const virtualNodeIndex = this.scene.nodeRecords.length / 4;
        const virtualNode = new Float32Array([
            preview.point.x,
            preview.point.y,
            0,
            0
        ]);
        this.gpuNodeRecords.set(virtualNode, virtualNodeIndex * 4);
        this.device.queue.writeBuffer(
            this.nodeBuffer,
            virtualNodeIndex * 4 * Float32Array.BYTES_PER_ELEMENT,
            virtualNode
        );
        const outputFirst = source.direction === "output";
        const record = new Float32Array([
            outputFirst ? nodeIndex : virtualNodeIndex,
            outputFirst ? virtualNodeIndex : nodeIndex,
            outputFirst ? port.x : 0,
            outputFirst ? port.y : 0,
            outputFirst ? 0 : port.x,
            outputFirst ? 0 : port.y,
            edgeTypeIndex(source.type),
            this.staticEdgeCount,
            source.type === "bundle" ? 2.4 : 1.7,
            0,
            0,
            0
        ]);
        this.gpuEdgeRecords.set(record, this.staticEdgeCount * 12);
        this.device.queue.writeBuffer(
            this.edgeBuffer,
            this.staticEdgeCount
                * 12
                * Float32Array.BYTES_PER_ELEMENT,
            record
        );
        this.dynamicEdgeVisible = true;
    }

    setNodePosition(nodeId, position) {
        const index = this.scene?.nodeIndexById?.[nodeId]
            ?? this.scene?.annotationIndexById?.[nodeId];
        if (!Number.isInteger(index)) return;
        const offset = index * 4;
        this.scene.nodeRecords[offset] = position.x;
        this.scene.nodeRecords[offset + 1] = position.y;
        this.gpuNodeRecords[offset] = position.x;
        this.gpuNodeRecords[offset + 1] = position.y;
        this.device.queue.writeBuffer(
            this.nodeBuffer,
            offset * Float32Array.BYTES_PER_ELEMENT,
            this.scene.nodeRecords.subarray(offset, offset + 2)
        );
        this.render();
    }

    setPreviewTextures(textures) {
        this.previewTextures = textures instanceof Map
            ? new Map(textures)
            : new Map(Object.entries(textures ?? {}));
        this.render();
    }

    resize() {
        if (!this.context || this.destroyed) return;
        const rect = this.canvas.getBoundingClientRect();
        const ratio = Math.min(
            2,
            Math.max(1, globalThis.devicePixelRatio || 1)
        );
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
        this.render();
    }

    render() {
        if (!this.scene || !this.device || this.destroyed) return;
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.#draw());
    }

    #cullScene() {
        const scene = this.scene;
        const nodeRecords = this.gpuNodeRecords;
        const transformCount = scene.nodeRecords.length / 4;
        const modelNodeCount = scene.hitNodes.length;
        const backdropBoundary = scene.backdropShapeCount ?? 0;
        const underlayBoundary = scene.underlayShapeCount
            ?? scene.shapes.length / 16;
        const bounds = graphViewportBounds(
            this.view,
            this.canvas.clientWidth,
            this.canvas.clientHeight
        );
        let visibleNodeCount = 0;
        let visibleTransformCount = 0;
        let visibleBackdropCount = 0;
        let visibleUnderlayCount = 0;
        let visibleOverlayCount = 0;
        let visibleGlyphCount = 0;

        for (let nodeIndex = 0; nodeIndex < transformCount; nodeIndex += 1) {
            const offset = nodeIndex * 4;
            const visible = graphRectVisible(
                nodeRecords[offset],
                nodeRecords[offset + 1],
                nodeRecords[offset + 2],
                nodeRecords[offset + 3],
                bounds
            );
            this.visibleTransformFlags[nodeIndex] = visible ? 1 : 0;
            if (!visible) continue;
            visibleTransformCount += 1;
            if (nodeIndex < modelNodeCount) visibleNodeCount += 1;

            const shapeIndexes = this.shapeIndicesByNode[nodeIndex];
            for (let index = 0; index < shapeIndexes.length; index += 1) {
                const shapeIndex = shapeIndexes[index];
                if (shapeIndex < backdropBoundary) {
                    this.visibleShapeBuckets[0][visibleBackdropCount] = shapeIndex;
                    visibleBackdropCount += 1;
                } else if (shapeIndex < underlayBoundary) {
                    this.visibleShapeBuckets[1][visibleUnderlayCount] = shapeIndex;
                    visibleUnderlayCount += 1;
                } else {
                    this.visibleShapeBuckets[2][visibleOverlayCount] = shapeIndex;
                    visibleOverlayCount += 1;
                }
            }

            const glyphIndexes = this.glyphIndicesByNode[nodeIndex];
            for (let index = 0; index < glyphIndexes.length; index += 1) {
                this.visibleGlyphIndices[visibleGlyphCount] = glyphIndexes[index];
                visibleGlyphCount += 1;
            }
        }

        const shapeCounts = [
            visibleBackdropCount,
            visibleUnderlayCount,
            visibleOverlayCount
        ];
        let visibleShapeCount = 0;
        // Stable per-layer ordering prevents overlapping translucent cards from
        // changing appearance as the visible set changes.
        for (let bucket = 0; bucket < shapeCounts.length; bucket += 1) {
            const count = shapeCounts[bucket];
            if (count > 1) {
                this.visibleShapeBuckets[bucket].subarray(0, count).sort();
            }
            if (count > 0) {
                this.device.queue.writeBuffer(
                    this.visibleShapeIndexBuffer,
                    visibleShapeCount * Uint32Array.BYTES_PER_ELEMENT,
                    this.visibleShapeBuckets[bucket].subarray(0, count)
                );
            }
            visibleShapeCount += count;
        }

        if (visibleGlyphCount > 1) {
            this.visibleGlyphIndices.subarray(0, visibleGlyphCount).sort();
        }
        if (visibleGlyphCount > 0) {
            this.device.queue.writeBuffer(
                this.visibleGlyphIndexBuffer,
                0,
                this.visibleGlyphIndices.subarray(0, visibleGlyphCount)
            );
        }

        const edgeCount = this.staticEdgeCount
            + (this.dynamicEdgeVisible ? 1 : 0);
        let visibleEdgeCount = 0;
        // Conservative curve bounds keep viewport-crossing connections even
        // when neither endpoint node itself is visible.
        for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
            if (!graphEdgeVisible(
                this.gpuNodeRecords,
                this.gpuEdgeRecords,
                edgeIndex,
                bounds
            )) {
                continue;
            }
            this.visibleEdgeIndices[visibleEdgeCount] = edgeIndex;
            visibleEdgeCount += 1;
        }
        if (visibleEdgeCount > 0) {
            this.device.queue.writeBuffer(
                this.visibleEdgeIndexBuffer,
                0,
                this.visibleEdgeIndices.subarray(0, visibleEdgeCount)
            );
        }

        this.visibility.nodeCount = visibleNodeCount;
        this.visibility.transformCount = visibleTransformCount;
        this.visibility.shapeCount = visibleShapeCount;
        this.visibility.shapeBuckets[0] = visibleBackdropCount;
        this.visibility.shapeBuckets[1] = visibleUnderlayCount;
        this.visibility.shapeBuckets[2] = visibleOverlayCount;
        this.visibility.glyphCount = visibleGlyphCount;
        this.visibility.edgeCount = visibleEdgeCount;
    }

    #cameraData() {
        const width = Math.max(1, this.canvas.clientWidth);
        const height = Math.max(1, this.canvas.clientHeight);
        const selectedNode = this.scene.nodeIndexById[
            this.interaction.selectedNodeId
        ] ?? -1;
        const selectedEdge = this.scene.edgeIndexById[
            this.interaction.selectedEdgeId
        ] ?? -1;
        const hoveredEdge = this.scene.edgeIndexById[
            this.interaction.hoveredEdgeId
        ] ?? -1;
        const selectedPort = this.interaction.selectedPort;
        const selectedPortShape = selectedPort
            ? this.scene.portShapeIndexByKey[
                `${selectedPort.nodeId}\u0000${selectedPort.port}\u0000${selectedPort.direction}`
            ] ?? -1
            : -1;
        const highlightedPort = this.interaction.highlightedPort;
        const highlightedPortShape = highlightedPort
            ? this.scene.portShapeIndexByKey[
                `${highlightedPort.nodeId}\u0000${highlightedPort.port}\u0000${highlightedPort.direction}`
            ] ?? -1
            : -1;
        return new Float32Array([
            width,
            height,
            this.view.scrollLeft / this.view.zoom,
            this.view.scrollTop / this.view.zoom,
            this.view.zoom,
            selectedNode,
            selectedEdge,
            hoveredEdge,
            this.scene.nodeRecords.length / 4,
            this.visibility.shapeCount,
            this.visibility.edgeCount,
            this.visibility.glyphCount,
            globalThis.devicePixelRatio || 1,
            selectedPortShape,
            highlightedPortShape,
            0,
            ...this.accent
        ]);
    }

    #draw() {
        if (!this.scene || this.destroyed) return;
        this.#cullScene();
        this.device.queue.writeBuffer(
            this.cameraBuffer,
            0,
            this.#cameraData()
        );
        const encoder = this.device.createCommandEncoder({
            label: "Node editor frame"
        });
        const shapeCount = this.visibility.shapeCount;
        const edgeCount = this.visibility.edgeCount;
        if (shapeCount > 0) {
            const pass = encoder.beginComputePass({
                label: "Node editor visible shape transform"
            });
            pass.setPipeline(this.shapeComputePipeline);
            pass.setBindGroup(0, this.shapeComputeBindGroup);
            pass.dispatchWorkgroups(Math.ceil(shapeCount / 64));
            pass.end();
        }
        if (edgeCount > 0) {
            const pass = encoder.beginComputePass({
                label: "Node editor visible edge tessellation"
            });
            pass.setPipeline(this.edgeComputePipeline);
            pass.setBindGroup(0, this.edgeComputeBindGroup);
            pass.dispatchWorkgroups(Math.ceil(
                edgeCount * EDGE_SEGMENTS / 64
            ));
            pass.end();
        }

        const pass = encoder.beginRenderPass({
            label: "Unified WebGPU graph surface",
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.02, g: 0.025, b: 0.028, a: 1 },
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        pass.setPipeline(this.gridPipeline);
        pass.setBindGroup(0, this.gridBindGroup);
        pass.draw(3);
        const backdropShapeCount = this.visibility.shapeBuckets[0];
        if (backdropShapeCount > 0) {
            pass.setPipeline(this.shapePipeline);
            pass.setBindGroup(0, this.shapeBindGroup);
            pass.draw(6, backdropShapeCount);
        }
        if (edgeCount > 0) {
            pass.setPipeline(this.edgePipeline);
            pass.setBindGroup(0, this.edgeBindGroup);
            pass.setVertexBuffer(0, this.edgeVertexBuffer);
            pass.draw(
                edgeCount * EDGE_SEGMENTS * EDGE_VERTICES_PER_SEGMENT
            );
        }
        const foregroundUnderlayCount = this.visibility.shapeBuckets[1];
        if (foregroundUnderlayCount > 0) {
            pass.setPipeline(this.shapePipeline);
            pass.setBindGroup(0, this.shapeBindGroup);
            pass.draw(
                6,
                foregroundUnderlayCount,
                0,
                backdropShapeCount
            );
        }
        this.#drawPreviews(pass);
        const overlayShapeCount = this.visibility.shapeBuckets[2];
        if (overlayShapeCount > 0) {
            pass.setPipeline(this.shapePipeline);
            pass.setBindGroup(0, this.shapeBindGroup);
            pass.draw(
                6,
                overlayShapeCount,
                0,
                backdropShapeCount + foregroundUnderlayCount
            );
        }
        const glyphCount = this.visibility.glyphCount;
        if (glyphCount > 0) {
            pass.setPipeline(this.glyphPipeline);
            pass.setBindGroup(0, this.glyphBindGroup);
            pass.draw(6, glyphCount);
        }
        const interactionRect = this.interaction.dropRect
            ?? this.interaction.selectionRect;
        if (interactionRect) {
            this.device.queue.writeBuffer(
                this.overlayBuffer,
                0,
                new Float32Array([
                    interactionRect.left,
                    interactionRect.top,
                    interactionRect.right - interactionRect.left,
                    interactionRect.bottom - interactionRect.top
                ])
            );
            pass.setPipeline(this.interactionOverlayPipeline);
            pass.setBindGroup(0, this.interactionOverlayBindGroup);
            pass.draw(6);
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    #drawPreviews(pass) {
        if (this.scene.previews.length === 0) return;
        pass.setPipeline(this.previewPipeline);
        pass.setBindGroup(0, this.previewSceneBindGroup);
        const previewCount = this.scene.previews.length / 8;
        for (let index = 0; index < previewCount; index += 1) {
            const nodeIndex = this.scene.previews[index * 8 + 4];
            if (!this.visibleTransformFlags[nodeIndex]) continue;
            const node = this.scene.hitNodes[nodeIndex];
            const entry = this.previewTextures.get(node.id);
            const texture = entry?.texture ?? entry;
            if (!texture?.createView) continue;
            let bindGroup = this.previewBindGroups.get(texture);
            if (!bindGroup) {
                bindGroup = this.device.createBindGroup({
                    label: `Node preview ${node.id}`,
                    layout: this.previewPipeline.getBindGroupLayout(1),
                    entries: [
                        { binding: 0, resource: this.previewSampler },
                        { binding: 1, resource: texture.createView() }
                    ]
                });
                this.previewBindGroups.set(texture, bindGroup);
            }
            pass.setBindGroup(1, bindGroup);
            pass.draw(6, 1, 0, index);
        }
    }

    stats() {
        const edgeCount = this.scene?.edges.length / 12 || 0;
        return Object.freeze({
            backend: this.device ? "webgpu" : "initializing",
            compute: true,
            culling: "viewport",
            workerPrepared: true,
            edgeSegments: edgeCount * EDGE_SEGMENTS,
            visibleNodeCount: this.visibility.nodeCount,
            visibleTransformCount: this.visibility.transformCount,
            visibleShapeCount: this.visibility.shapeCount,
            visibleGlyphCount: this.visibility.glyphCount,
            visibleEdgeCount: this.visibility.edgeCount,
            visibleEdgeSegments: this.visibility.edgeCount * EDGE_SEGMENTS,
            annotationCount: this.scene?.hitAnnotations?.length ?? 0
        });
    }

    async whenIdle() {
        if (!this.device || this.destroyed) return;
        await this.device.queue.onSubmittedWorkDone();
    }

    #destroySceneBuffers() {
        this.sceneBuffers.forEach((buffer) => buffer.destroy());
        this.sceneBuffers = [];
    }

    destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.#destroySceneBuffers();
        this.cameraBuffer?.destroy();
        this.overlayBuffer?.destroy();
        this.fontAtlas?.destroy();
        if (this.deviceErrorHandler) {
            this.device?.removeEventListener(
                "uncapturederror",
                this.deviceErrorHandler
            );
        }
        this.context?.unconfigure();
    }
}
