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

    it("normalizes optional generated-preview descriptors", () => {
        const model = normalizeNodeEditorModel({
            nodes: [
                { id: "plain" },
                { id: "live", preview: { label: "Live value", channel: "out" } }
            ],
            edges: []
        });

        expect(model.nodes[0].preview).toBeNull();
        expect(model.nodes[1].preview).toMatchObject({
            label: "Live value",
            aspectRatio: 16 / 9,
            channel: "out"
        });
        expect(() => normalizeNodeEditorModel({
            nodes: [{ id: "bad", preview: "thumbnail.png" }],
            edges: []
        })).toThrow(/preview descriptor/);
    });
});
