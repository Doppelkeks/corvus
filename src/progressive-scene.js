import { nodeCardHeight, NODE_CARD_GEOMETRY } from "./node-card-geometry.js";
import { graphViewportBounds } from "./viewport-culling.js";

export const PROGRESSIVE_SCENE_MINIMUM_NODES = 1500;
export const PROGRESSIVE_SCENE_NODE_LIMIT = 750;
export const PROGRESSIVE_SCENE_PADDING = 320;

function finitePosition(position) {
    return Boolean(
        position
        && Number.isFinite(position.x)
        && Number.isFinite(position.y)
    );
}

function positionFor(positions, nodeId) {
    return positions instanceof Map
        ? positions.get(nodeId)
        : positions?.[nodeId];
}

/**
 * Builds a bounded graph slice around the initial viewport. The complete graph
 * continues through worker preparation while this small scene is packed on the
 * main thread for the first interactive frame.
 */
export function createProgressiveGraphSlice(model, positions, view, {
    width,
    height,
    layoutOptions = {},
    minimumNodes = PROGRESSIVE_SCENE_MINIMUM_NODES,
    nodeLimit = PROGRESSIVE_SCENE_NODE_LIMIT,
    padding = PROGRESSIVE_SCENE_PADDING
} = {}) {
    if (!model || model.nodes.length < minimumNodes || nodeLimit < 1) {
        return null;
    }
    const viewportWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const viewportHeight = Number.isFinite(height) && height > 0 ? height : 1;
    const bounds = graphViewportBounds(
        view,
        viewportWidth,
        viewportHeight,
        padding
    );
    const nodeWidth = Number.isFinite(layoutOptions.nodeWidth)
        ? layoutOptions.nodeWidth
        : NODE_CARD_GEOMETRY.nodeWidth;
    const centerX = (bounds.left + bounds.right) * 0.5;
    const centerY = (bounds.top + bounds.bottom) * 0.5;
    const candidates = [];

    for (let index = 0; index < model.nodes.length; index += 1) {
        const node = model.nodes[index];
        const position = positionFor(positions, node.id);
        if (!finitePosition(position)) continue;
        if (position.x > bounds.right || position.y > bounds.bottom) continue;
        const nodeHeight = nodeCardHeight(node, nodeWidth, layoutOptions);
        if (
            position.x + nodeWidth < bounds.left
            || position.y + nodeHeight < bounds.top
        ) {
            continue;
        }
        const nodeCenterX = position.x + nodeWidth * 0.5;
        const nodeCenterY = position.y + nodeHeight * 0.5;
        const deltaX = nodeCenterX - centerX;
        const deltaY = nodeCenterY - centerY;
        candidates.push({
            index,
            node,
            position,
            distanceSquared: deltaX * deltaX + deltaY * deltaY
        });
    }

    if (candidates.length === 0) return null;
    if (candidates.length > nodeLimit) {
        candidates.sort((left, right) =>
            left.distanceSquared - right.distanceSquared
            || left.index - right.index);
        candidates.length = nodeLimit;
        candidates.sort((left, right) => left.index - right.index);
    }

    const selectedIds = new Set();
    const selectedPositions = {};
    const nodes = candidates.map((candidate) => {
        selectedIds.add(candidate.node.id);
        selectedPositions[candidate.node.id] = {
            x: candidate.position.x,
            y: candidate.position.y
        };
        return candidate.node;
    });
    const edges = model.edges.filter((edge) =>
        selectedIds.has(edge.from.nodeId)
        && selectedIds.has(edge.to.nodeId));

    return Object.freeze({
        model: Object.freeze({
            ...model,
            nodes: Object.freeze(nodes),
            edges: Object.freeze(edges)
        }),
        positions: Object.freeze(selectedPositions)
    });
}
