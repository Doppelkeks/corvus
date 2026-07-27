export const GPU_FONT_LAYOUT = Object.freeze({
    firstCodepoint: 32,
    lastCodepoint: 126,
    columns: 16,
    rows: 6,
    cellWidth: 64,
    cellHeight: 80,
    sourceFontSize: 56
});

// Generated from Segoe UI Semibold at the same 56 px size used by the
// checked-in SDF atlas. Values are source-pixel advances for ASCII
// 32-126.
const GLYPH_ADVANCES = Object.freeze([
    15, 17, 25, 33, 31, 47, 40, 14, 19, 19, 24, 39, 14, 23, 14, 23,
    31, 23, 31, 31, 32, 31, 31, 30, 31, 31, 14, 14, 39, 39, 39, 25,
    53, 38, 34, 35, 40, 29, 28, 39, 41, 16, 22, 34, 27, 52, 43, 42,
    33, 42, 35, 30, 31, 39, 36, 54, 35, 32, 33, 19, 23, 19, 39, 23,
    16, 29, 34, 26, 34, 30, 19, 34, 33, 15, 15, 29, 15, 50, 33, 33,
    34, 34, 21, 24, 20, 33, 28, 42, 28, 28, 26, 19, 16, 19, 39
]);

function codepointIndex(character) {
    const codepoint = String(character || "?").codePointAt(0);
    const safeCodepoint = Math.max(
        GPU_FONT_LAYOUT.firstCodepoint,
        Math.min(GPU_FONT_LAYOUT.lastCodepoint, codepoint ?? 63)
    );
    return safeCodepoint - GPU_FONT_LAYOUT.firstCodepoint;
}

export function gpuGlyphQuadWidth(height) {
    return height
        * GPU_FONT_LAYOUT.cellWidth
        / GPU_FONT_LAYOUT.cellHeight;
}

export function gpuGlyphAdvance(character, height) {
    return GLYPH_ADVANCES[codepointIndex(character)]
        * height
        / GPU_FONT_LAYOUT.cellHeight;
}

export function gpuTextWidth(value, height, maximum = 28) {
    const characters = [...String(value ?? "").slice(0, maximum)];
    if (characters.length === 0) return 0;
    return characters.slice(0, -1).reduce(
        (total, character) =>
            total + gpuGlyphAdvance(character, height),
        gpuGlyphQuadWidth(height)
    );
}
