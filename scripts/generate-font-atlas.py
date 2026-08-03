"""Generate the WebGPU signed-distance atlas and metrics from ProFont."""

from argparse import ArgumentParser
from math import sqrt
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


COLUMNS = 16
ROWS = 6
CELL_WIDTH = 64
CELL_HEIGHT = 80
FONT_SIZE = 56
DISTANCE_RANGE = 10
FIRST_CODEPOINT = 32
LAST_CODEPOINT = 126
DIAGONAL = sqrt(2)


def distance_transform(mask: np.ndarray, target: bool) -> np.ndarray:
    height, width = mask.shape
    distance = np.full((height, width), np.inf, dtype=np.float32)
    distance[mask == target] = 0
    for y in range(height):
        for x in range(width):
            index_value = distance[y, x]
            if x:
                index_value = min(index_value, distance[y, x - 1] + 1)
            if y:
                index_value = min(index_value, distance[y - 1, x] + 1)
            if x and y:
                index_value = min(index_value, distance[y - 1, x - 1] + DIAGONAL)
            if x + 1 < width and y:
                index_value = min(index_value, distance[y - 1, x + 1] + DIAGONAL)
            distance[y, x] = index_value
    for y in range(height - 1, -1, -1):
        for x in range(width - 1, -1, -1):
            index_value = distance[y, x]
            if x + 1 < width:
                index_value = min(index_value, distance[y, x + 1] + 1)
            if y + 1 < height:
                index_value = min(index_value, distance[y + 1, x] + 1)
            if x + 1 < width and y + 1 < height:
                index_value = min(index_value, distance[y + 1, x + 1] + DIAGONAL)
            if x and y + 1 < height:
                index_value = min(index_value, distance[y + 1, x - 1] + DIAGONAL)
            distance[y, x] = index_value
    return distance


def glyph_mask(character: str, font: ImageFont.FreeTypeFont) -> np.ndarray:
    image = Image.new("L", (CELL_WIDTH, CELL_HEIGHT), 0)
    draw = ImageDraw.Draw(image)
    if character != " ":
        draw.text((CELL_WIDTH / 2, CELL_HEIGHT / 2), character, font=font, fill=255, anchor="mm")
    return np.asarray(image) >= 96


def signed_distance(mask: np.ndarray) -> np.ndarray:
    if not mask.any():
        return np.zeros(mask.shape, dtype=np.uint8)
    inside = distance_transform(mask, True)
    outside = distance_transform(mask, False)
    signed = np.where(mask, outside, -inside)
    normalized = np.clip(0.5 + signed / (DISTANCE_RANGE * 2), 0, 1)
    return np.rint(normalized * 255).astype(np.uint8)


def build_atlas(font_path: Path) -> Image.Image:
    font = ImageFont.truetype(str(font_path), FONT_SIZE)
    atlas = np.zeros((ROWS * CELL_HEIGHT, COLUMNS * CELL_WIDTH, 4), dtype=np.uint8)
    atlas[:, :, :3] = 255
    for codepoint in range(FIRST_CODEPOINT, LAST_CODEPOINT + 1):
        index = codepoint - FIRST_CODEPOINT
        left = index % COLUMNS * CELL_WIDTH
        top = index // COLUMNS * CELL_HEIGHT
        atlas[top:top + CELL_HEIGHT, left:left + CELL_WIDTH, 3] = signed_distance(glyph_mask(chr(codepoint), font))
    return Image.fromarray(atlas, "RGBA")


def array_source(values: list[float | int]) -> str:
    rows = [", ".join(f"{value:g}" for value in values[index:index + 16]) for index in range(0, len(values), 16)]
    return ",\n    ".join(rows)


def write_metrics_module(font_path: Path, output_path: Path) -> None:
    font = ImageFont.truetype(str(font_path), FONT_SIZE)
    advances = [round(font.getlength(chr(codepoint)), 3) for codepoint in range(FIRST_CODEPOINT, LAST_CODEPOINT + 1)]
    origin_offsets_x = []
    for codepoint in range(FIRST_CODEPOINT, LAST_CODEPOINT + 1):
        character = chr(codepoint)
        mask = glyph_mask(character, font)
        if not mask.any():
            origin_offsets_x.append(0)
            continue
        centered_left = int(np.where(mask)[1].min())
        natural_left = font.getbbox(character, anchor="ls")[0]
        origin_offsets_x.append(natural_left - centered_left)

    output_path.write_text(
        f'''export const GPU_FONT_LAYOUT = Object.freeze({{
    firstCodepoint: {FIRST_CODEPOINT},
    lastCodepoint: {LAST_CODEPOINT},
    columns: {COLUMNS},
    rows: {ROWS},
    cellWidth: {CELL_WIDTH},
    cellHeight: {CELL_HEIGHT},
    sourceFontSize: {FONT_SIZE}
}});

// Generated from the MIT-licensed ProFontWindows.ttf at {FONT_SIZE} px.
const GLYPH_ADVANCES = Object.freeze([
    {array_source(advances)}
]);

// The atlas centers each glyph inside a fixed-size cell. These source-pixel
// offsets restore the font's natural pen origin when the cell quad is drawn.
const GLYPH_ORIGIN_OFFSETS_X = Object.freeze([
    {array_source(origin_offsets_x)}
]);

function codepointIndex(character) {{
    const codepoint = String(character || "?").codePointAt(0);
    const safeCodepoint = Math.max(
        GPU_FONT_LAYOUT.firstCodepoint,
        Math.min(GPU_FONT_LAYOUT.lastCodepoint, codepoint ?? 63)
    );
    return safeCodepoint - GPU_FONT_LAYOUT.firstCodepoint;
}}

export function gpuGlyphQuadWidth(height) {{
    return height * GPU_FONT_LAYOUT.cellWidth / GPU_FONT_LAYOUT.cellHeight;
}}

export function gpuGlyphAdvance(character, height) {{
    return GLYPH_ADVANCES[codepointIndex(character)] * height / GPU_FONT_LAYOUT.cellHeight;
}}

export function gpuGlyphOffsetX(character, height) {{
    return GLYPH_ORIGIN_OFFSETS_X[codepointIndex(character)] * height / GPU_FONT_LAYOUT.cellHeight;
}}

export function gpuTextWidth(value, height, maximum = 28) {{
    const characters = [...String(value ?? "").slice(0, maximum)];
    return characters.reduce(
        (total, character) => total + gpuGlyphAdvance(character, height),
        0
    );
}}
''',
        encoding="utf-8",
    )


def main() -> None:
    repository = Path(__file__).resolve().parents[1]
    parser = ArgumentParser()
    parser.add_argument("--font", type=Path, default=repository / "src" / "assets" / "ProFontWindows.ttf")
    parser.add_argument("--output", type=Path, default=repository / "src" / "assets" / "profont-sdf.png")
    parser.add_argument("--metrics-output", type=Path, default=repository / "src" / "gpu-font-layout.js")
    arguments = parser.parse_args()
    if not arguments.font.is_file():
        raise FileNotFoundError(f"ProFont source not found: {arguments.font}")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    build_atlas(arguments.font).save(arguments.output, optimize=True)
    write_metrics_module(arguments.font, arguments.metrics_output)
    print(f"Wrote {COLUMNS * CELL_WIDTH}x{ROWS * CELL_HEIGHT} ProFont SDF atlas to {arguments.output}")


if __name__ == "__main__":
    main()
