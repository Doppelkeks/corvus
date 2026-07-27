import { describe, expect, it } from "vitest";
import {
    createEdgeId,
    normalizeNodeEditorModel
} from "./model.js";

describe("node editor model", () => {
    it("normalizes generic nodes, ports, and stable edge ids", () => {
        const model = normalizeNodeEditorModel({
            nodes: [
                { id: "source", outputs: [{ name: "out" }] },
                { id: "target", inputs: [{ name: "in" }] }
            ],
            edges: [{
                from: { nodeId: "source", output: "out" },
                to: { nodeId: "target", input: "in" }
            }]
        });
        expect(model.nodes[0].outputs[0]).toMatchObject({
            id: "out",
            label: "out"
        });
        expect(model.edges[0].id).toBe("source::out::target::in");
        expect(createEdgeId(model.edges[0])).toBe(model.edges[0].id);
    });

    it("rejects duplicate ids and missing endpoint nodes", () => {
        expect(() => normalizeNodeEditorModel({
            nodes: [{ id: "same" }, { id: "same" }],
            edges: []
        })).toThrow(/Duplicate node id/);
        expect(() => normalizeNodeEditorModel({
            nodes: [{ id: "source", outputs: [{ id: "out" }] }],
            edges: [{
                from: { nodeId: "source", port: "out" },
                to: { nodeId: "missing", port: "in" }
            }]
        })).toThrow(/missing node/);
    });
});
