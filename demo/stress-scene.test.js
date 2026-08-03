import { describe, expect, it } from "vitest";
import {
    connectStressScenePorts,
    createStressScene,
    duplicateStressSceneNodes,
    removeStressSceneEdge,
    removeStressSceneNodes
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

    it("removes selected nodes, incident edges, and saved positions", () => {
        const scene = createStressScene(100);
        const deletedIds = [
            scene.model.nodes[1].id,
            scene.model.nodes[2].id
        ];
        const result = removeStressSceneNodes(
            scene.model,
            scene.positions,
            deletedIds
        );

        expect(result.model.nodes).toHaveLength(98);
        expect(result.model.edges.every((edge) =>
            !deletedIds.includes(edge.from.nodeId)
            && !deletedIds.includes(edge.to.nodeId)))
            .toBe(true);
        expect(result.positions).not.toHaveProperty(deletedIds[0]);
        expect(result.positions).not.toHaveProperty(deletedIds[1]);
        expect(scene.positions).toHaveProperty(deletedIds[0]);
    });

    it("creates connections and replaces an existing input connection", () => {
        const scene = createStressScene(100);
        const target = scene.model.nodes[2];
        const result = connectStressScenePorts(scene.model, {
            from: {
                nodeId: scene.model.nodes[0].id,
                port: "value",
                type: "value"
            },
            to: {
                nodeId: target.id,
                port: "input",
                type: "value"
            }
        });

        const targetEdges = result.model.edges.filter((edge) =>
            edge.to.nodeId === target.id && edge.to.port === "input");
        expect(targetEdges).toEqual([result.edge]);
        expect(result.edge.id).toBe(
            `${scene.model.nodes[0].id}::value::${target.id}::input`
        );
    });

    it("duplicates selected nodes, internal edges, and positions", () => {
        const scene = createStressScene(100);
        const selectedIds = [
            scene.model.nodes[0].id,
            scene.model.nodes[1].id
        ];
        const result = duplicateStressSceneNodes(
            scene.model,
            scene.positions,
            selectedIds,
            1
        );

        expect(result.nodeIds).toHaveLength(2);
        expect(result.model.nodes).toHaveLength(102);
        expect(result.model.edges).toHaveLength(scene.model.edges.length + 1);
        expect(result.positions[result.nodeIds[0]]).toEqual({
            x: scene.positions[selectedIds[0]].x + 24,
            y: scene.positions[selectedIds[0]].y + 24
        });
    });
});
