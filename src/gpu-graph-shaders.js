export const GRID_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) screen: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    let position = positions[vertexIndex];
    var output: VertexOutput;
    output.position = vec4f(position, 0.0, 1.0);
    output.screen = vec2f(
        (position.x * 0.5 + 0.5) * camera.view.x,
        (1.0 - (position.y * 0.5 + 0.5)) * camera.view.y
    );
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let graph = input.screen / camera.state.x + camera.view.zw;
    let minorCell = 24.0;
    let majorCell = minorCell * 5.0;
    let minorCoordinate = abs(fract(graph / minorCell - 0.5) - 0.5);
    let majorCoordinate = abs(fract(graph / majorCell - 0.5) - 0.5);
    let minorWidth = max(fwidth(graph / minorCell), vec2f(0.0005));
    let majorWidth = max(fwidth(graph / majorCell), vec2f(0.0005));
    let minorDistance = min(
        minorCoordinate.x / minorWidth.x,
        minorCoordinate.y / minorWidth.y
    );
    let majorDistance = min(
        majorCoordinate.x / majorWidth.x,
        majorCoordinate.y / majorWidth.y
    );
    let minor = 1.0 - smoothstep(0.2, 1.1, minorDistance);
    let major = 1.0 - smoothstep(0.15, 1.0, majorDistance);
    let grid = minor * 0.075 + major * 0.16;
    return vec4f(
        vec3f(0.024, 0.025, 0.022) + vec3f(0.13, 0.14, 0.11) * grid,
        1.0
    );
}
`;

export const SHAPE_COMPUTE_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> inputShapes: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outputShapes: array<vec4f>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) invocation: vec3u) {
    let index = invocation.x;
    if (index >= u32(camera.counts.y)) {
        return;
    }
    let base = index * 4u;
    let localRect = inputShapes[base];
    let fill = inputShapes[base + 1u];
    var border = inputShapes[base + 2u];
    let shapeInfo = inputShapes[base + 3u];
    let nodeIndex = u32(shapeInfo.w);
    let node = nodes[nodeIndex];
    let rect = vec4f(node.xy + localRect.xy, localRect.zw);
    let viewportMin = camera.view.zw;
    let viewportMax = viewportMin + camera.view.xy / camera.state.x;
    let visible = rect.x + rect.z >= viewportMin.x - 20.0
        && rect.y + rect.w >= viewportMin.y - 20.0
        && rect.x <= viewportMax.x + 20.0
        && rect.y <= viewportMax.y + 20.0;
    var nextFill = fill;
    if (!visible) {
        nextFill.a = 0.0;
        border.a = 0.0;
    } else if (
        (shapeInfo.z == 1.0 && f32(nodeIndex) == camera.state.y)
        || f32(index) == camera.display.y
    ) {
        border = vec4f(0.72, 0.95, 0.42, 1.0);
    }
    outputShapes[base] = rect;
    outputShapes[base + 1u] = nextFill;
    outputShapes[base + 2u] = border;
    outputShapes[base + 3u] = shapeInfo;
}
`;

