export function cubicControls(from, to) {
    const bend = Math.max(42, Math.abs(to.x - from.x) * 0.42);
    return Object.freeze({
        first: { x: from.x + bend, y: from.y },
        second: { x: to.x - bend, y: to.y }
    });
}

export function sampleCubicEdge(from, to, segments = null) {
    const controls = cubicControls(from, to);
    const segmentCount = Number.isFinite(segments)
        ? Math.max(1, Math.floor(segments))
        : Math.max(
            24,
            Math.min(
                64,
                Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 12)
            )
        );
    const points = [];
    for (let index = 0; index <= segmentCount; index += 1) {
        const t = index / segmentCount;
        const inverse = 1 - t;
        points.push(Object.freeze({
            x: inverse ** 3 * from.x
                + 3 * inverse ** 2 * t * controls.first.x
                + 3 * inverse * t ** 2 * controls.second.x
                + t ** 3 * to.x,
            y: inverse ** 3 * from.y
                + 3 * inverse ** 2 * t * controls.first.y
                + 3 * inverse * t ** 2 * controls.second.y
                + t ** 3 * to.y
        }));
    }
    return Object.freeze(points);
}

export function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        return Math.hypot(point.x - from.x, point.y - from.y);
    }
    const amount = Math.max(0, Math.min(
        1,
        ((point.x - from.x) * dx + (point.y - from.y) * dy)
            / lengthSquared
    ));
    return Math.hypot(
        point.x - (from.x + amount * dx),
        point.y - (from.y + amount * dy)
    );
}

export function hitTestEdges(edges, point, tolerance = 8) {
    let nearest = null;
    let nearestDistance = tolerance;
    for (const edge of edges) {
        for (let index = 1; index < edge.points.length; index += 1) {
            const distance = distanceToSegment(
                point,
                edge.points[index - 1],
                edge.points[index]
            );
            if (distance <= nearestDistance) {
                nearest = edge;
                nearestDistance = distance;
            }
        }
    }
    return nearest;
}
