import { describe, expect, it } from "vitest";
import { describeNodeInspector } from "./node-inspector.js";

const model = {
    nodes: [{
        id: "source",
        label: "Source",
        type: "source",
        category: "data",
        inputs: [],
        outputs: [{ id: "value", label: "Value", type: "value" }],
        summary: [{ label: "status", value: "ready" }]
    }, {
        id: "target",
        label: "Target",
        type: "output",
        category: "output",
        inputs: [{ id: "input", label: "Input", type: "value" }],
        outputs: [],
        summary: []
    }],
    edges: [{
        id: "source-to-target",
        type: "value",
        from: { nodeId: "source", port: "value" },
        to: { nodeId: "target", port: "input" }
    }]
};

describe("node inspector descriptions", () => {
    it("describes nodes with their standard fields, ports, and summary", () => {
        const description = describeNodeInspector(model, {
            selectedNodeId: "source"
        });

        expect(description.kind).toBe("node");
        expect(description.title).toBe("Source");
        expect(description.sections.map((section) => section.title))
            .toEqual(["Summary", "Outputs"]);
    });

    it("describes selected connections and multi-node selections", () => {
        const edge = describeNodeInspector(model, {
            selectedEdgeId: "source-to-target"
        });
        const nodes = describeNodeInspector(model, {
            selectedNodeIds: ["source", "target"]
        });

        expect(edge).toMatchObject({
            kind: "edge",
            title: "Source → Target"
        });
        expect(nodes).toMatchObject({ kind: "nodes", title: "2 nodes" });
    });
});
