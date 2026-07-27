export const NODE_CARD_GEOMETRY = Object.freeze({
    nodeWidth: 220,
    minimumNodeHeight: 96,
    headerHeight: 48,
    previewInset: 8,
    portSectionGap: 8,
    portRowHeight: 20,
    bottomPadding: 8
});

export function nodePreviewRect(node, width, overrides = {}) {
    if (!node.preview) return null;
    const metrics = { ...NODE_CARD_GEOMETRY, ...overrides };
    const inset = Math.max(0, metrics.previewInset);
    const previewWidth = Math.max(1, width - inset * 2);
    const aspectRatio = Number.isFinite(node.preview.aspectRatio)
        && node.preview.aspectRatio > 0
        ? node.preview.aspectRatio
        : 1;
    return Object.freeze({
        x: inset,
        y: metrics.headerHeight + inset,
        width: previewWidth,
        height: previewWidth / aspectRatio
    });
}

export function nodePortSectionTop(node, width, overrides = {}) {
    const metrics = { ...NODE_CARD_GEOMETRY, ...overrides };
    const preview = nodePreviewRect(node, width, metrics);
    return preview
        ? preview.y + preview.height + metrics.portSectionGap
        : metrics.headerHeight + metrics.portSectionGap;
}

export function nodeCardHeight(node, width, overrides = {}) {
    const metrics = { ...NODE_CARD_GEOMETRY, ...overrides };
    const rows = Math.max(node.inputs.length, node.outputs.length, 1);
    return Math.max(
        metrics.minimumNodeHeight,
        nodePortSectionTop(node, width, metrics)
            + rows * metrics.portRowHeight
            + metrics.bottomPadding
    );
}
