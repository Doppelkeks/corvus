export const GRAPH_ZOOM_RANGE = Object.freeze({
    minimum: 0.35,
    maximum: 2.5
});

export const DEFAULT_GRAPH_VIEW = Object.freeze({
    zoom: 1,
    scrollLeft: 0,
    scrollTop: 0
});

const GRAPH_WHEEL_ZOOM_SENSITIVITY = 0.001;
const MAXIMUM_WHEEL_DELTA = 240;

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

export function graphWheelDeltaPixels(event, viewportHeight = 800) {
    const delta = finiteNumber(event?.deltaY, 0);
    if (event?.deltaMode === 1) return delta * 16;
    if (event?.deltaMode === 2) {
        return delta * Math.max(1, finiteNumber(viewportHeight, 800));
    }
    return delta;
}

/**
 * Plain wheel input always zooms the graph at the pointer. The exponential
 * scale keeps high-resolution trackpads smooth while remaining predictable
 * for discrete mouse-wheel notches.
 */
export function zoomGraphViewFromWheel(
    view,
    event,
    anchor,
    viewportHeight
) {
    const camera = normalizeGraphView(view);
    const wheelDelta = Math.max(
        -MAXIMUM_WHEEL_DELTA,
        Math.min(
            MAXIMUM_WHEEL_DELTA,
            graphWheelDeltaPixels(event, viewportHeight)
        )
    );
    return zoomGraphViewAt(
        camera,
        camera.zoom * Math.exp(
            -wheelDelta * GRAPH_WHEEL_ZOOM_SENSITIVITY
        ),
        anchor
    );
}
