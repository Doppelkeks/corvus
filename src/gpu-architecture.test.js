import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(name) {
    return readFileSync(fileURLToPath(
        new URL(name, import.meta.url)
    ), "utf8");
}

describe("GPU-only graph surface architecture", () => {
    it("keeps the visible graph in one canvas without HTML or SVG nodes", () => {
        const editor = source("./node-editor.js");
        const fontAtlas = source("./gpu-font-atlas.js");
        expect(editor).toContain('document.createElement("canvas")');
        expect(editor).not.toContain('document.createElement("article")');
        expect(editor).not.toContain("createElementNS");
        expect(editor).not.toContain("nodeLayer");
        expect(editor).not.toContain("wireCanvas");
        expect(fontAtlas).not.toContain("OffscreenCanvas");
        expect(fontAtlas).not.toContain("createElement");
        expect(fontAtlas).not.toContain('getContext("2d"');
        expect(fontAtlas).toContain("echo-ui-semibold-sdf.png");
        expect(fontAtlas).toContain("copyExternalImageToTexture");
        expect(fontAtlas).toContain("GPUTextureUsage.RENDER_ATTACHMENT");
        expect(fontAtlas).toContain("queue.writeTexture");
    });

    it("uses worker preparation and compute-driven geometry", () => {
        const editor = source("./node-editor.js");
        const surface = source("./webgpu-graph-surface.js");
        const worker = source("./graph-layout.worker.js");
        expect(editor).toContain("GraphWorkerClient");
        expect(surface.match(/createComputePipeline/g)).toHaveLength(2);
        expect(surface).toContain("edge tessellation");
        expect(surface).toContain("shape transform and cull");
        expect(surface).toContain("underlayShapeCount");
        expect(surface).toContain(
            "pass.draw(6, overlayShapeCount, 0, underlayShapeCount)"
        );
        expect(worker).toContain("buildGraphScene");
        expect(worker).toContain("transferableScene");
    });

    it("uses antialiased GPU text and renders a quiet line grid", () => {
        const fontAtlas = source("./gpu-font-atlas.js");
        const strokeFont = source("./stroke-font.js");
        const shaders = source("./gpu-graph-shaders.js");
        const styles = source("./styles.css");
        expect(fontAtlas).toContain('magFilter: "linear"');
        expect(fontAtlas).toContain('minFilter: "linear"');
        expect(fontAtlas).toContain("SIGNED_DISTANCE_RANGE");
        expect(fontAtlas).toContain("uploadUiFontAtlas");
        expect(strokeFont).toContain('a: "2,4.5');
        expect(shaders).toContain("round(unsnappedScreen * pixelRatio)");
        expect(shaders).toContain("fwidth(sample.a)");
        expect(shaders).toContain("minorCoordinate");
        expect(shaders).not.toContain(
            "length(fract(graph / minorCell)"
        );
        expect(styles).not.toContain("radial-gradient");
        expect(styles).toContain(".node-workspace-panel[hidden]");
        expect(styles).toContain("display: none !important");
    });
});
