export const GRAPH_ANNOTATION_KINDS = Object.freeze({
    comment: "comment",
    section: "section"
});

export const GRAPH_ANNOTATION_GEOMETRY = Object.freeze({
    comment: Object.freeze({
        width: 240,
        height: 92,
        minimumWidth: 160,
        minimumHeight: 64
    }),
    section: Object.freeze({
        width: 480,
        height: 320,
        minimumWidth: 220,
        minimumHeight: 140
    }),
    sectionHeaderHeight: 30,
    resizeHandleSize: 14
});

const DEFAULT_COLORS = Object.freeze({
    comment: "#e1b643",
    section: "#87d61f"
});

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function text(value, fallback, maximum) {
    return (typeof value === "string" ? value : fallback).slice(0, maximum);
}

function requiredId(value, path) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${path}.id must be a non-empty string`);
    }
    return value;
}

function color(value, kind) {
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
        ? value.toLowerCase()
        : DEFAULT_COLORS[kind];
}

export function normalizeGraphAnnotation(value, index = 0) {
    const kind = value?.kind === GRAPH_ANNOTATION_KINDS.section
        ? GRAPH_ANNOTATION_KINDS.section
        : GRAPH_ANNOTATION_KINDS.comment;
    const geometry = GRAPH_ANNOTATION_GEOMETRY[kind];
    return Object.freeze({
        id: requiredId(value?.id, `annotations[${index}]`),
        kind,
        title: text(
            value?.title,
            kind === GRAPH_ANNOTATION_KINDS.section
                ? "Comment section"
                : "Comment",
            80
        ),
        text: text(value?.text, "", 600),
        color: color(value?.color, kind),
        x: finite(value?.x, 0),
        y: finite(value?.y, 0),
        width: Math.max(
            geometry.minimumWidth,
            finite(value?.width, geometry.width)
        ),
        height: Math.max(
            geometry.minimumHeight,
            finite(value?.height, geometry.height)
        )
    });
}

export function normalizeGraphAnnotations(values = []) {
    if (!Array.isArray(values)) {
        throw new Error("Graph annotations must be an array");
    }
    const ids = new Set();
    return Object.freeze(values.map((value, index) => {
        const annotation = normalizeGraphAnnotation(value, index);
        if (ids.has(annotation.id)) {
            throw new Error(`Duplicate annotation id "${annotation.id}"`);
        }
        ids.add(annotation.id);
        return annotation;
    }));
}

export function createGraphComment({
    id,
    x = 0,
    y = 0,
    title = "Comment",
    text = "Add a note",
    color: annotationColor = DEFAULT_COLORS.comment,
    width = GRAPH_ANNOTATION_GEOMETRY.comment.width,
    height = GRAPH_ANNOTATION_GEOMETRY.comment.height
}) {
    return normalizeGraphAnnotation({
        id,
        kind: GRAPH_ANNOTATION_KINDS.comment,
        x,
        y,
        title,
        text,
        color: annotationColor,
        width,
        height
    });
}

export function createGraphCommentSection({
    id,
    x = 0,
    y = 0,
    title = "Comment section",
    text = "",
    color: annotationColor = DEFAULT_COLORS.section,
    width = GRAPH_ANNOTATION_GEOMETRY.section.width,
    height = GRAPH_ANNOTATION_GEOMETRY.section.height
}) {
    return normalizeGraphAnnotation({
        id,
        kind: GRAPH_ANNOTATION_KINDS.section,
        x,
        y,
        title,
        text,
        color: annotationColor,
        width,
        height
    });
}

export function graphAnnotationRectangle(annotation) {
    return Object.freeze({
        left: annotation.x,
        top: annotation.y,
        right: annotation.x + annotation.width,
        bottom: annotation.y + annotation.height,
        width: annotation.width,
        height: annotation.height
    });
}

export function nodesContainedByCommentSection(annotation, nodes) {
    if (annotation?.kind !== GRAPH_ANNOTATION_KINDS.section) return [];
    const bounds = graphAnnotationRectangle(annotation);
    return nodes.filter((node) =>
        node.x >= bounds.left
        && node.y >= bounds.top
        && node.x + node.width <= bounds.right
        && node.y + node.height <= bounds.bottom
    ).map((node) => node.id);
}

export function moveGraphAnnotation(annotation, delta) {
    return normalizeGraphAnnotation({
        ...annotation,
        x: annotation.x + finite(delta?.x, 0),
        y: annotation.y + finite(delta?.y, 0)
    });
}

export function resizeGraphAnnotation(annotation, rectangle) {
    const geometry = GRAPH_ANNOTATION_GEOMETRY[annotation.kind];
    const left = finite(rectangle?.left, annotation.x);
    const top = finite(rectangle?.top, annotation.y);
    const right = finite(
        rectangle?.right,
        left + finite(rectangle?.width, annotation.width)
    );
    const bottom = finite(
        rectangle?.bottom,
        top + finite(rectangle?.height, annotation.height)
    );
    return normalizeGraphAnnotation({
        ...annotation,
        x: left,
        y: top,
        width: Math.max(geometry.minimumWidth, right - left),
        height: Math.max(geometry.minimumHeight, bottom - top)
    });
}