export const SHAPE_RENDER_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> shapes: array<vec4f>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) size: vec2f,
    @location(2) fill: vec4f,
    @location(3) border: vec4f,
    @location(4) shapeInfo: vec4f,
}

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
    );
    let corner = corners[vertexIndex];
    let base = instanceIndex * 4u;
    let rect = shapes[base];
    let graphPosition = rect.xy + rect.zw * corner;
    let unsnappedScreen =
        (graphPosition - camera.view.zw) * camera.state.x;
    let pixelRatio = max(camera.display.x, 1.0);
    let screen = round(unsnappedScreen * pixelRatio) / pixelRatio;
    var output: VertexOutput;
    output.position = vec4f(
        screen.x / camera.view.x * 2.0 - 1.0,
        1.0 - screen.y / camera.view.y * 2.0,
        0.0,
        1.0
    );
    output.uv = corner;
    output.size = rect.zw * camera.state.x;
    output.fill = shapes[base + 1u];
    output.border = shapes[base + 2u];
    output.shapeInfo = shapes[base + 3u];
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    if (input.fill.a == 0.0 && input.border.a == 0.0) {
        discard;
    }
    let radius = min(
        input.shapeInfo.x * camera.state.x,
        min(input.size.x, input.size.y) * 0.5
    );
    let centered = (input.uv - vec2f(0.5)) * input.size;
    let q = abs(centered) - input.size * 0.5 + vec2f(radius);
    let distance = length(max(q, vec2f(0.0)))
        + min(max(q.x, q.y), 0.0) - radius;
    let aa = max(fwidth(distance), 0.75);
    let outer = 1.0 - smoothstep(-aa, aa, distance);
    let borderWidth = input.shapeInfo.y * camera.state.x;
    let inner = 1.0 - smoothstep(
        -aa,
        aa,
        distance + max(borderWidth, 0.0)
    );
    var color = input.fill * inner
        + input.border * max(outer - inner, 0.0);
    color.a = max(input.fill.a * inner, input.border.a * (outer - inner));
    return color;
}
`;

export const EDGE_COMPUTE_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> edges: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> vertices: array<vec4f>;

fn cubic(a: vec2f, b: vec2f, c: vec2f, d: vec2f, t: f32) -> vec2f {
    let inverse = 1.0 - t;
    return inverse * inverse * inverse * a
        + 3.0 * inverse * inverse * t * b
        + 3.0 * inverse * t * t * c
        + t * t * t * d;
}

fn edgeColor(typeIndex: f32) -> vec4f {
    if (typeIndex < 0.5) { return vec4f(0.72, 0.76, 0.71, 0.95); }
    if (typeIndex < 1.5) { return vec4f(0.45, 0.77, 0.93, 0.95); }
    if (typeIndex < 2.5) { return vec4f(0.78, 0.58, 1.0, 0.95); }
    return vec4f(0.56, 0.63, 0.61, 0.95);
}

fn writeVertex(index: u32, position: vec2f, color: vec4f, signedDistance: f32, halfWidth: f32) {
    vertices[index * 2u] = vec4f(position, color.rg);
    vertices[index * 2u + 1u] = vec4f(color.ba, signedDistance, halfWidth);
}

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) invocation: vec3u) {
    let segmentIndex = invocation.x;
    let segmentCount = 24u;
    let edgeIndex = segmentIndex / segmentCount;
    if (edgeIndex >= u32(camera.counts.z)) {
        return;
    }
    let segment = segmentIndex % segmentCount;
    let base = edgeIndex * 3u;
    let first = edges[base];
    let second = edges[base + 1u];
    let third = edges[base + 2u];
    let fromNode = nodes[u32(first.x)];
    let toNode = nodes[u32(first.y)];
    let sourcePoint = fromNode.xy + first.zw;
    let targetPoint = toNode.xy + second.xy;
    let bend = max(42.0, abs(targetPoint.x - sourcePoint.x) * 0.42);
    let controlA = sourcePoint + vec2f(bend, 0.0);
    let controlB = targetPoint - vec2f(bend, 0.0);
    let t0 = f32(segment) / f32(segmentCount);
    let t1 = f32(segment + 1u) / f32(segmentCount);
    let pointA = cubic(
        sourcePoint,
        controlA,
        controlB,
        targetPoint,
        t0
    );
    let pointB = cubic(
        sourcePoint,
        controlA,
        controlB,
        targetPoint,
        t1
    );
    let direction = pointB - pointA;
    let safeLength = max(length(direction), 0.0001);
    let normal = vec2f(-direction.y, direction.x) / safeLength;
    let logicalEdgeIndex = second.w;
    var halfWidthPx = third.x;
    var color = edgeColor(second.z);
    if (logicalEdgeIndex == camera.state.z) {
        halfWidthPx += 1.7;
        color = vec4f(0.72, 0.95, 0.42, 1.0);
    } else if (logicalEdgeIndex == camera.state.w) {
        halfWidthPx += 0.9;
        color = vec4f(0.64, 0.82, 0.48, 1.0);
    }
    let graphHalfWidth = (halfWidthPx + 1.35) / camera.state.x;
    let aLeft = pointA - normal * graphHalfWidth;
    let aRight = pointA + normal * graphHalfWidth;
    let bLeft = pointB - normal * graphHalfWidth;
    let bRight = pointB + normal * graphHalfWidth;
    let outputBase = segmentIndex * 6u;
    writeVertex(outputBase, aLeft, color, -halfWidthPx, halfWidthPx);
    writeVertex(outputBase + 1u, aRight, color, halfWidthPx, halfWidthPx);
    writeVertex(outputBase + 2u, bLeft, color, -halfWidthPx, halfWidthPx);
    writeVertex(outputBase + 3u, bLeft, color, -halfWidthPx, halfWidthPx);
    writeVertex(outputBase + 4u, aRight, color, halfWidthPx, halfWidthPx);
    writeVertex(outputBase + 5u, bRight, color, halfWidthPx, halfWidthPx);
}
`;

