import { createGpuFontAtlas } from "./gpu-font-atlas.js";
import {
    EDGE_COMPUTE_SHADER,
    EDGE_RENDER_SHADER,
    GLYPH_SHADER,
    GRID_SHADER,
    PREVIEW_SHADER,
    SHAPE_COMPUTE_SHADER,
    SHAPE_RENDER_SHADER
} from "./gpu-graph-shaders.js";

const CAMERA_FLOATS = 16;
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

function shader(device, label, code) {
    return device.createShaderModule({ label, code });
}

function renderTarget(format, blend = undefined) {
    return [{ format, blend }];
}

export class WebGpuGraphSurface {
    constructor(canvas, {
        device = null,
        onStatus = null
    } = {}) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("WebGpuGraphSurface requires a canvas");
        }
        this.canvas = canvas;
        this.device = device;
        this.onStatus = onStatus;
        this.context = null;
        this.format = null;
        this.scene = null;
        this.view = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
        this.interaction = {
            selectedNodeId: null,
            selectedEdgeId: null,
            hoveredEdgeId: null,
            selectedPort: null
        };
        this.previewTextures = new Map();
        this.previewBindGroups = new WeakMap();
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
        this.gridBindGroup = device.createBindGroup({
            label: "Node editor grid bindings",
            layout: this.gridPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
        });
    }

    setScene(scene) {
        if (!this.device) throw new Error("Graph surface is not initialized");
        this.#destroySceneBuffers();
        this.scene = scene;
        const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        this.nodeBuffer = createBuffer(
            this.device,
            "Node editor nodes",
            scene.nodeRecords,
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
        this.edgeBuffer = createBuffer(
            this.device,
            "Node editor edge input",
            scene.edges,
            storage
        );
        const edgeVertexSize = Math.max(
            16,
            (scene.edges.length / 12)
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
        this.sceneBuffers = [
            this.nodeBuffer,
            this.shapeInputBuffer,
            this.shapeOutputBuffer,
            this.edgeBuffer,
            this.edgeVertexBuffer,
            this.glyphBuffer,
            this.previewBuffer
        ];
        this.#createSceneBindGroups();
        this.render();
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
                { binding: 3, resource: { buffer: this.shapeOutputBuffer } }
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
                { binding: 3, resource: { buffer: this.edgeVertexBuffer } }
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
                { binding: 4, resource: this.fontAtlas.view }
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
        this.render();
    }

    setNodePosition(nodeId, position) {
        const index = this.scene?.nodeIndexById?.[nodeId];
        if (!Number.isInteger(index)) return;
        const offset = index * 4;
        this.scene.nodeRecords[offset] = position.x;
        this.scene.nodeRecords[offset + 1] = position.y;
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
            this.scene.shapes.length / 16,
            this.scene.edges.length / 12,
            this.scene.glyphs.length / 16,
            globalThis.devicePixelRatio || 1,
            selectedPortShape,
            0,
            0
        ]);
    }

    #draw() {
        if (!this.scene || this.destroyed) return;
        this.device.queue.writeBuffer(
            this.cameraBuffer,
            0,
            this.#cameraData()
        );
        const encoder = this.device.createCommandEncoder({
            label: "Node editor frame"
        });
        const shapeCount = this.scene.shapes.length / 16;
        const edgeCount = this.scene.edges.length / 12;
        if (shapeCount > 0) {
            const pass = encoder.beginComputePass({
                label: "Node editor shape transform and cull"
            });
            pass.setPipeline(this.shapeComputePipeline);
            pass.setBindGroup(0, this.shapeComputeBindGroup);
            pass.dispatchWorkgroups(Math.ceil(shapeCount / 64));
            pass.end();
        }
        if (edgeCount > 0) {
            const pass = encoder.beginComputePass({
                label: "Node editor edge tessellation"
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
        if (edgeCount > 0) {
            pass.setPipeline(this.edgePipeline);
            pass.setBindGroup(0, this.edgeBindGroup);
            pass.setVertexBuffer(0, this.edgeVertexBuffer);
            pass.draw(
                edgeCount * EDGE_SEGMENTS * EDGE_VERTICES_PER_SEGMENT
            );
        }
        const underlayShapeCount = Math.max(
            0,
            Math.min(
                shapeCount,
                this.scene.underlayShapeCount ?? shapeCount
            )
        );
        if (underlayShapeCount > 0) {
            pass.setPipeline(this.shapePipeline);
            pass.setBindGroup(0, this.shapeBindGroup);
            pass.draw(6, underlayShapeCount);
        }
        this.#drawPreviews(pass);
        const overlayShapeCount = shapeCount - underlayShapeCount;
        if (overlayShapeCount > 0) {
            pass.setPipeline(this.shapePipeline);
            pass.setBindGroup(0, this.shapeBindGroup);
            pass.draw(6, overlayShapeCount, 0, underlayShapeCount);
        }
        const glyphCount = this.scene.glyphs.length / 16;
        if (glyphCount > 0) {
            pass.setPipeline(this.glyphPipeline);
            pass.setBindGroup(0, this.glyphBindGroup);
            pass.draw(6, glyphCount);
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
            workerPrepared: true,
            edgeSegments: edgeCount * EDGE_SEGMENTS
        });
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
