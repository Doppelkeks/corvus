function finitePoint(point) {
    return {
        x: Number.isFinite(point?.x) ? point.x : 0,
        y: Number.isFinite(point?.y) ? point.y : 0
    };
}

export function selectionRectangle(start, end) {
    const first = finitePoint(start);
    const second = finitePoint(end);
    return Object.freeze({
        left: Math.min(first.x, second.x),
        top: Math.min(first.y, second.y),
        right: Math.max(first.x, second.x),
        bottom: Math.max(first.y, second.y)
    });
}

export function nodeIntersectsSelection(node, rectangle) {
    return (
        node.x <= rectangle.right
        && node.x + node.width >= rectangle.left
        && node.y <= rectangle.bottom
        && node.y + node.height >= rectangle.top
    );
}

export function nodesInSelection(nodes, start, end) {
    const rectangle = selectionRectangle(start, end);
    return Object.freeze(nodes
        .filter((node) => nodeIntersectsSelection(node, rectangle))
        .map((node) => node.id));
}
