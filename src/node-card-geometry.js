export const NODE_CARD_GEOMETRY = Object.freeze({
    nodeWidth: 110,
    minimumNodeHeight: 48,
    headerHeight: 22,
    previewInset: 4,
    portSectionGap: 4,
    portRowHeight: 10,
    overlayPortPadding: 5,
    bottomPadding: 4,
    cornerRadius: 3,
    titleInsetX: 6,
    titleInsetY: 5.5,
    titleGlyphHeight: 11,
    portGlyphHeight: 9.5,
    portTextInsetX: 6,
    portLabelPadding: 8,
    portLabelHeight: 12,
    portRadius: 3.5
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

export function nodePortYPositions(
    node,
    direction,
    width,
    overrides = {}
) {
    const metrics = { ...NODE_CARD_GEOMETRY, ...overrides };
    const ports = direction === "input" ? node.inputs : node.outputs;
    const preview = nodePreviewRect(node, width, metrics);
    if (!preview) {
        const top = nodePortSectionTop(node, width, metrics);
        return Object.freeze(ports.map((_, index) =>
            top + (index + 0.5) * metrics.portRowHeight));
    }
    if (ports.length === 0) return Object.freeze([]);
    const padding = Math.min(
        metrics.overlayPortPadding,
        preview.height * 0.16
    );
    const availableHeight = Math.max(1, preview.height - padding * 2);
    return Object.freeze(ports.map((_, index) =>
        preview.y
        + padding
        + availableHeight * ((index + 0.5) / ports.length)));
}

export function nodeCardHeight(node, width, overrides = {}) {
    const metrics = { ...NODE_CARD_GEOMETRY, ...overrides };
    const preview = nodePreviewRect(node, width, metrics);
    if (preview) {
        return Math.max(
            metrics.minimumNodeHeight,
            preview.y + preview.height + metrics.previewInset
        );
    }
    const rows = Math.max(node.inputs.length, node.outputs.length, 1);
    return Math.max(
        metrics.minimumNodeHeight,
        nodePortSectionTop(node, width, metrics)
            + rows * metrics.portRowHeight
            + metrics.bottomPadding
    );
}
