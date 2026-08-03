export const GRAPH_CULL_PADDING = 20;

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

export function graphViewportBounds(view, width, height, padding = GRAPH_CULL_PADDING) {
    const zoom = Math.max(0.0001, finite(view?.zoom, 1));
    const graphPadding = padding / zoom;
    const left = finite(view?.scrollLeft, 0) / zoom - graphPadding;
    const top = finite(view?.scrollTop, 0) / zoom - graphPadding;
    return {
        left,
        top,
        right: left + Math.max(1, finite(width, 1)) / zoom + graphPadding * 2,
        bottom: top + Math.max(1, finite(height, 1)) / zoom + graphPadding * 2
    };
}

export function graphRectVisible(x, y, width, height, bounds) {
    return x + width >= bounds.left
        && y + height >= bounds.top
        && x <= bounds.right
        && y <= bounds.bottom;
}

// Control-point bounds conservatively contain the complete cubic curve, so an
// edge crossing the viewport remains visible even when both nodes are outside.
export function graphEdgeVisible(nodeRecords, edgeRecords, edgeIndex, bounds) {
    const edgeOffset = edgeIndex * 12;
    const sourceNodeOffset = edgeRecords[edgeOffset] * 4;
    const targetNodeOffset = edgeRecords[edgeOffset + 1] * 4;
    const sourceX = nodeRecords[sourceNodeOffset] + edgeRecords[edgeOffset + 2];
    const sourceY = nodeRecords[sourceNodeOffset + 1] + edgeRecords[edgeOffset + 3];
    const targetX = nodeRecords[targetNodeOffset] + edgeRecords[edgeOffset + 4];
    const targetY = nodeRecords[targetNodeOffset + 1] + edgeRecords[edgeOffset + 5];
    const bend = Math.max(42, Math.abs(targetX - sourceX) * 0.42);
    const minimumX = Math.min(sourceX, targetX, sourceX + bend, targetX - bend);
    const maximumX = Math.max(sourceX, targetX, sourceX + bend, targetX - bend);
    const minimumY = Math.min(sourceY, targetY);
    const maximumY = Math.max(sourceY, targetY);
    return maximumX >= bounds.left
        && maximumY >= bounds.top
        && minimumX <= bounds.right
        && minimumY <= bounds.bottom;
}
