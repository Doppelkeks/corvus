const DEFAULT_ACCENT = Object.freeze([
    0x7d / 255,
    0xd3 / 255,
    0xfc / 255,
    1
]);

function parsedChannels(value) {
    const source = String(value ?? "").trim();
    const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(source);
    if (hex) {
        return [
            Number.parseInt(hex[1], 16) / 255,
            Number.parseInt(hex[2], 16) / 255,
            Number.parseInt(hex[3], 16) / 255,
            1
        ];
    }
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i
        .exec(source);
    if (!rgb) return null;
    return [
        Math.min(255, Number(rgb[1])) / 255,
        Math.min(255, Number(rgb[2])) / 255,
        Math.min(255, Number(rgb[3])) / 255,
        1
    ];
}

export function nodeEditorAccentChannels(value) {
    return parsedChannels(value) ?? [...DEFAULT_ACCENT];
}

export function resolveNodeEditorAccent(element, explicitValue = null) {
    const explicit = parsedChannels(explicitValue);
    if (explicit) return explicit;
    if (typeof getComputedStyle !== "function" || !element) {
        return [...DEFAULT_ACCENT];
    }
    const style = getComputedStyle(element);
    return parsedChannels(style.getPropertyValue("--node-editor-accent"))
        ?? [...DEFAULT_ACCENT];
}
