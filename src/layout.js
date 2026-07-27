const DEFAULT_LAYOUT = Object.freeze({
    padding: 36,
    columnGap: 110,
    rowGap: 34,
    nodeWidth: 220,
    minimumNodeHeight: 96,
    headerHeight: 48,
    portRowHeight: 20,
    summaryRowHeight: 16
});

function finitePosition(value) {
    return Boolean(
        value
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
    );
}

function nodeHeight(node, settings) {
    const rows = Math.max(node.inputs.length, node.outputs.length, 1);
    return Math.max(
        settings.minimumNodeHeight,
        settings.headerHeight
            + rows * settings.portRowHeight
            + Math.min(node.summary.length, 3) * settings.summaryRowHeight
    );
}

export function layoutNodeEditorModel(model, {
    positions = {},
    ...overrides
} = {}) {
    const settings = { ...DEFAULT_LAYOUT, ...overrides };
    const paddingX = Number.isFinite(settings.paddingX)
        ? settings.paddingX
        : settings.padding;
    const paddingY = Number.isFinite(settings.paddingY)
        ? settings.paddingY
        : settings.padding;
    const incoming = new Map(model.nodes.map((node) => [node.id, []]));
    for (const edge of model.edges) {
        incoming.get(edge.to.nodeId)?.push(edge.from.nodeId);
    }
    const depthById = new Map();
    const visiting = new Set();
    const depthOf = (nodeId) => {
        if (depthById.has(nodeId)) return depthById.get(nodeId);
        if (visiting.has(nodeId)) return 0;
        visiting.add(nodeId);
        const depth = (incoming.get(nodeId) ?? []).reduce(
            (maximum, sourceId) => Math.max(maximum, depthOf(sourceId) + 1),
            0
        );
        visiting.delete(nodeId);
        depthById.set(nodeId, depth);
        return depth;
    };
    model.nodes.forEach((node) => depthOf(node.id));
    const maximumOperationDepth = model.nodes.reduce((maximum, node) =>
        node.terminal
            ? maximum
            : Math.max(maximum, depthById.get(node.id) ?? 0), 0);
    model.nodes.forEach((node) => {
        if (node.terminal) {
            depthById.set(
                node.id,
                Math.max(
                    depthById.get(node.id) ?? 0,
                    maximumOperationDepth + 1
                )
            );
        }
    });

    const columns = new Map();
    model.nodes.forEach((node) => {
        const depth = depthById.get(node.id);
        if (!columns.has(depth)) columns.set(depth, []);
        columns.get(depth).push(node);
    });

    const automaticById = new Map();
    for (const [depth, column] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
        let y = paddingY;
        column.sort((left, right) =>
            left.order - right.order || left.id.localeCompare(right.id));
        for (const node of column) {
            const height = nodeHeight(node, settings);
            automaticById.set(node.id, {
                x: paddingX + depth * (
                    settings.nodeWidth + settings.columnGap
                ),
                y,
                width: settings.nodeWidth,
                height
            });
            // Manual coordinates never feed into automatic sibling placement.
            y += height + settings.rowGap;
        }
    }

    let maximumX = paddingX;
    let maximumY = paddingY;
    const nodes = model.nodes.map((node) => {
        const automatic = automaticById.get(node.id);
        const manual = positions[node.id];
        const position = finitePosition(manual) ? manual : automatic;
        const entry = Object.freeze({
            nodeId: node.id,
            x: position.x,
            y: position.y,
            width: automatic.width,
            height: automatic.height
        });
        maximumX = Math.max(maximumX, entry.x + entry.width + paddingX);
        maximumY = Math.max(maximumY, entry.y + entry.height + paddingY);
        return entry;
    });

    return Object.freeze({
        nodes: Object.freeze(nodes),
        width: maximumX,
        height: maximumY
    });
}

export { DEFAULT_LAYOUT };