export const EDGE_RENDER_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) distanceAndWidth: vec2f,
}

@vertex
fn vertexMain(
    @location(0) geometry: vec4f,
    @location(1) styling: vec4f
) -> VertexOutput {
    let screen = (geometry.xy - camera.view.zw) * camera.state.x;
    var output: VertexOutput;
    output.position = vec4f(
        screen.x / camera.view.x * 2.0 - 1.0,
        1.0 - screen.y / camera.view.y * 2.0,
        0.0,
        1.0
    );
    output.color = vec4f(geometry.zw, styling.xy);
    output.distanceAndWidth = styling.zw;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let distance = abs(input.distanceAndWidth.x);
    let halfWidth = input.distanceAndWidth.y;
    let coverage = 1.0 - smoothstep(
        max(halfWidth - 1.35, 0.0),
        halfWidth,
        distance
    );
    return vec4f(input.color.rgb, input.color.a * coverage);
}
`;

export const GLYPH_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> glyphs: array<vec4f>;
@group(0) @binding(3) var atlasSampler: sampler;
@group(0) @binding(4) var atlasTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
}

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
    );
    let corner = corners[vertexIndex];
    let base = instanceIndex * 4u;
    let rect = glyphs[base];
    let uvRect = glyphs[base + 1u];
    let glyphInfo = glyphs[base + 3u];
    let node = nodes[u32(glyphInfo.x)];
    let graphPosition = node.xy + rect.xy + rect.zw * corner;
    let unsnappedScreen =
        (graphPosition - camera.view.zw) * camera.state.x;
    let pixelRatio = max(camera.display.x, 1.0);
    let screen = round(unsnappedScreen * pixelRatio) / pixelRatio;
    var output: VertexOutput;
    output.position = vec4f(
        screen.x / camera.view.x * 2.0 - 1.0,
        1.0 - screen.y / camera.view.y * 2.0,
        0.0,
        1.0
    );
    output.uv = uvRect.xy + uvRect.zw * corner;
    output.color = glyphs[base + 2u];
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let sample = textureSample(atlasTexture, atlasSampler, input.uv);
    let edgeWidth = clamp(fwidth(sample.a) * 0.72, 0.012, 0.12);
    let smallTextWeight = clamp(
        (1.0 - camera.state.x) / 0.65,
        0.0,
        1.0
    );
    let threshold = 0.5 - smallTextWeight * 0.08;
    let coverage = smoothstep(
        threshold - edgeWidth,
        threshold + edgeWidth,
        sample.a
    );
    return vec4f(input.color.rgb, input.color.a * coverage);
}
`;

export const PREVIEW_SHADER = /* wgsl */`
struct Camera {
    view: vec4f,
    state: vec4f,
    counts: vec4f,
    display: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> previews: array<vec4f>;
@group(1) @binding(0) var previewSampler: sampler;
@group(1) @binding(1) var previewTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
    );
    let corner = corners[vertexIndex];
    let base = instanceIndex * 2u;
    let rect = previews[base];
    let node = nodes[u32(previews[base + 1u].x)];
    let graphPosition = node.xy + rect.xy + rect.zw * corner;
    let screen = (graphPosition - camera.view.zw) * camera.state.x;
    var output: VertexOutput;
    output.position = vec4f(
        screen.x / camera.view.x * 2.0 - 1.0,
        1.0 - screen.y / camera.view.y * 2.0,
        0.0,
        1.0
    );
    output.uv = corner;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let color = textureSample(previewTexture, previewSampler, input.uv);
    return vec4f(color.rgb, 1.0);
}
`;
