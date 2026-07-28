function requiredText(value, path) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value;
}

function normalizePort(port, path) {
    const id = requiredText(port?.id ?? port?.name, `${path}.id`);
    return Object.freeze({
        ...port,
        id,
        name: id,
        label: typeof port.label === "string" ? port.label : id,
        type: typeof port.type === "string" ? port.type : "value"
    });
}

function normalizePreview(preview, path) {
    if (preview === undefined || preview === null || preview === false) {
        return null;
    }
    if (preview !== true && (typeof preview !== "object" || Array.isArray(preview))) {
        throw new Error(`${path} must be a boolean or preview descriptor`);
    }
    const descriptor = preview === true ? {} : preview;
    return Object.freeze({
        ...descriptor,
        label: typeof descriptor.label === "string"
            ? descriptor.label
            : "Generated preview",
        aspectRatio: Number.isFinite(descriptor.aspectRatio)
            && descriptor.aspectRatio > 0
            ? descriptor.aspectRatio
            : 16 / 9
    });
}

function normalizeColor(color, path) {
    if (color === undefined || color === null) return null;
    if (
        !Array.isArray(color)
        || color.length !== 4
        || color.some((channel) =>
            !Number.isFinite(channel) || channel < 0 || channel > 1)
    ) {
        throw new Error(`${path} must be an RGBA array with values from 0 to 1`);
    }
    return Object.freeze([...color]);
}

export function createEdgeId(edge) {
    return edge?.id ?? [
        edge?.from?.nodeId,
        edge?.from?.port ?? edge?.from?.output,
        edge?.to?.nodeId,
        edge?.to?.port ?? edge?.to?.input
    ].map((value) => requiredText(value, "edge endpoint")).join("::");
}

export function normalizeNodeEditorModel(model) {
    if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) {
        throw new Error("Node editor model requires nodes and edges arrays");
    }
    const ids = new Set();
    const nodes = model.nodes.map((node, index) => {
        const id = requiredText(node?.id, `nodes[${index}].id`);
        if (ids.has(id)) throw new Error(`Duplicate node id "${id}"`);
        ids.add(id);
        return Object.freeze({
            ...node,
            id,
            label: typeof node.label === "string" ? node.label : id,
            type: typeof node.type === "string" ? node.type : "",
            category: typeof node.category === "string" ? node.category : "default",
            color: normalizeColor(node.color, `nodes[${index}].color`),
            order: Number.isFinite(node.order) ? node.order : index,
            preview: normalizePreview(node.preview, `nodes[${index}].preview`),
            inputs: Object.freeze((node.inputs ?? []).map((port, portIndex) =>
                normalizePort(port, `nodes[${index}].inputs[${portIndex}]`))),
            outputs: Object.freeze((node.outputs ?? []).map((port, portIndex) =>
                normalizePort(port, `nodes[${index}].outputs[${portIndex}]`))),
            summary: Object.freeze((node.summary ?? []).map((entry) =>
                Object.freeze({
                    label: String(entry.label ?? ""),
                    value: String(entry.value ?? "")
                })))
        });
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeIds = new Set();
    const edges = model.edges.map((edge, index) => {
        const fromNodeId = requiredText(
            edge?.from?.nodeId,
            `edges[${index}].from.nodeId`
        );
        const toNodeId = requiredText(
            edge?.to?.nodeId,
            `edges[${index}].to.nodeId`
        );
        const fromPort = requiredText(
            edge?.from?.port ?? edge?.from?.output,
            `edges[${index}].from.port`
        );
        const toPort = requiredText(
            edge?.to?.port ?? edge?.to?.input,
            `edges[${index}].to.port`
        );
        if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) {
            throw new Error(`Edge ${index} references a missing node`);
        }
        const id = createEdgeId({
            ...edge,
            from: { nodeId: fromNodeId, port: fromPort },
            to: { nodeId: toNodeId, port: toPort }
        });
        if (edgeIds.has(id)) throw new Error(`Duplicate edge id "${id}"`);
        edgeIds.add(id);
        return Object.freeze({
            ...edge,
            id,
            type: typeof edge.type === "string" ? edge.type : "value",
            from: Object.freeze({ nodeId: fromNodeId, port: fromPort }),
            to: Object.freeze({ nodeId: toNodeId, port: toPort })
        });
    });
    return Object.freeze({
        ...model,
        id: typeof model.id === "string" ? model.id : "graph",
        nodes: Object.freeze(nodes),
        edges: Object.freeze(edges)
    });
}
