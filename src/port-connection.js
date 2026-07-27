export function portsCanConnect(first, second) {
    return Boolean(
        first
        && second
        && first.nodeId !== second.nodeId
        && first.direction !== second.direction
        && ["input", "output"].includes(first.direction)
        && ["input", "output"].includes(second.direction)
    );
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
