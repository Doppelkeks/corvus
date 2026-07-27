import { describe, expect, it } from "vitest";
import {
    distanceToSegment,
    hitTestEdges,
    sampleCubicEdge
} from "./edge-geometry.js";

describe("node editor edge geometry", () => {
    it("samples endpoints without drift", () => {
        const points = sampleCubicEdge(
            { x: 10, y: 20 },
            { x: 180, y: 90 },
            12
        );
        expect(points).toHaveLength(13);
        expect(points[0]).toEqual({ x: 10, y: 20 });
        expect(points.at(-1)).toEqual({ x: 180, y: 90 });
    });

    it("selects the nearest edge inside the hit tolerance", () => {
        const edge = {
            id: "edge",
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
        };
        expect(hitTestEdges([edge], { x: 50, y: 5 }, 6)?.id).toBe("edge");
        expect(hitTestEdges([edge], { x: 50, y: 8 }, 6)).toBeNull();
        expect(distanceToSegment(
            { x: 50, y: 5 },
            edge.points[0],
            edge.points[1]
        )).toBe(5);
    });
});
