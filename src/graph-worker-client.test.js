import { describe, expect, it } from "vitest";
import {
    GraphWorkerClient,
    prepareGraphSynchronously,
    workerSafeGraphModel
} from "./graph-worker-client.js";

const MODEL = {
    id: "worker-test",
    nodes: [
        {
            id: "source",
            label: "Source",
            outputs: [{ id: "out", type: "color" }],
            inputs: [],
            summary: []
        }
    ],
    edges: []
};

describe("GraphWorkerClient", () => {
    it("keeps a synchronous non-browser fallback for tests and SSR", async () => {
        const client = new GraphWorkerClient();
        const result = await client.prepare({
            model: MODEL,
            positions: {},
            layoutOptions: {},
            sceneOptions: {}
        });
        expect(result.layout.nodes).toHaveLength(1);
        expect(result.scene.nodeRecords).toHaveLength(4);
        client.destroy();
    });

    it("can pack a bounded progressive scene synchronously", () => {
        const result = prepareGraphSynchronously({
            model: MODEL,
            positions: { source: { x: 12, y: 18 } },
            layoutOptions: {},
            sceneOptions: {}
        });
        expect(result.layout.nodes[0]).toMatchObject({ x: 12, y: 18 });
        expect(result.scene.nodeRecords).toHaveLength(4);
    });

    it("strips host-only values before crossing the worker boundary", () => {
        const model = {
            ...MODEL,
            onInspect: () => {},
            nodes: [{
                ...MODEL.nodes[0],
                color: [0.2, 0.21, 0.23, 1],
                hostTexture: { destroy() {} }
            }]
        };
        const safe = workerSafeGraphModel(model);
        expect(() => structuredClone(safe)).not.toThrow();
        expect(safe).not.toHaveProperty("onInspect");
        expect(safe.nodes[0]).not.toHaveProperty("hostTexture");
        expect(safe.nodes[0].color).toEqual([0.2, 0.21, 0.23, 1]);
    });
});
