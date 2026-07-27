function finiteRect(rect) {
    return Boolean(
        rect
        && Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && Number.isFinite(rect.width)
        && Number.isFinite(rect.height)
    );
}

/**
 * Convert a rendered socket center back into its stable, unscaled offset
 * inside a graph node. Measuring once after card layout avoids assumptions
 * about padding, borders, font metrics, or preview content.
 */
export function socketOffsetInNode(
    socketRect,
    sceneRect,
    sceneSize,
    nodePosition
) {
    if (
        !finiteRect(socketRect)
        || !finiteRect(sceneRect)
        || !Number.isFinite(sceneSize?.width)
        || !Number.isFinite(sceneSize?.height)
        || !Number.isFinite(nodePosition?.x)
        || !Number.isFinite(nodePosition?.y)
    ) {
        return null;
    }
    const scaleX = sceneRect.width / sceneSize.width;
    const scaleY = sceneRect.height / sceneSize.height;
    if (!(scaleX > 0) || !(scaleY > 0)) return null;
    const centerX = socketRect.left + socketRect.width * 0.5;
    const centerY = socketRect.top + socketRect.height * 0.5;
    return Object.freeze({
        x: (centerX - sceneRect.left) / scaleX - nodePosition.x,
        y: (centerY - sceneRect.top) / scaleY - nodePosition.y
    });
}
