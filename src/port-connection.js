function directionsCanConnect(firstNodeId, firstDirection, secondNodeId, secondDirection) {
    return Boolean(
        firstNodeId
        && secondNodeId
        && firstNodeId !== secondNodeId
        && firstDirection !== secondDirection
        && (firstDirection === "input" || firstDirection === "output")
        && (secondDirection === "input" || secondDirection === "output")
    );
}

export function portsCanConnect(first, second) {
    return Boolean(
        first
        && second
        && directionsCanConnect(
            first.nodeId,
            first.direction,
            second.nodeId,
            second.direction
        )
    );
}

/** Finds the closest compatible port in a small caller-provided node set. */
export function closestCompatiblePort(nodes, point, sourcePort, maximumDistance = Number.POSITIVE_INFINITY) {
    if (!Array.isArray(nodes) || !point || !sourcePort) return null;
    let closest = null;
    let closestDistance = Number.isFinite(maximumDistance)
        ? Math.max(0, maximumDistance)
        : Number.POSITIVE_INFINITY;
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const node = nodes[nodeIndex];
        const ports = node?.ports;
        if (!Array.isArray(ports)) continue;
        for (let portIndex = 0; portIndex < ports.length; portIndex += 1) {
            const port = ports[portIndex];
            if (!directionsCanConnect(
                sourcePort.nodeId,
                sourcePort.direction,
                node.id,
                port.direction
            )) {
                continue;
            }
            const x = node.x + port.x;
            const y = node.y + port.y;
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance > closestDistance) continue;
            closestDistance = distance;
            closest = { node, port, point: { x, y }, distance };
        }
    }
    return closest;
}

export function connectionForPorts(first, second) {
    if (!portsCanConnect(first, second)) return null;
    const from = first.direction === "output" ? first : second;
    const to = first.direction === "input" ? first : second;
    return Object.freeze({
        from: Object.freeze({ ...from }),
        to: Object.freeze({ ...to })
    });
}
