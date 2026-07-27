import { describe, expect, it } from "vitest";
import {
    GPU_FONT_LAYOUT,
    gpuGlyphAdvance,
    gpuGlyphQuadWidth,
    gpuTextWidth
} from "./gpu-font-layout.js";

describe("GPU font layout", () => {
    it("preserves the source atlas cell aspect ratio", () => {
        expect(gpuGlyphQuadWidth(16)).toBeCloseTo(12.8);
        expect(gpuGlyphQuadWidth(16) / 16).toBeCloseTo(
            GPU_FONT_LAYOUT.cellWidth / GPU_FONT_LAYOUT.cellHeight
        );
    });

    it("uses the source font's natural character advances", () => {
        expect(gpuGlyphAdvance("i", 16)).toBeCloseTo(3);
        expect(gpuGlyphAdvance("e", 16)).toBeCloseTo(6);
        expect(gpuGlyphAdvance("W", 16)).toBeCloseTo(10.8);
        expect(gpuGlyphAdvance("i", 16))
            .toBeLessThan(gpuGlyphAdvance("W", 16));
    });

    it("measures mixed labels using per-character advances", () => {
        expect(gpuTextWidth("Wide", 16)).toBeCloseTo(
            gpuGlyphAdvance("W", 16)
            + gpuGlyphAdvance("i", 16)
            + gpuGlyphAdvance("d", 16)
            + gpuGlyphQuadWidth(16)
        );
    });
});
