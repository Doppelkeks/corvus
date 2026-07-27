const SHADER = `
struct ViewUniform {
    resolution: vec2f,
    padding: vec2f,
}

@group(0) @binding(0) var<uniform> view: ViewUniform;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
}

@vertex
fn vertexMain(
    @location(0) position: vec2f,
    @location(1) color: vec4f
) -> VertexOutput {
    var output: VertexOutput;
    let normalized = position / view.resolution;
    output.position = vec4f(
        normalized.x * 2.0 - 1.0,
        1.0 - normalized.y * 2.0,
        0.0,
        1.0
    );
    output.color = color;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return input.color;
}
`;

const TYPE_COLORS = Object.freeze({
    grayscale: [0.72, 0.76, 0.71, 0.66],
    color: [0.45, 0.77, 0.93, 0.7],
    bundle: [0.78, 0.58, 1, 0.78],
    value: [0.56, 0.63, 0.61, 0.62]
});

function nextCapacity(value) {
    let capacity = 256;
    while (capacity < value) capacity *= 2;
    return capacity;
}

function edgeColor(edge, selected, hovered) {
    const base = Array.isArray(edge.color)
        ? edge.color
        : TYPE_COLORS[edge.type] ?? TYPE_COLORS.value;
    if (selected) return [0.72, 0.95, 0.42, 1];
    if (hovered) return [
        Math.min(1, base[0] * 1.3),
        Math.min(1, base[1] * 1.3),
        Math.min(1, base[2] * 1.3),
        0.96
    ];
    return base;
}

function appendVertex(target, point, color) {
    target.push(point.x, point.y, ...color);
}

function appendSegmentQuad(target, from, to, width, color) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;
    const px = (-dy / length) * width * 0.5;
    const py = (dx / length) * width * 0.5;
    const a = { x: from.x + px, y: from.y + py };
    const b = { x: from.x - px, y: from.y - py };
    const c = { x: to.x + px, y: to.y + py };
    const d = { x: to.x - px, y: to.y - py };
    appendVertex(target, a, color);
    appendVertex(target, b, color);
    appendVertex(target, c, color);
    appendVertex(target, c, color);
    appendVertex(target, b, color);
    appendVertex(target, d, color);
}

function edgeVertices(edges, selectedEdgeId, hoveredEdgeId) {
    const values = [];
    const ordered = [...edges].sort((left, right) =>
        Number(left.id === selectedEdgeId) - Number(right.id === selectedEdgeId));
    for (const edge of ordered) {
        const selected = edge.id === selectedEdgeId;
        const hovered = edge.id === hoveredEdgeId;
        const color = edgeColor(edge, selected, hovered);
        const width = selected ? 4 : hovered ? 3 : edge.type === "bundle" ? 2.4 : 1.7;
        for (let index = 1; index < edge.points.length; index += 1) {
            appendSegmentQuad(
                values,
                edge.points[index - 1],
                edge.points[index],
                width,
                color
            );
        }
    }
    return new Float32Array(values);
}

