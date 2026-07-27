import { describe, expect, it } from "vitest";
import {
    createGpuFontAtlasData,
    GPU_FONT_ATLAS_METRICS
} from "./gpu-font-atlas.js";
import { glyphStrokePaths } from "./stroke-font.js";

describe("GPU font atlas", () => {
    it("builds a high-resolution signed-distance atlas without a canvas", () => {
        const atlas = createGpuFontAtlasData();
        expect(createGpuFontAtlasData()).toBe(atlas);
        expect(GPU_FONT_ATLAS_METRICS.glyphScale).toBeGreaterThanOrEqual(8);
        expect(GPU_FONT_ATLAS_METRICS.distanceRange).toBeGreaterThanOrEqual(8);
        expect(GPU_FONT_ATLAS_METRICS.family).toContain("Segoe UI");
        expect(GPU_FONT_ATLAS_METRICS.weight).toBe(600);
        expect(atlas.width).toBe(
            GPU_FONT_ATLAS_METRICS.columns
            * GPU_FONT_ATLAS_METRICS.cellWidth
        );
        expect(atlas.height).toBe(
            GPU_FONT_ATLAS_METRICS.rows
            * GPU_FONT_ATLAS_METRICS.cellHeight
        );
        const alpha = atlas.pixels.filter((_, index) => index % 4 === 3);
        expect(alpha.some((value) => value === 0)).toBe(true);
        expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
        expect(alpha.reduce((maximum, value) =>
            Math.max(maximum, value), 0)).toBeGreaterThan(160);
    });

    it("uses distinct vector strokes for normal mixed-case labels", () => {
        expect(glyphStrokePaths("A")).not.toEqual(glyphStrokePaths("a"));
        expect(glyphStrokePaths("g")).not.toBeNull();
        expect(glyphStrokePaths("(")).not.toBeNull();
        expect(glyphStrokePaths("7")).not.toBeNull();
        expect(Array.from({ length: 95 }, (_, index) =>
            glyphStrokePaths(String.fromCharCode(index + 32))
        ).every(Boolean)).toBe(true);
    });
});
