import { glyphStrokePaths } from "./stroke-font.js";

const COLUMNS = 16;
const ROWS = 6;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SCALE = 8;
const SIGNED_DISTANCE_RANGE = 10;
const CELL_PADDING = 12;
const CELL_WIDTH = GLYPH_WIDTH * GLYPH_SCALE + CELL_PADDING * 2;
const CELL_HEIGHT = GLYPH_HEIGHT * GLYPH_SCALE + CELL_PADDING * 2;
const DIAGONAL_DISTANCE = Math.SQRT2;
const UI_FONT_ATLAS_URL = new URL(
    "./assets/echo-ui-semibold-sdf.png",
    import.meta.url
);
let cachedAtlasData = null;

export const GPU_FONT_ATLAS_METRICS = Object.freeze({
    columns: COLUMNS,
    rows: ROWS,
    glyphWidth: GLYPH_WIDTH,
    glyphHeight: GLYPH_HEIGHT,
    glyphScale: GLYPH_SCALE,
    distanceRange: SIGNED_DISTANCE_RANGE,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    family: "Segoe UI Variable Text, Segoe UI, Inter, sans-serif",
    weight: 600
});

function distanceToSegment(pointX, pointY, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        return Math.hypot(pointX - start.x, pointY - start.y);
    }
    const amount = Math.max(0, Math.min(1, (
        (pointX - start.x) * dx + (pointY - start.y) * dy
    ) / lengthSquared));
    return Math.hypot(
        pointX - (start.x + dx * amount),
        pointY - (start.y + dy * amount)
    );
}

function strokeGlyphMask(paths) {
    const mask = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);
    const strokeRadius = 0.074;
    for (let y = 0; y < GLYPH_HEIGHT * GLYPH_SCALE; y += 1) {
        for (let x = 0; x < GLYPH_WIDTH * GLYPH_SCALE; x += 1) {
            const pointX = (x + 0.5) / (GLYPH_WIDTH * GLYPH_SCALE);
            const pointY = (y + 0.5) / (GLYPH_HEIGHT * GLYPH_SCALE);
            let distance = Number.POSITIVE_INFINITY;
            for (const path of paths) {
                if (path.length === 1) {
                    distance = Math.min(
                        distance,
                        Math.hypot(
                            pointX - path[0].x,
                            pointY - path[0].y
                        )
                    );
                    continue;
                }
                for (let index = 1; index < path.length; index += 1) {
                    distance = Math.min(
                        distance,
                        distanceToSegment(
                            pointX,
                            pointY,
                            path[index - 1],
                            path[index]
                        )
                    );
                }
            }
            if (distance <= strokeRadius) {
                const targetX = CELL_PADDING + x;
                const targetY = CELL_PADDING + y;
                mask[targetY * CELL_WIDTH + targetX] = 1;
            }
        }
    }
    return mask;
}

function glyphMask(character) {
    return strokeGlyphMask(
        glyphStrokePaths(character) ?? glyphStrokePaths("?")
    );
}

