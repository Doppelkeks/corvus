import { sampleCubicEdge } from "./edge-geometry.js";
import {
    gpuGlyphAdvance,
    gpuGlyphOffsetX,
    gpuGlyphQuadWidth,
    gpuTextWidth
} from "./gpu-font-layout.js";
import {
    NODE_CARD_GEOMETRY,
    nodePortYPositions,
    nodePreviewRect
} from "./node-card-geometry.js";
import {
    GRAPH_ANNOTATION_GEOMETRY,
    GRAPH_ANNOTATION_KINDS
} from "./graph-annotations.js";

export const GRAPH_SCENE_STRIDES = Object.freeze({
    node: 4,
    shape: 16,
    glyph: 16,
    edge: 12,
    preview: 8
});

export const GRAPH_SCENE_METRICS = Object.freeze({
    ...NODE_CARD_GEOMETRY,
    glyphWidth: gpuGlyphQuadWidth(
        NODE_CARD_GEOMETRY.titleGlyphHeight
    ),
    glyphHeight: NODE_CARD_GEOMETRY.titleGlyphHeight,
    spatialCellSize: 256
});

const CATEGORY_COLORS = Object.freeze({
    source: [0.07, 0.18, 0.14, 1],
    transform: [0.13, 0.15, 0.08, 1],
    process: [0.16, 0.09, 0.22, 1],
    logic: [0.18, 0.16, 0.09, 1],
    data: [0.11, 0.16, 0.1, 1],
    utility: [0.2, 0.15, 0.07, 1],
    output: [0.11, 0.16, 0.09, 1],
    default: [0.08, 0.085, 0.075, 1],
    atomic: [0.08, 0.085, 0.075, 1]
});

const PORT_COLORS = Object.freeze({
    grayscale: [0.72, 0.76, 0.71, 1],
    color: [0.45, 0.77, 0.93, 1],
    bundle: [0.78, 0.58, 1, 1],
    value: [0.56, 0.63, 0.61, 1]
});

const TEXT = Object.freeze({
    primary: [0.88, 0.9, 0.88, 1],
    muted: [0.43, 0.48, 0.5, 1],
    accent: [0.529, 0.839, 0.122, 1]
});

function pushShape(target, rect, fill, border, meta) {
    target.push(...rect, ...fill, ...border, ...meta);
}

function colorChannels(value, alpha = 1) {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(
        String(value ?? "")
    );
    if (!match) return [0.529, 0.839, 0.122, alpha];
    return [
        Number.parseInt(match[1], 16) / 255,
        Number.parseInt(match[2], 16) / 255,
        Number.parseInt(match[3], 16) / 255,
        alpha
    ];
}

