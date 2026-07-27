export const GRAPH_ZOOM_RANGE = Object.freeze({
    minimum: 0.35,
    maximum: 2.5
});

export const DEFAULT_GRAPH_VIEW = Object.freeze({
    zoom: 1,
    scrollLeft: 0,
    scrollTop: 0
});

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function clampGraphZoom(value, fallback = 1) {
    return Math.max(
        GRAPH_ZOOM_RANGE.minimum,
        Math.min(
            GRAPH_ZOOM_RANGE.maximum,
            finiteNumber(value, fallback)
        )
    );
}

/**
 * Camera offsets deliberately remain signed. They describe a location on an
 * unbounded graph plane rather than an HTML scroll area's positive range.
 */
export function normalizeGraphView(
    value = DEFAULT_GRAPH_VIEW,
    fallback = DEFAULT_GRAPH_VIEW
) {
    const source = value ?? DEFAULT_GRAPH_VIEW;
    const previous = fallback ?? DEFAULT_GRAPH_VIEW;
    const baseline = {
        zoom: clampGraphZoom(previous.zoom),
        scrollLeft: finiteNumber(previous.scrollLeft, 0),
        scrollTop: finiteNumber(previous.scrollTop, 0)
    };
    return {
        zoom: clampGraphZoom(source.zoom, baseline.zoom),
        scrollLeft: finiteNumber(source.scrollLeft, baseline.scrollLeft),
        scrollTop: finiteNumber(source.scrollTop, baseline.scrollTop)
    };
}

export function screenToGraphPoint(view, point) {
    const camera = normalizeGraphView(view);
    return Object.freeze({
        x: (
            camera.scrollLeft
            + finiteNumber(point?.x, 0)
        ) / camera.zoom,
        y: (
            camera.scrollTop
            + finiteNumber(point?.y, 0)
        ) / camera.zoom
    });
}

export function zoomGraphViewAt(view, nextZoom, anchor = { x: 0, y: 0 }) {
    const camera = normalizeGraphView(view);
    const local = {
        x: finiteNumber(anchor?.x, 0),
        y: finiteNumber(anchor?.y, 0)
    };
    const graphPoint = screenToGraphPoint(camera, local);
    const zoom = clampGraphZoom(nextZoom, camera.zoom);
    return normalizeGraphView({
        zoom,
        scrollLeft: graphPoint.x * zoom - local.x,
        scrollTop: graphPoint.y * zoom - local.y
    });
}