function distanceTransform(mask, target) {
    const distance = new Float32Array(mask.length);
    distance.fill(Number.POSITIVE_INFINITY);
    for (let index = 0; index < mask.length; index += 1) {
        if (mask[index] === target) distance[index] = 0;
    }
    for (let y = 0; y < CELL_HEIGHT; y += 1) {
        for (let x = 0; x < CELL_WIDTH; x += 1) {
            const index = y * CELL_WIDTH + x;
            let value = distance[index];
            if (x > 0) value = Math.min(value, distance[index - 1] + 1);
            if (y > 0) value = Math.min(value, distance[index - CELL_WIDTH] + 1);
            if (x > 0 && y > 0) {
                value = Math.min(
                    value,
                    distance[index - CELL_WIDTH - 1] + DIAGONAL_DISTANCE
                );
            }
            if (x + 1 < CELL_WIDTH && y > 0) {
                value = Math.min(
                    value,
                    distance[index - CELL_WIDTH + 1] + DIAGONAL_DISTANCE
                );
            }
            distance[index] = value;
        }
    }
    for (let y = CELL_HEIGHT - 1; y >= 0; y -= 1) {
        for (let x = CELL_WIDTH - 1; x >= 0; x -= 1) {
            const index = y * CELL_WIDTH + x;
            let value = distance[index];
            if (x + 1 < CELL_WIDTH) {
                value = Math.min(value, distance[index + 1] + 1);
            }
            if (y + 1 < CELL_HEIGHT) {
                value = Math.min(
                    value,
                    distance[index + CELL_WIDTH] + 1
                );
            }
            if (x + 1 < CELL_WIDTH && y + 1 < CELL_HEIGHT) {
                value = Math.min(
                    value,
                    distance[index + CELL_WIDTH + 1] + DIAGONAL_DISTANCE
                );
            }
            if (x > 0 && y + 1 < CELL_HEIGHT) {
                value = Math.min(
                    value,
                    distance[index + CELL_WIDTH - 1] + DIAGONAL_DISTANCE
                );
            }
            distance[index] = value;
        }
    }
    return distance;
}

function signedDistanceAlpha(mask, insideDistance, outsideDistance, index) {
    const signedDistance = mask[index] === 1
        ? outsideDistance[index]
        : -insideDistance[index];
    return Math.round(
        Math.max(0, Math.min(
            1,
            0.5 + signedDistance / (SIGNED_DISTANCE_RANGE * 2)
        )) * 255
    );
}

function buildGpuFontAtlasData() {
    const width = COLUMNS * CELL_WIDTH;
    const height = ROWS * CELL_HEIGHT;
    const pixels = new Uint8Array(width * height * 4);
    for (let code = 32; code <= 126; code += 1) {
        const index = code - 32;
        const cellX = (index % COLUMNS) * CELL_WIDTH;
        const cellY = Math.floor(index / COLUMNS) * CELL_HEIGHT;
        const mask = glyphMask(String.fromCharCode(code));
        const insideDistance = distanceTransform(mask, 1);
        const outsideDistance = distanceTransform(mask, 0);
        for (let y = 0; y < CELL_HEIGHT; y += 1) {
            for (let x = 0; x < CELL_WIDTH; x += 1) {
                const cellIndex = y * CELL_WIDTH + x;
                const alpha = signedDistanceAlpha(
                    mask,
                    insideDistance,
                    outsideDistance,
                    cellIndex
                );
                const offset = (
                    (cellY + y) * width + cellX + x
                ) * 4;
                pixels[offset] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
                pixels[offset + 3] = alpha;
            }
        }
    }
    return { width, height, pixels };
}

export function createGpuFontAtlasData() {
    cachedAtlasData ??= buildGpuFontAtlasData();
    return cachedAtlasData;
}

function createTexture(device, width, height) {
    const texture = device.createTexture({
        label: "Node editor Echo UI signed-distance font atlas",
        size: [width, height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.RENDER_ATTACHMENT
    });
    return texture;
}

async function uploadUiFontAtlas(device) {
    const response = await fetch(UI_FONT_ATLAS_URL);
    if (!response.ok) {
        throw new Error(`UI font atlas failed with ${response.status}`);
    }
    const bitmap = await createImageBitmap(await response.blob(), {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none"
    });
    const texture = createTexture(device, bitmap.width, bitmap.height);
    device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height]
    );
    bitmap.close();
    return texture;
}

function uploadFallbackAtlas(device) {
    const { width, height, pixels } = createGpuFontAtlasData();
    const texture = createTexture(device, width, height);
    device.queue.writeTexture(
        { texture },
        pixels,
        {
            bytesPerRow: width * 4,
            rowsPerImage: height
        },
        [width, height]
    );
    return texture;
}

export async function createGpuFontAtlas(device) {
    let texture;
    try {
        texture = await uploadUiFontAtlas(device);
    } catch {
        texture = uploadFallbackAtlas(device);
    }
    return {
        texture,
        view: texture.createView(),
        sampler: device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge"
        }),
        destroy() {
            texture.destroy();
        }
    };
}
