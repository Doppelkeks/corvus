import { describe, expect, it } from "vitest";
import { layoutNodeEditorModel } from "./layout.js";
import { normalizeNodeEditorModel } from "./model.js";

function model() {
    return normalizeNodeEditorModel({
        id: "layout-test",
        nodes: [
            { id: "a", inputs: [], outputs: [{ id: "out" }] },
            { id: "b", inputs: [], outputs: [{ id: "out" }] },
            {
                id: "c",
                inputs: [{ id: "first" }, { id: "second" }],
                outputs: []
            }
        ],
        edges: [
            {
                from: { nodeId: "a", port: "out" },
                to: { nodeId: "c", port: "first" }
            },
            {
                from: { nodeId: "b", port: "out" },
                to: { nodeId: "c", port: "second" }
            }
        ]
    });
}

describe("layoutNodeEditorModel", () => {
    it("places dependencies in deterministic columns", () => {
        const layout = layoutNodeEditorModel(model());
        const byId = new Map(layout.nodes.map((node) => [node.nodeId, node]));
        expect(byId.get("a").x).toBe(byId.get("b").x);
        expect(byId.get("c").x).toBeGreaterThan(byId.get("a").x);
        expect(byId.get("b").y).toBeGreaterThan(byId.get("a").y);
    });

    it("does not let a manual position reorganize automatic siblings", () => {
        const baseline = layoutNodeEditorModel(model());
        const moved = layoutNodeEditorModel(model(), {
            positions: { a: { x: 900, y: 700 } }
        });
        const baselineById = new Map(
            baseline.nodes.map((node) => [node.nodeId, node])
        );
        const movedById = new Map(
            moved.nodes.map((node) => [node.nodeId, node])
        );
        expect(movedById.get("a")).toMatchObject({ x: 900, y: 700 });
        expect(movedById.get("b")).toMatchObject({
            x: baselineById.get("b").x,
            y: baselineById.get("b").y
        });
        expect(movedById.get("c")).toMatchObject({
            x: baselineById.get("c").x,
            y: baselineById.get("c").y
        });
    });

    it("supports independent workspace gutters", () => {
        const layout = layoutNodeEditorModel(model(), {
            paddingX: 260,
            paddingY: 70
        });
        expect(layout.nodes[0]).toMatchObject({ x: 260, y: 70 });
    });

    it("reserves compact card space only for nodes with previews", () => {
        const source = model();
        const plain = layoutNodeEditorModel(source);
        const withPreview = layoutNodeEditorModel(normalizeNodeEditorModel({
            ...source,
            nodes: source.nodes.map((node) => ({
                ...node,
                preview: node.id === "a"
                    ? { aspectRatio: 1 }
                    : null
            }))
        }));
        const plainA = plain.nodes.find((node) => node.nodeId === "a");
        const previewA = withPreview.nodes.find((node) => node.nodeId === "a");

        expect(previewA.height).toBeGreaterThanOrEqual(
            plainA.height + 96
        );
    });

    it("does not grow preview cards when connector counts increase", () => {
        const previewNode = (id, inputCount) => ({
            id,
            preview: { aspectRatio: 1 },
            inputs: Array.from({ length: inputCount }, (_, index) => ({
                id: `input-${index}`
            })),
            outputs: [{ id: "out" }]
        });
        const layout = layoutNodeEditorModel(normalizeNodeEditorModel({
            id: "compact-preview-connectors",
            nodes: [
                previewNode("few", 1),
                previewNode("many", 9)
            ],
            edges: []
        }));
        const few = layout.nodes.find((node) => node.nodeId === "few");
        const many = layout.nodes.find((node) => node.nodeId === "many");

        expect(many.height).toBe(few.height);
        expect(many.height).toBe(268);
    });

    it("keeps parameter summaries out of graph card geometry", () => {
        const source = model();
        const withoutSummary = layoutNodeEditorModel(source);
        const withSummary = layoutNodeEditorModel(normalizeNodeEditorModel({
            ...source,
            nodes: source.nodes.map((node) => ({
                ...node,
                summary: node.id === "a"
                    ? [{ label: "color", value: "#ff00ff" }]
                    : []
            }))
        }));
        const height = (layout, id) =>
            layout.nodes.find((node) => node.nodeId === id).height;

        expect(height(withSummary, "a")).toBe(height(withoutSummary, "a"));
    });

    it("lays out deep graphs iteratively without overflowing the stack", () => {
        const count = 10_000;
        const nodes = Array.from({ length: count }, (_, index) => ({
            id: `node-${index}`,
            inputs: index === 0 ? [] : [{ id: "in" }],
            outputs: index === count - 1 ? [] : [{ id: "out" }]
        }));
        const edges = Array.from({ length: count - 1 }, (_, index) => ({
            from: { nodeId: `node-${index}`, port: "out" },
            to: { nodeId: `node-${index + 1}`, port: "in" }
        }));
        const layout = layoutNodeEditorModel(normalizeNodeEditorModel({
            id: "deep-graph",
            nodes,
            edges
        }));
        expect(layout.nodes).toHaveLength(count);
        expect(layout.nodes.at(-1).x).toBeGreaterThan(layout.nodes[0].x);
    });
});
