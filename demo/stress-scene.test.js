import { describe, expect, it } from "vitest";
import {
    createStressScene,
    removeStressSceneEdge
} from "./stress-scene.js";

describe("stress scene", () => {
    it("builds thousands of positioned nodes and dense deterministic edges", () => {
        const first = createStressScene(5000);
        const second = createStressScene(5000);

        expect(first.model.nodes).toHaveLength(5000);
        expect(first.model.edges.length).toBeGreaterThan(5000);
        expect(Object.keys(first.positions)).toHaveLength(5000);
        expect(first.model.edges).toEqual(second.model.edges);
        expect(first.positions).toEqual(second.positions);
    });

    it("keeps selectable scene sizes inside the supported stress range", () => {
        expect(createStressScene(12).model.nodes).toHaveLength(100);
        expect(createStressScene(50000).model.nodes).toHaveLength(10000);
    });

    it("removes a selected connection without mutating the source model", () => {
        const scene = createStressScene(100);
        const edge = scene.model.edges[0];
        const nextModel = removeStressSceneEdge(scene.model, edge.id);

        expect(nextModel.edges).toHaveLength(scene.model.edges.length - 1);
        expect(nextModel.edges.some((entry) => entry.id === edge.id))
            .toBe(false);
        expect(scene.model.edges.some((entry) => entry.id === edge.id))
            .toBe(true);
        expect(removeStressSceneEdge(nextModel, "missing-edge"))
            .toBe(nextModel);
    });
});
