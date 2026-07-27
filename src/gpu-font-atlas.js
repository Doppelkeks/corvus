const COLUMNS = 16;
const ROWS = 6;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 10;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

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

function atlasPixels() {
    const width = COLUMNS * CELL_WIDTH;
    const height = ROWS * CELL_HEIGHT;
    const pixels = new Uint8Array(width * height * 4);
    for (let code = 32; code <= 126; code += 1) {
        const index = code - 32;
        const cellX = (index % COLUMNS) * CELL_WIDTH + 1;
        const cellY = Math.floor(index / COLUMNS) * CELL_HEIGHT + 1;
        glyphRows(String.fromCharCode(code)).forEach((row, y) => {
            for (let x = 0; x < GLYPH_WIDTH; x += 1) {
                if ((row & (1 << (GLYPH_WIDTH - 1 - x))) === 0) continue;
                const offset = (
                    (cellY + y) * width + cellX + x
                ) * 4;
                pixels[offset] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
                pixels[offset + 3] = 255;
            }
        });
    }
    return { width, height, pixels };
}

export function createGpuFontAtlas(device) {
    const { width, height, pixels } = atlasPixels();
    const texture = device.createTexture({
        label: "Node editor bitmap font atlas",
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
            magFilter: "nearest",
            minFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge"
        }),
        destroy() {
            texture.destroy();
        }
    };
}
