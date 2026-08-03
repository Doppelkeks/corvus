export const GPU_FONT_LAYOUT = Object.freeze({
    firstCodepoint: 32,
    lastCodepoint: 126,
    columns: 16,
    rows: 6,
    cellWidth: 64,
    cellHeight: 80,
    sourceFontSize: 56
});

// Generated from the MIT-licensed ProFontWindows.ttf at 56 px.
const GLYPH_ADVANCES = Object.freeze([
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28
]);

// The atlas centers each glyph inside a fixed-size cell. These source-pixel
// offsets restore the font's natural pen origin when the cell quad is drawn.
const GLYPH_ORIGIN_OFFSETS_X = Object.freeze([
    0, -27, -23, -18, -18, -18, -18, -27, -23, -22, -19, -18, -24, -23, -25, -18,
    -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -25, -24, -22, -18, -22, -18,
    -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18,
    -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -18, -27, -20, -23, -18, -18,
    -22, -18, -18, -18, -18, -18, -23, -18, -18, -23, -18, -18, -23, -18, -18, -18,
    -18, -18, -18, -18, -23, -18, -18, -18, -18, -18, -18, -23, -27, -23, -18
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
    return height * GPU_FONT_LAYOUT.cellWidth / GPU_FONT_LAYOUT.cellHeight;
}

export function gpuGlyphAdvance(character, height) {
    return GLYPH_ADVANCES[codepointIndex(character)] * height / GPU_FONT_LAYOUT.cellHeight;
}

export function gpuGlyphOffsetX(character, height) {
    return GLYPH_ORIGIN_OFFSETS_X[codepointIndex(character)] * height / GPU_FONT_LAYOUT.cellHeight;
}

export function gpuTextWidth(value, height, maximum = 28) {
    const characters = [...String(value ?? "").slice(0, maximum)];
    return characters.reduce(
        (total, character) => total + gpuGlyphAdvance(character, height),
        0
    );
}
