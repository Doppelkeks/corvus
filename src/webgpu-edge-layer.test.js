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

        // Two joined ribbon segments, six vertices per segment, eight floats
        // per vertex (position, color, signed edge distance, half width).
        expect(vertices).toBeInstanceOf(Float32Array);
        expect(vertices).toHaveLength(2 * 6 * 8);
        expect([...vertices].every(Number.isFinite)).toBe(true);
        expect(vertices[6]).toBeGreaterThan(0);
        expect(vertices[14]).toBeLessThan(0);
    });
});
