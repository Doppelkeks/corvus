import { describe, expect, it } from "vitest";
import { createProgressiveGraphSlice } from "./progressive-scene.js";

function node(id, order) {
    return {
        id,
        label: id,
        order,
        inputs: [{ id: "in", label: "In", type: "value" }],
        outputs: [{ id: "out", label: "Out", type: "value" }],
        summary: []
    };
}

function graph(nodeCount) {
    const nodes = Array.from({ length: nodeCount }, (_, index) =>
        node(`node-${index}`, index));
    return {
        id: "progressive-test",
        nodes,
        edges: [
            {
                id: "near",
                from: { nodeId: "node-0", port: "out" },
                to: { nodeId: "node-1", port: "in" }
            },
            {
                id: "leaving-viewport",
                from: { nodeId: "node-1", port: "out" },
                to: { nodeId: "node-1000", port: "in" }
            }
        ]
    };
}

describe("createProgressiveGraphSlice", () => {
    it("packs only positioned nodes near the initial viewport", () => {
        const model = graph(2000);
        const positions = Object.fromEntries(model.nodes.map((entry, index) => [
            entry.id,
            { x: index * 130, y: 0 }
        ]));
        const slice = createProgressiveGraphSlice(
            model,
            positions,
            { zoom: 1, scrollLeft: 0, scrollTop: 0 },
            { width: 200, height: 200, padding: 0 }
        );

        expect(slice.model.nodes.map((entry) => entry.id)).toEqual([
            "node-0",
            "node-1"
        ]);
        expect(slice.model.edges.map((edge) => edge.id)).toEqual(["near"]);
        expect(slice.positions).toEqual({
            "node-0": { x: 0, y: 0 },
            "node-1": { x: 130, y: 0 }
        });
    });

    it("bounds dense viewport work to the nearest nodes", () => {
        const model = graph(2000);
        const positions = Object.fromEntries(model.nodes.map((entry, index) => [
            entry.id,
            { x: index, y: index }
        ]));
        const slice = createProgressiveGraphSlice(
            model,
            positions,
            { zoom: 1, scrollLeft: 0, scrollTop: 0 },
            {
                width: 400,
                height: 400,
                padding: 0,
                nodeLimit: 25
            }
        );

        expect(slice.model.nodes).toHaveLength(25);
        const indexes = slice.model.nodes.map((entry) =>
            Number(entry.id.slice("node-".length)));
        expect(Math.min(...indexes)).toBeGreaterThan(100);
        expect(Math.max(...indexes)).toBeLessThan(300);
    });

    it("leaves smaller graphs on the normal preparation path", () => {
        const model = graph(1000);
        expect(createProgressiveGraphSlice(
            model,
            {},
            { zoom: 1, scrollLeft: 0, scrollTop: 0 },
            { width: 800, height: 600 }
        )).toBeNull();
    });
});
