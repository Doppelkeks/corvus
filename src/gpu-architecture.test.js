import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(name) {
    return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
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
        expect(surface).toContain("pass.draw(6, overlayShapeCount, 0, underlayShapeCount)");
        expect(worker).toContain("buildGraphScene");
        expect(worker).toContain("transferableScene");
    });

    it("renders connection drags and multi-selection feedback on the GPU", () => {
        const editor = source("./node-editor.js");
        const surface = source("./webgpu-graph-surface.js");
        const shaders = source("./gpu-graph-shaders.js");
        expect(editor).toContain('addEventListener("dragover"');
        expect(editor).toContain("onDropNode");
        expect(surface).toContain("interaction.dropRect");
        expect(surface).toContain("dynamicEdgeVisible");
        expect(surface).toContain("interactionOverlayPipeline");
        expect(surface).toContain("nodeSelectionBuffer");
        expect(shaders).toContain("INTERACTION_OVERLAY_SHADER");
        expect(shaders).toContain("nodeSelection[nodeIndex]");
        expect(shaders).toContain("topRoundedDistance");
        expect(shaders).toContain("shapeInfo.z == 4.0");
        expect(shaders).toContain("accent: vec4f");
        expect(shaders).toContain("border = camera.accent");
        expect(shaders).toContain("color = camera.accent");
        expect(shaders).not.toContain("0.529, 0.839, 0.122");
    });

    it("uses the complete node card, including its preview, as the move surface", () => {
        const editor = source("./node-editor.js");
        const styles = source("./styles.css");

        expect(editor).not.toContain("point.y - node.y <= node.headerHeight");
        expect(editor).toContain('"node-drag-hovered"');
        expect(styles).toContain(".node-editor-viewport.node-drag-hovered");
        expect(editor.indexOf("const portHit = this.#portAt(point)")).toBeLessThan(
            editor.indexOf("const node = this.#nodeAt(point)"),
        );
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
        expect(shaders).not.toContain("length(fract(graph / minorCell)");
        expect(styles).not.toContain("radial-gradient");
        expect(styles).toContain(".node-workspace-panel[hidden]");
        expect(styles).toContain("display: none !important");
    });

    it("distributes dock tabs across the complete dock rail", () => {
        const styles = source("./styles.css");
        expect(styles).toContain("grid-auto-columns: minmax(max-content, 1fr);");
        expect(styles).toContain("grid-auto-flow: column;");
        expect(styles).toContain(".node-dock-tab:last-child");
        expect(styles).toMatch(/\.node-dock-tab\s*\{[^}]*touch-action:\s*pan-x;/s);
        expect(styles).toContain(".node-editor-viewport:focus-visible");
        expect(styles).toContain("outline: var(--focus-ring)");
        expect(styles).toMatch(
            /\.node-workspace-panel\.node-workspace-panel-docked\s*\{[^}]*position:\s*relative !important;/s,
        );
    });

    it("uses an unmodified wheel as the graph zoom gesture", () => {
        const editor = source("./node-editor.js");
        expect(editor).toContain("zoomGraphViewFromWheel");
        expect(editor).not.toContain("if (event.ctrlKey || event.metaKey)");
    });
});
