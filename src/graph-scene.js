import { sampleCubicEdge } from "./edge-geometry.js";
import {
    NODE_CARD_GEOMETRY,
    nodePortSectionTop,
    nodePreviewRect
} from "./node-card-geometry.js";

export const GRAPH_SCENE_STRIDES = Object.freeze({
    node: 4,
    shape: 16,
    glyph: 16,
    edge: 12,
    preview: 8
});

export const GRAPH_SCENE_METRICS = Object.freeze({
    ...NODE_CARD_GEOMETRY,
    glyphWidth: 7,
    glyphHeight: 11,
    spatialCellSize: 256
});

const CATEGORY_COLORS = Object.freeze({
    noise: [0.07, 0.18, 0.14, 1],
    grunge: [0.07, 0.18, 0.14, 1],
    alpha: [0.07, 0.18, 0.14, 1],
    pattern: [0.07, 0.18, 0.14, 1],
    material: [0.16, 0.09, 0.22, 1],
    "custom-code": [0.2, 0.15, 0.07, 1],
    output: [0.11, 0.16, 0.09, 1],
    default: [0.075, 0.09, 0.105, 1],
    atomic: [0.075, 0.09, 0.105, 1],
    normal: [0.08, 0.11, 0.2, 1]
});

const PORT_COLORS = Object.freeze({
    grayscale: [0.72, 0.76, 0.71, 1],
    color: [0.45, 0.77, 0.93, 1],
    bundle: [0.78, 0.58, 1, 1],
    value: [0.56, 0.63, 0.61, 1]
});

const TEXT = Object.freeze({
    primary: [0.78, 0.82, 0.83, 1],
    muted: [0.43, 0.48, 0.5, 1],
    accent: [0.72, 0.95, 0.42, 1]
});

function pushShape(target, rect, fill, border, meta) {
    target.push(...rect, ...fill, ...border, ...meta);
}

function glyphUv(character) {
    const code = Math.max(32, Math.min(126, character.charCodeAt(0))) - 32;
    const column = code % 16;
    const row = Math.floor(code / 16);
    return [column / 16, row / 6, 1 / 16, 1 / 6];
}

function pushText(
    target,
    value,
    {
        x,
        y,
        nodeIndex,
        color = TEXT.primary,
        width = GRAPH_SCENE_METRICS.glyphWidth,
        height = GRAPH_SCENE_METRICS.glyphHeight,
        maximum = 28,
        align = "left"
    }
) {
    const text = String(value ?? "").slice(0, maximum);
    const startX = align === "right"
        ? x - text.length * width
        : x;
    [...text].forEach((character, index) => {
        target.push(
            startX + index * width,
            y,
            width,
            height,
            ...glyphUv(character),
            ...color,
            nodeIndex,
            0,
            0,
            0
        );
    });
}

function addSpatialRange(cells, kind, index, bounds, cellSize) {
    const minimumX = Math.floor(bounds.left / cellSize);
    const maximumX = Math.floor(bounds.right / cellSize);
    const minimumY = Math.floor(bounds.top / cellSize);
    const maximumY = Math.floor(bounds.bottom / cellSize);
    for (let y = minimumY; y <= maximumY; y += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
            const key = `${x}:${y}`;
            const cell = cells[key] ?? { nodes: [], edges: [] };
            cell[kind].push(index);
            cells[key] = cell;
        }
    }
}

function edgeTypeIndex(type) {
    return type === "grayscale" ? 0
        : type === "color" ? 1
            : type === "bundle" ? 2
                : 3;
}

function localPortAnchors(node, box, metrics) {
    const portTop = nodePortSectionTop(node, box.width, metrics);
    const ports = [];
    node.inputs.forEach((port, index) => ports.push(Object.freeze({
        id: port.id,
        direction: "input",
        type: port.type,
        x: 0,
        y: portTop + (index + 0.5) * metrics.portRowHeight
    })));
    node.outputs.forEach((port, index) => ports.push(Object.freeze({
        id: port.id,
        direction: "output",
        type: port.type,
        x: box.width,
        y: portTop + (index + 0.5) * metrics.portRowHeight
    })));
    return Object.freeze(ports);
}

function edgeBounds(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
        left: Math.min(...xs) - 12,
        right: Math.max(...xs) + 12,
        top: Math.min(...ys) - 12,
        bottom: Math.max(...ys) + 12
    };
}

/**
 * Worker-safe conversion from a normalized editor model and deterministic
 * layout into tightly packed GPU records plus compact interaction metadata.
 */
