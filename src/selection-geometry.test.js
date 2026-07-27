import { describe, expect, it } from "vitest";
import {
    nodeIntersectsSelection,
    nodesInSelection,
    selectionRectangle
} from "./selection-geometry.js";

describe("selection geometry", () => {
    it("normalizes rectangles dragged in any direction", () => {
        expect(selectionRectangle(
            { x: 80, y: 90 },
            { x: 20, y: 10 }
        )).toEqual({
            left: 20,
            top: 10,
            right: 80,
            bottom: 90
        });
    });

    it("selects every node touched by the marquee", () => {
        const nodes = [
            { id: "inside", x: 20, y: 20, width: 40, height: 40 },
            { id: "touching", x: 90, y: 90, width: 30, height: 30 },
            { id: "outside", x: 140, y: 20, width: 30, height: 30 }
        ];
        expect(nodesInSelection(
            nodes,
            { x: 0, y: 0 },
            { x: 100, y: 100 }
        )).toEqual(["inside", "touching"]);
        expect(nodeIntersectsSelection(
            nodes[2],
            selectionRectangle({ x: 0, y: 0 }, { x: 100, y: 100 })
        )).toBe(false);
    });
});
