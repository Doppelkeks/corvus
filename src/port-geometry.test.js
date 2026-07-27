import { describe, expect, it } from "vitest";
import { socketOffsetInNode } from "./port-geometry.js";

function renderedSocket(node, offset, zoom) {
    const scene = {
        left: 230,
        top: 110,
        width: 2200 * zoom,
        height: 1400 * zoom
    };
    const size = { width: 2200, height: 1400 };
    const center = {
        x: scene.left + (node.x + offset.x) * zoom,
        y: scene.top + (node.y + offset.y) * zoom
    };
    return {
        scene,
        size,
        socket: {
            left: center.x - 4.5 * zoom,
            top: center.y - 4.5 * zoom,
            width: 9 * zoom,
            height: 9 * zoom
        }
    };
}

describe("socketOffsetInNode", () => {
    it.each([0.35, 0.5, 1, 1.5, 2.5])(
        "returns one stable graph-space socket center at %sx zoom",
        (zoom) => {
            const node = { x: 268, y: 70 };
            const expected = { x: 207.5, y: 181 };
            const rendered = renderedSocket(node, expected, zoom);

            const result = socketOffsetInNode(
                rendered.socket,
                rendered.scene,
                rendered.size,
                node
            );
            expect(result.x).toBeCloseTo(expected.x, 10);
            expect(result.y).toBeCloseTo(expected.y, 10);
        }
    );

    it("declines to cache offsets while a hidden scene has no scale", () => {
        expect(socketOffsetInNode(
            { left: 0, top: 0, width: 9, height: 9 },
            { left: 0, top: 0, width: 0, height: 0 },
            { width: 100, height: 100 },
            { x: 0, y: 0 }
        )).toBeNull();
    });
});