export function buildGraphScene(model, layout, options = {}) {
    const metrics = Object.freeze({
        ...GRAPH_SCENE_METRICS,
        ...options
    });
    const layoutById = new Map(layout.nodes.map((entry) => [
        entry.nodeId,
        entry
    ]));
    const nodeIndexById = new Map(model.nodes.map((node, index) => [
        node.id,
        index
    ]));
    const nodeRecords = [];
    const shapes = [];
    const glyphs = [];
    const previews = [];
    const hitNodes = [];
    const spatialCells = {};
    const portShapeIndexByKey = {};

    model.nodes.forEach((node, nodeIndex) => {
        const box = layoutById.get(node.id);
        const ports = localPortAnchors(node, box, metrics);
        nodeRecords.push(box.x, box.y, box.width, box.height);
        pushShape(
            shapes,
            [0, 0, box.width, box.height],
            [0.045, 0.055, 0.065, 0.98],
            [0.19, 0.22, 0.24, 1],
            [6, 1, 1, nodeIndex]
        );
        pushShape(
            shapes,
            [0, 0, box.width, metrics.headerHeight],
            CATEGORY_COLORS[node.category] ?? CATEGORY_COLORS.default,
            [0.12, 0.14, 0.15, 1],
            [6, 0, 0, nodeIndex]
        );
        pushText(glyphs, node.label, {
            x: 12,
            y: 18,
            nodeIndex,
            maximum: 28
        });

        if (node.preview) {
            const preview = nodePreviewRect(node, box.width, metrics);
            const rect = [
                preview.x,
                preview.y,
                preview.width,
                preview.height
            ];
            pushShape(
                shapes,
                rect,
                [0.025, 0.032, 0.035, 1],
                [0.09, 0.11, 0.12, 1],
                [4, 1, 0, nodeIndex]
            );
            previews.push(...rect, nodeIndex, 0, 0, 0);
        }

        ports.forEach((port) => {
            const color = PORT_COLORS[port.type] ?? PORT_COLORS.value;
            portShapeIndexByKey[
                `${node.id}\u0000${port.id}\u0000${port.direction}`
            ] = shapes.length / GRAPH_SCENE_STRIDES.shape;
            pushShape(
                shapes,
                [port.x - 4.5, port.y - 4.5, 9, 9],
                [0.035, 0.045, 0.05, 1],
                color,
                [4.5, 1.25, 2, nodeIndex]
            );
            pushText(glyphs, port.id, {
                x: port.direction === "input" ? 10 : box.width - 10,
                y: port.y - 4,
                nodeIndex,
                color: TEXT.muted,
                width: 5.5,
                height: 9,
                maximum: 14,
                align: port.direction === "output" ? "right" : "left"
            });
        });
        hitNodes.push(Object.freeze({
            id: node.id,
            index: nodeIndex,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            headerHeight: metrics.headerHeight,
            ports
        }));
        addSpatialRange(
            spatialCells,
            "nodes",
            nodeIndex,
            {
                left: box.x,
                right: box.x + box.width,
                top: box.y,
                bottom: box.y + box.height
            },
            metrics.spatialCellSize
        );
    });

    const portByKey = new Map();
    hitNodes.forEach((node) => node.ports.forEach((port) =>
        portByKey.set(
            `${node.id}\u0000${port.id}\u0000${port.direction}`,
            port
        )));
    const edgeRecords = [];
    const hitEdges = [];
    model.edges.forEach((edge, edgeIndex) => {
        const fromNode = hitNodes[nodeIndexById.get(edge.from.nodeId)];
        const toNode = hitNodes[nodeIndexById.get(edge.to.nodeId)];
        const fromPort = portByKey.get(
            `${edge.from.nodeId}\u0000${edge.from.port}\u0000output`
        );
        const toPort = portByKey.get(
            `${edge.to.nodeId}\u0000${edge.to.port}\u0000input`
        );
        const from = {
            x: fromNode.x + fromPort.x,
            y: fromNode.y + fromPort.y
        };
        const to = {
            x: toNode.x + toPort.x,
            y: toNode.y + toPort.y
        };
        const points = sampleCubicEdge(from, to, 24);
        edgeRecords.push(
            fromNode.index,
            toNode.index,
            fromPort.x,
            fromPort.y,
            toPort.x,
            toPort.y,
            edgeTypeIndex(edge.type),
            edgeIndex,
            edge.type === "bundle" ? 2.4 : 1.7,
            0,
            0,
            0
        );
        hitEdges.push(Object.freeze({
            ...edge,
            index: edgeIndex,
            points
        }));
        addSpatialRange(
            spatialCells,
            "edges",
            edgeIndex,
            edgeBounds(points),
            metrics.spatialCellSize
        );
    });

    return {
        layout,
        nodeRecords: new Float32Array(nodeRecords),
        shapes: new Float32Array(shapes),
        glyphs: new Float32Array(glyphs),
        edges: new Float32Array(edgeRecords),
        previews: new Float32Array(previews),
        hitNodes: Object.freeze(hitNodes),
        hitEdges: Object.freeze(hitEdges),
        spatialIndex: Object.freeze({
            cellSize: metrics.spatialCellSize,
            cells: Object.freeze(spatialCells)
        }),
        nodeIndexById: Object.freeze(Object.fromEntries(nodeIndexById)),
        edgeIndexById: Object.freeze(Object.fromEntries(
            model.edges.map((edge, index) => [edge.id, index])
        )),
        portShapeIndexByKey: Object.freeze(portShapeIndexByKey)
    };
}
