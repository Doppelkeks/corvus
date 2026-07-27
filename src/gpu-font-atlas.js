const COLUMNS = 16;
const ROWS = 6;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SCALE = 4;
const SIGNED_DISTANCE_RANGE = 4;
const CELL_PADDING = SIGNED_DISTANCE_RANGE + 1;
const CELL_WIDTH = GLYPH_WIDTH * GLYPH_SCALE + CELL_PADDING * 2;
const CELL_HEIGHT = GLYPH_HEIGHT * GLYPH_SCALE + CELL_PADDING * 2;

const GLYPHS = Object.freeze({
    " ": "00000000000000",
    "0": "0e11131519110e",
    "1": "040c040404040e",
    "2": "0e11010204081f",
    "3": "1e01060e01110e",
    "4": "02060a121f0202",
    "5": "1f101e0101110e",
    "6": "0608101e11110e",
    "7": "1f010204080808",
    "8": "0e11110e11110e",
    "9": "0e11110f01020c",
    A: "0e11111f111111",
    B: "1e111e11111e",
    C: "0f10101010100f",
    D: "1e11111111111e",
    E: "1f101e1010101f",
    F: "1f101e10101010",
    G: "0f10101711110f",
    H: "11111f11111111",
    I: "1f04040404041f",
    J: "0101010111110e",
    K: "1112161c161211",
    L: "1010101010101f",
    M: "111b1515111111",
    N: "11191915131311",
    O: "0e11111111110e",
    P: "1e11111e101010",
    Q: "0e11111115120d",
    R: "1e11111e141211",
    S: "0f10100e01011e",
    T: "1f040404040404",
    U: "1111111111110e",
    V: "11111111110a04",
    W: "11111115151b11",
    X: "11110a040a1111",
    Y: "11110a04040404",
    Z: "1f01020408101f",
    a: "00000e010f110f",
    b: "10101e1111111e",
    c: "00000f1010100f",
    d: "01010f1111110f",
    e: "00000e111f100e",
    f: "0609081e080808",
    g: "000f11110f010e",
    h: "10101e11111111",
    i: "04000c0404040e",
    j: "0200060202120c",
    k: "10101214181412",
    l: "0c04040404040e",
    m: "00001a15151515",
    n: "00001e11111111",
    o: "00000e1111110e",
    p: "001e11111e1010",
    q: "000f11110f0101",
    r: "00001619101010",
    s: "00000f100e011e",
    t: "08081e08080906",
    u: "0000111111110f",
    v: "00001111110a04",
    w: "0000111115150a",
    x: "0000110a040a11",
    y: "001111110f010e",
    z: "00001f0204081f",
    ".": "00000000000c0c",
    ",": "00000000000c08",
    ":": "000c0c000c0c00",
    ";": "000c0c000c0800",
    "!": "04040404040004",
    "?": "0e110102040004",
    "-": "0000001f000000",
    "_": "0000000000001f",
    "+": "0004041f040400",
    "=": "00001f001f0000",
    "/": "01020404081010",
    "\\": "10080404020101",
    "(": "02040808080402",
    ")": "08040202020408",
    "[": "0e08080808080e",
    "]": "0e02020202020e",
    "{": "02040810080402",
    "}": "08040201020408",
    "<": "02040810080402",
    ">": "08040201020408",
    "|": "04040404040404",
    "'": "04040000000000",
    "\"": "0a0a0000000000",
    "#": "0a1f0a0a1f0a00",
    "%": "19190204081313",
    "*": "000a041f040a00",
    "@": "0e11171717100f",
    "^": "040a1100000000",
    "~": "00000d16000000"
});

function glyphRows(character) {
    const encoded = GLYPHS[character]
        ?? GLYPHS[character.toUpperCase()]
        ?? "1f11151511111f";
    return Array.from({ length: GLYPH_HEIGHT }, (_, index) =>
        Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16));
}

function glyphMask(rows) {
    const mask = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);
    for (let y = 0; y < GLYPH_HEIGHT * GLYPH_SCALE; y += 1) {
        const sourceY = Math.floor(y / GLYPH_SCALE);
        const row = rows[sourceY];
        for (let x = 0; x < GLYPH_WIDTH * GLYPH_SCALE; x += 1) {
            const sourceX = Math.floor(x / GLYPH_SCALE);
            const bit = 1 << (GLYPH_WIDTH - 1 - sourceX);
            if ((row & bit) === 0) continue;
            const targetX = CELL_PADDING + x;
            const targetY = CELL_PADDING + y;
            mask[targetY * CELL_WIDTH + targetX] = 1;
        }
    }
    return mask;
}

function signedDistanceAlpha(mask, x, y) {
    const inside = mask[y * CELL_WIDTH + x] === 1;
    let distance = SIGNED_DISTANCE_RANGE;
    for (
        let offsetY = -SIGNED_DISTANCE_RANGE;
        offsetY <= SIGNED_DISTANCE_RANGE;
        offsetY += 1
    ) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= CELL_HEIGHT) continue;
        for (
            let offsetX = -SIGNED_DISTANCE_RANGE;
            offsetX <= SIGNED_DISTANCE_RANGE;
            offsetX += 1
        ) {
            const sampleX = x + offsetX;
            if (sampleX < 0 || sampleX >= CELL_WIDTH) continue;
            const sampleInside =
                mask[sampleY * CELL_WIDTH + sampleX] === 1;
            if (sampleInside === inside) continue;
            distance = Math.min(
                distance,
                Math.hypot(offsetX, offsetY)
            );
        }
    }
    const signedDistance = inside ? distance : -distance;
    return Math.round(
        Math.max(0, Math.min(
            1,
            0.5 + signedDistance / (SIGNED_DISTANCE_RANGE * 2)
        )) * 255
    );
}

function atlasPixels() {
    const width = COLUMNS * CELL_WIDTH;
    const height = ROWS * CELL_HEIGHT;
    const pixels = new Uint8Array(width * height * 4);
    for (let code = 32; code <= 126; code += 1) {
        const index = code - 32;
        const cellX = (index % COLUMNS) * CELL_WIDTH;
        const cellY = Math.floor(index / COLUMNS) * CELL_HEIGHT;
        const mask = glyphMask(glyphRows(String.fromCharCode(code)));
        for (let y = 0; y < CELL_HEIGHT; y += 1) {
            for (let x = 0; x < CELL_WIDTH; x += 1) {
                const alpha = signedDistanceAlpha(mask, x, y);
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

export function createGpuFontAtlas(device) {
    const { width, height, pixels } = atlasPixels();
    const texture = device.createTexture({
        label: "Node editor signed-distance font atlas",
        size: [width, height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
        { texture },
        pixels,
        {
            bytesPerRow: width * 4,
            rowsPerImage: height
        },
        [width, height]
    );
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
