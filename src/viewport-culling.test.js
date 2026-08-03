import { describe, expect, it } from "vitest";
import {
    graphEdgeVisible,
    graphRectVisible,
    graphViewportBounds
} from "./viewport-culling.js";

describe("viewport culling", () => {
    it("converts the screen viewport into padded graph bounds", () => {
        const bounds = graphViewportBounds({
            zoom: 0.5,
            scrollLeft: 100,
            scrollTop: 50
        }, 800, 600, 20);

        expect(bounds).toEqual({
            left: 160,
            top: 60,
            right: 1840,
            bottom: 1340
        });
        expect(graphRectVisible(1820, 200, 100, 100, bounds)).toBe(true);
        expect(graphRectVisible(1940, 200, 100, 100, bounds)).toBe(false);
    });

    it("retains a connection crossing the viewport with off-screen endpoints", () => {
        const nodes = new Float32Array([
            -400, 100, 100, 80,
            800, 100, 100, 80
        ]);
        const edges = new Float32Array([
            0, 1, 100, 40,
            0, 40, 0, 0,
            1.7, 0, 0, 0
        ]);
        const bounds = { left: 0, top: 0, right: 600, bottom: 400 };

        expect(graphEdgeVisible(nodes, edges, 0, bounds)).toBe(true);
        nodes[1] = 800;
        nodes[5] = 800;
        expect(graphEdgeVisible(nodes, edges, 0, bounds)).toBe(false);
    });
});