function wrappedLines(value, maximumCharacters, maximumLines = 3) {
    const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length <= maximumCharacters) {
            line = candidate;
            continue;
        }
        if (line) lines.push(line);
        line = word.slice(0, maximumCharacters);
        if (lines.length === maximumLines) break;
    }
    if (line && lines.length < maximumLines) lines.push(line);
    return lines;
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
        height = GRAPH_SCENE_METRICS.glyphHeight,
        maximum = 28,
        align = "left"
    }
) {
    const text = [...String(value ?? "").slice(0, maximum)];
    const width = gpuGlyphQuadWidth(height);
    const startX = align === "right"
        ? x - gpuTextWidth(text.join(""), height, maximum)
        : x;
    let cursorX = startX;
    text.forEach((character) => {
        target.push(
            cursorX + gpuGlyphOffsetX(character, height),
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
        cursorX += gpuGlyphAdvance(character, height);
    });
}

function textWithinWidth(value, height, maximumWidth, maximum = 28) {
    const text = String(value ?? "").slice(0, maximum);
    if (gpuTextWidth(text, height, maximum) <= maximumWidth) {
        return text;
    }
    const suffix = "...";
    let visible = text;
    while (
        visible.length > 0
        && gpuTextWidth(
            `${visible}${suffix}`,
            height,
            maximum
        ) > maximumWidth
    ) {
        visible = visible.slice(0, -1);
    }
    return visible ? `${visible}${suffix}` : suffix;
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
    const inputY = nodePortYPositions(
        node,
        "input",
        box.width,
        metrics
    );
    const outputY = nodePortYPositions(
        node,
        "output",
        box.width,
        metrics
    );
    const ports = [];
    node.inputs.forEach((port, index) => ports.push(Object.freeze({
        id: port.id,
        direction: "input",
        type: port.type,
        x: 0,
        y: inputY[index]
    })));
    node.outputs.forEach((port, index) => ports.push(Object.freeze({
        id: port.id,
        direction: "output",
        type: port.type,
        x: box.width,
        y: outputY[index]
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
    const {
        annotations = [],
        ...metricOptions
    } = options;
    const metrics = Object.freeze({
        ...GRAPH_SCENE_METRICS,
        ...metricOptions
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
    const backdropShapes = [];
    const annotationCardShapes = [];
    const underlayShapes = [];
    const selectionShapes = [];
    const overlayShapes = [];
    const glyphs = [];
    const previews = [];
    const hitNodes = [];
    const spatialCells = {};
    const portOverlayShapeIndexByKey = {};

    model.nodes.forEach((node, nodeIndex) => {
        const box = layoutById.get(node.id);
        const ports = localPortAnchors(node, box, metrics);
        nodeRecords.push(box.x, box.y, box.width, box.height);
        pushShape(
            underlayShapes,
            [0, 0, box.width, box.height],
            [0.05, 0.052, 0.048, 0.98],
            [0.2, 0.21, 0.19, 1],
            [metrics.cornerRadius, 1, 3, nodeIndex]
        );
        pushShape(
            underlayShapes,
            [0, 0, box.width, metrics.headerHeight],
            node.color
                ?? CATEGORY_COLORS[node.category]
                ?? CATEGORY_COLORS.default,
            [0.12, 0.14, 0.15, 1],
            [metrics.cornerRadius, 0, 0, nodeIndex]
        );
        pushShape(
            selectionShapes,
            [0, 0, box.width, box.height],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [metrics.cornerRadius, 1.5, 4, nodeIndex]
        );
        const title = textWithinWidth(
            node.label,
            metrics.titleGlyphHeight,
            box.width - metrics.titleInsetX * 2,
            24
        );
        pushText(glyphs, title, {
            x: metrics.titleInsetX,
            y: metrics.titleInsetY,
            nodeIndex,
            height: metrics.titleGlyphHeight,
            maximum: title.length
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
                underlayShapes,
                rect,
                [0.028, 0.03, 0.027, 1],
                [0.1, 0.11, 0.095, 1],
                [4, 1, 0, nodeIndex]
            );
            previews.push(...rect, nodeIndex, 0, 0, 0);
        }

        ports.forEach((port) => {
            const color = PORT_COLORS[port.type] ?? PORT_COLORS.value;
            const maximumCharacters = 14;
            const portLabelHeight = metrics.portLabelHeight;
            const portRadius = metrics.portRadius;
            const portLabel = textWithinWidth(
                port.id,
                metrics.portGlyphHeight,
                box.width * 0.44 - metrics.portLabelPadding,
                maximumCharacters
            );
            const labelWidth = gpuTextWidth(
                portLabel,
                metrics.portGlyphHeight,
                portLabel.length
            ) + metrics.portLabelPadding;
            const labelX = port.direction === "input"
                ? 2.5
                : box.width - labelWidth - 2.5;
            pushShape(
                overlayShapes,
                [
                    labelX,
                    port.y - portLabelHeight / 2,
                    labelWidth,
                    portLabelHeight
                ],
                [0.025, 0.03, 0.025, 0.82],
                [0.14, 0.16, 0.13, 0.92],
                [2, 0.75, 0, nodeIndex]
            );
            portOverlayShapeIndexByKey[
                `${node.id}\u0000${port.id}\u0000${port.direction}`
            ] = overlayShapes.length / GRAPH_SCENE_STRIDES.shape;
            pushShape(
                overlayShapes,
                [
                    port.x - portRadius,
                    port.y - portRadius,
                    portRadius * 2,
                    portRadius * 2
                ],
                [0.035, 0.04, 0.034, 1],
                color,
                [portRadius, 1.25, 2, nodeIndex]
            );
            pushText(glyphs, portLabel, {
                x: port.direction === "input"
                    ? metrics.portTextInsetX
                    : box.width - metrics.portTextInsetX,
                y: port.y - metrics.portGlyphHeight / 2,
                nodeIndex,
                color: TEXT.primary,
                height: metrics.portGlyphHeight,
                maximum: portLabel.length,
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

    const hitAnnotations = [];
    const annotationIndexById = {};
    annotations.forEach((annotation, annotationOffset) => {
        const transformIndex = model.nodes.length + annotationOffset;
        const accent = colorChannels(annotation.color);
        const isSection =
            annotation.kind === GRAPH_ANNOTATION_KINDS.section;
        const shapes = isSection ? backdropShapes : annotationCardShapes;
        annotationIndexById[annotation.id] = transformIndex;
        nodeRecords.push(
            annotation.x,
            annotation.y,
            annotation.width,
            annotation.height
        );
        pushShape(
            shapes,
            [0, 0, annotation.width, annotation.height],
            isSection
                ? [accent[0], accent[1], accent[2], 0.045]
                : [0.055, 0.052, 0.038, 0.96],
            [accent[0], accent[1], accent[2], isSection ? 0.46 : 0.72],
            [isSection ? 0 : 4, isSection ? 1.25 : 1, 4, transformIndex]
        );
        if (isSection) {
            pushShape(
                shapes,
                [
                    0,
                    0,
                    annotation.width,
                    GRAPH_ANNOTATION_GEOMETRY.sectionHeaderHeight
                ],
                [accent[0], accent[1], accent[2], 0.13],
                [0, 0, 0, 0],
                [0, 0, 0, transformIndex]
            );
            pushShape(
                shapes,
                [
                    annotation.width
                        - GRAPH_ANNOTATION_GEOMETRY.resizeHandleSize,
                    annotation.height
                        - GRAPH_ANNOTATION_GEOMETRY.resizeHandleSize,
                    GRAPH_ANNOTATION_GEOMETRY.resizeHandleSize,
                    GRAPH_ANNOTATION_GEOMETRY.resizeHandleSize
                ],
                [accent[0], accent[1], accent[2], 0.38],
                [accent[0], accent[1], accent[2], 0.92],
                [0, 1, 0, transformIndex]
            );
        } else {
            pushShape(
                shapes,
                [0, 0, 4, annotation.height],
                accent,
                accent,
                [0, 0, 0, transformIndex]
            );
        }
        pushText(glyphs, annotation.title, {
            x: isSection ? 10 : 14,
            y: isSection ? 7 : 11,
            nodeIndex: transformIndex,
            color: accent,
            height: isSection ? 14 : 13.5,
            maximum: isSection ? 44 : 30
        });
        wrappedLines(
            annotation.text,
            isSection ? 52 : 31,
            isSection ? 1 : 3
        ).forEach((line, lineIndex) => pushText(glyphs, line, {
            x: isSection ? 10 : 14,
            y: (isSection ? 34 : 35) + lineIndex * 16,
            nodeIndex: transformIndex,
            color: TEXT.muted,
            height: 12,
            maximum: isSection ? 52 : 31
        }));
        hitAnnotations.push(Object.freeze({
            ...annotation,
            index: transformIndex,
            headerHeight: isSection
                ? GRAPH_ANNOTATION_GEOMETRY.sectionHeaderHeight
                : annotation.height,
            resizeHandleSize: isSection
                ? GRAPH_ANNOTATION_GEOMETRY.resizeHandleSize
                : 0
        }));
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

    const backdropShapeCount =
        backdropShapes.length / GRAPH_SCENE_STRIDES.shape;
    const underlayShapeCount = backdropShapeCount
        + annotationCardShapes.length / GRAPH_SCENE_STRIDES.shape
        + underlayShapes.length / GRAPH_SCENE_STRIDES.shape;
    const selectionShapeCount =
        selectionShapes.length / GRAPH_SCENE_STRIDES.shape;
    const portShapeIndexByKey = Object.fromEntries(
        Object.entries(portOverlayShapeIndexByKey).map(([key, index]) => [
            key,
            underlayShapeCount + selectionShapeCount + index
        ])
    );
    const shapes = [
        ...backdropShapes,
        ...annotationCardShapes,
        ...underlayShapes,
        ...selectionShapes,
        ...overlayShapes
    ];
    return {
        layout,
        nodeRecords: new Float32Array(nodeRecords),
        shapes: new Float32Array(shapes),
        backdropShapeCount,
        underlayShapeCount,
        glyphs: new Float32Array(glyphs),
        edges: new Float32Array(edgeRecords),
        previews: new Float32Array(previews),
        hitNodes: Object.freeze(hitNodes),
        hitAnnotations: Object.freeze(hitAnnotations),
        hitEdges: Object.freeze(hitEdges),
        spatialIndex: Object.freeze({
            cellSize: metrics.spatialCellSize,
            cells: Object.freeze(spatialCells)
        }),
        nodeIndexById: Object.freeze(Object.fromEntries(nodeIndexById)),
        annotationIndexById: Object.freeze(annotationIndexById),
        edgeIndexById: Object.freeze(Object.fromEntries(
            model.edges.map((edge, index) => [edge.id, index])
        )),
        portShapeIndexByKey: Object.freeze(portShapeIndexByKey)
    };
}
