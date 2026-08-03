const MINIMUM_NODE_COUNT = 100;
const MAXIMUM_NODE_COUNT = 10000;
const HORIZONTAL_SPACING = 154;
const VERTICAL_SPACING = 84;
const GRAPH_PADDING = 32;
const NODE_COLORS = Object.freeze([
    Object.freeze([0.17, 0.18, 0.2, 1]),
    Object.freeze([0.19, 0.2, 0.22, 1]),
    Object.freeze([0.16, 0.17, 0.19, 1])
]);

function normalizedCount(value) {
    const count = Math.floor(Number(value));
    return Number.isFinite(count)
        ? Math.max(MINIMUM_NODE_COUNT, Math.min(MAXIMUM_NODE_COUNT, count))
        : 5000;
}

function nodeId(index) {
    return `node-${String(index).padStart(5, "0")}`;
}

/** Builds a repeatable dense graph without spending time in automatic layout. */
export function createStressScene(requestedCount = 5000) {
    const count = normalizedCount(requestedCount);
    const columnCount = Math.ceil(Math.sqrt(count * 2));
    const nodes = new Array(count);
    const positions = {};
    const edges = [];
    for (let index = 0; index < count; index += 1) {
        const id = nodeId(index);
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        nodes[index] = {
            id,
            label: `Node ${String(index + 1).padStart(5, "0")}`,
            type: "process",
            category: "process",
            color: NODE_COLORS[row % NODE_COLORS.length],
            inputs: [{ id: "input", label: "Input", type: "value" }],
            outputs: [{ id: "value", label: "Value", type: "value" }],
            summary: []
        };
        positions[id] = {
            x: GRAPH_PADDING + column * HORIZONTAL_SPACING,
            y: GRAPH_PADDING + row * VERTICAL_SPACING
        };
        if (column > 0) {
            const sourceId = nodeId(index - 1);
            edges.push({
                id: `${sourceId}-to-${id}`,
                type: "value",
                from: { nodeId: sourceId, port: "value" },
                to: { nodeId: id, port: "input" }
            });
        }
        if (row > 0 && column % 5 === 0) {
            const sourceId = nodeId(index - columnCount);
            edges.push({
                id: `${sourceId}-down-${id}`,
                type: "value",
                from: { nodeId: sourceId, port: "value" },
                to: { nodeId: id, port: "input" }
            });
        }
    }
    return {
        model: {
            id: `corvus-stress-${count}`,
            label: `Corvus ${count}-node stress scene`,
            nodes,
            edges
        },
        positions,
        columnCount
    };
}

/** Returns a new stress model without the requested connection. */
export function removeStressSceneEdge(model, edgeId) {
    const edgeIndex = model.edges.findIndex((edge) => edge.id === edgeId);
    if (edgeIndex < 0) return model;
    return {
        ...model,
        edges: [
            ...model.edges.slice(0, edgeIndex),
            ...model.edges.slice(edgeIndex + 1)
        ]
    };
}

/** Removes nodes, their incident connections, and their saved positions. */
export function removeStressSceneNodes(model, positions, nodeIds) {
    const deletedIds = new Set(nodeIds);
    const nodes = model.nodes.filter((node) => !deletedIds.has(node.id));
    if (nodes.length === model.nodes.length) {
        return { model, positions };
    }
    const nextPositions = Object.fromEntries(
        Object.entries(positions).filter(([nodeId]) =>
            !deletedIds.has(nodeId))
    );
    return {
        model: {
            ...model,
            nodes,
            edges: model.edges.filter((edge) =>
                !deletedIds.has(edge.from.nodeId)
                && !deletedIds.has(edge.to.nodeId))
        },
        positions: nextPositions
    };
}

/** Adds a connection while preserving the single-connection input contract. */
export function connectStressScenePorts(model, connection) {
    const edge = {
        id: [
            connection.from.nodeId,
            connection.from.port,
            connection.to.nodeId,
            connection.to.port
        ].join("::"),
        type: connection.from.type,
        from: {
            nodeId: connection.from.nodeId,
            port: connection.from.port
        },
        to: {
            nodeId: connection.to.nodeId,
            port: connection.to.port
        }
    };
    const retainedEdges = model.edges.filter((entry) =>
        entry.id !== edge.id
        && !(
            entry.to.nodeId === edge.to.nodeId
            && entry.to.port === edge.to.port
        ));
    return {
        edge,
        model: {
            ...model,
            edges: [...retainedEdges, edge]
        }
    };
}

/** Duplicates a selected subgraph and offsets its saved positions. */
export function duplicateStressSceneNodes(model, positions, nodeIds, suffix, {
    x: offsetX = 24,
    y: offsetY = 24
} = {}) {
    const selectedIds = new Set(nodeIds);
    const existingIds = new Set(model.nodes.map((node) => node.id));
    const duplicateIdBySource = new Map();
    const nodes = [];
    const nextPositions = { ...positions };
    for (let index = 0; index < model.nodes.length; index += 1) {
        const node = model.nodes[index];
        if (!selectedIds.has(node.id)) continue;
        const baseId = `${node.id}-copy-${suffix}`;
        let duplicateId = baseId;
        let collision = 2;
        while (existingIds.has(duplicateId)) {
            duplicateId = `${baseId}-${collision}`;
            collision += 1;
        }
        existingIds.add(duplicateId);
        duplicateIdBySource.set(node.id, duplicateId);
        nodes.push({
            ...node,
            id: duplicateId,
            label: `${node.label} copy`
        });
        const position = positions[node.id];
        if (position) {
            nextPositions[duplicateId] = {
                x: position.x + offsetX,
                y: position.y + offsetY
            };
        }
    }
    if (nodes.length === 0) {
        return { model, positions, nodeIds: [] };
    }
    const edges = model.edges.filter((edge) =>
        duplicateIdBySource.has(edge.from.nodeId)
        && duplicateIdBySource.has(edge.to.nodeId)).map((edge) => {
        const fromNodeId = duplicateIdBySource.get(edge.from.nodeId);
        const toNodeId = duplicateIdBySource.get(edge.to.nodeId);
        return {
            ...edge,
            id: [
                fromNodeId,
                edge.from.port,
                toNodeId,
                edge.to.port
            ].join("::"),
            from: { ...edge.from, nodeId: fromNodeId },
            to: { ...edge.to, nodeId: toNodeId }
        };
    });
    return {
        model: {
            ...model,
            nodes: [...model.nodes, ...nodes],
            edges: [...model.edges, ...edges]
        },
        positions: nextPositions,
        nodeIds: nodes.map((node) => node.id)
    };
}
