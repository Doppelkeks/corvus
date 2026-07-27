import { describe, expect, it } from "vitest";
import { edgeVertices } from "./webgpu-edge-layer.js";

describe("WebGpuEdgeLayer geometry", () => {
    it("expands sampled segments into reusable GPU triangle vertices", () => {
        const vertices = edgeVertices([{
            id: "edge",
            type: "color",
            points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 40, y: 10 }
            ]
        }], null, null);

        // Two segment quads, six vertices per quad, six floats per vertex.
        expect(vertices).toBeInstanceOf(Float32Array);
        expect(vertices).toHaveLength(2 * 6 * 6);
        expect([...vertices].every(Number.isFinite)).toBe(true);
    });
});