export class WebGpuEdgeLayer {
    constructor(canvas, { device = null, onStatus = null } = {}) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("WebGpuEdgeLayer requires a canvas");
        }
        this.canvas = canvas;
        this.device = device;
        this.onStatus = onStatus;
        this.context = null;
        this.pipeline = null;
        this.uniformBuffer = null;
        this.uniformBindGroup = null;
        this.vertexBuffer = null;
        this.vertexCapacity = 0;
        this.vertexCount = 0;
        this.ownsDevice = false;
        this.pending = {
            edges: [],
            selectedEdgeId: null,
            hoveredEdgeId: null,
            width: 1,
            height: 1
        };
        this.initializing = null;
        this.destroyed = false;
    }

    initialize(device = this.device) {
        if (this.pipeline) return Promise.resolve(this);
        if (this.initializing) return this.initializing;
        this.initializing = this.#initialize(device).finally(() => {
            this.initializing = null;
        });
        return this.initializing;
    }

    async #initialize(device) {
        if (this.destroyed) return this;
        if (!device) {
            if (!globalThis.navigator?.gpu) {
                throw new Error("This node editor requires WebGPU");
            }
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: "high-performance"
            });
            if (!adapter) throw new Error("No WebGPU adapter is available");
            device = await adapter.requestDevice();
            this.ownsDevice = true;
        }
        this.device = device;
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) {
            throw new Error("Unable to create the node editor WebGPU canvas");
        }
        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device,
            format,
            alphaMode: "premultiplied"
        });
        const module = device.createShaderModule({
            label: "node-editor-edge-shader",
            code: SHADER
        });
        this.pipeline = device.createRenderPipeline({
            label: "node-editor-edge-pipeline",
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vertexMain",
                buffers: [{
                    arrayStride: 24,
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x2"
                        },
                        {
                            shaderLocation: 1,
                            offset: 8,
                            format: "float32x4"
                        }
                    ]
                }]
            },
            fragment: {
                module,
                entryPoint: "fragmentMain",
                targets: [{
                    format,
                    blend: {
                        color: {
                            srcFactor: "src-alpha",
                            dstFactor: "one-minus-src-alpha"
                        },
                        alpha: {
                            srcFactor: "one",
                            dstFactor: "one-minus-src-alpha"
                        }
                    }
                }]
            },
            primitive: { topology: "triangle-list" }
        });
        const usage = globalThis.GPUBufferUsage;
        this.uniformBuffer = device.createBuffer({
            label: "node-editor-view-uniform",
            size: 16,
            usage: usage.UNIFORM | usage.COPY_DST
        });
        this.uniformBindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: this.uniformBuffer }
            }]
        });
        this.onStatus?.({ backend: "webgpu", ready: true });
        this.#draw();
        return this;
    }

    setEdges(edges, {
        selectedEdgeId = null,
        hoveredEdgeId = null,
        width = 1,
        height = 1
    } = {}) {
        this.pending = {
            edges,
            selectedEdgeId,
            hoveredEdgeId,
            width: Math.max(1, width),
            height: Math.max(1, height)
        };
        if (this.pipeline) this.#draw();
    }

    #ensureVertexCapacity(byteLength) {
        if (byteLength <= this.vertexCapacity) return;
        this.vertexBuffer?.destroy();
        this.vertexCapacity = nextCapacity(byteLength);
        const usage = globalThis.GPUBufferUsage;
        this.vertexBuffer = this.device.createBuffer({
            label: "node-editor-edge-vertices",
            size: this.vertexCapacity,
            usage: usage.VERTEX | usage.COPY_DST
        });
    }

    #draw() {
        if (this.destroyed || !this.pipeline) return;
        const {
            edges,
            selectedEdgeId,
            hoveredEdgeId,
            width,
            height
        } = this.pending;
        const maximum = this.device.limits.maxTextureDimension2D;
        const canvasWidth = Math.min(maximum, Math.max(1, Math.ceil(width)));
        const canvasHeight = Math.min(maximum, Math.max(1, Math.ceil(height)));
        if (this.canvas.width !== canvasWidth) this.canvas.width = canvasWidth;
        if (this.canvas.height !== canvasHeight) this.canvas.height = canvasHeight;
        const vertices = edgeVertices(edges, selectedEdgeId, hoveredEdgeId);
        this.vertexCount = vertices.length / 6;
        if (vertices.byteLength > 0) {
            this.#ensureVertexCapacity(vertices.byteLength);
            this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
        }
        this.device.queue.writeBuffer(
            this.uniformBuffer,
            0,
            new Float32Array([width, height, 0, 0])
        );
        const encoder = this.device.createCommandEncoder({
            label: "node-editor-edge-frame"
        });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        if (this.vertexCount > 0) {
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this.uniformBindGroup);
            pass.setVertexBuffer(0, this.vertexBuffer);
            pass.draw(this.vertexCount);
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    destroy() {
        this.destroyed = true;
        this.vertexBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.context?.unconfigure();
        if (this.ownsDevice) this.device?.destroy();
    }
}

export { edgeVertices };
