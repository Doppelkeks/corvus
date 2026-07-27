import { describe, expect, it } from "vitest";
import { layoutNodeEditorModel } from "./layout.js";
import { normalizeNodeEditorModel } from "./model.js";
import {
    buildGraphScene,
    GRAPH_SCENE_STRIDES
} from "./graph-scene.js";

function fixture() {
    return normalizeNodeEditorModel({
        id: "gpu-scene",
        nodes: [{
            id: "source",
            label: "Noise",
            type: "noise",
            preview: true,
            outputs: [{ id: "out", type: "grayscale" }],
            summary: [{ label: "scale", value: "12" }]
        }, {
            id: "result",
            label: "Output",
            type: "output",
            terminal: true,
            inputs: [{ id: "input", type: "grayscale" }]
        }],
        edges: [{
            id: "source-to-result",
            type: "grayscale",
            from: { nodeId: "source", port: "out" },
            to: { nodeId: "result", port: "input" }
        }]
    });
}

describe("buildGraphScene", () => {
    it("packs nodes, ports, glyphs, previews, and edges for GPU upload", () => {
        const model = fixture();
        const layout = layoutNodeEditorModel(model);
        const scene = buildGraphScene(model, layout);

        expect(scene.nodeRecords.length / GRAPH_SCENE_STRIDES.node).toBe(2);
        expect(scene.shapes.length % GRAPH_SCENE_STRIDES.shape).toBe(0);
        expect(scene.glyphs.length % GRAPH_SCENE_STRIDES.glyph).toBe(0);
        expect(scene.edges.length / GRAPH_SCENE_STRIDES.edge).toBe(1);
        expect(scene.previews.length / GRAPH_SCENE_STRIDES.preview).toBe(1);
        expect(scene.hitNodes[0].ports[0]).toMatchObject({
            id: "out",
            direction: "output",
            x: layout.nodes[0].width
        });
        expect(scene.hitEdges[0].points).toHaveLength(25);
        expect(Object.keys(scene.spatialIndex.cells).length).toBeGreaterThan(0);
    });

    it("keeps output socket and wire anchors on the exact node boundary", () => {
        const model = fixture();
        const layout = layoutNodeEditorModel(model);
        const scene = buildGraphScene(model, layout);
        const source = scene.hitNodes[0];
        const output = source.ports[0];
        const edgeStart = scene.hitEdges[0].points[0];

        expect(edgeStart.x).toBe(source.x + source.width);
        expect(edgeStart.y).toBe(source.y + output.y);
    });

    it("renders square previews without parameter text on graph cards", () => {
        const withSummary = normalizeNodeEditorModel({
            ...fixture(),
            nodes: fixture().nodes.map((node) => ({
                ...node,
                preview: node.id === "source"
                    ? { aspectRatio: 1 }
                    : node.preview
            }))
        });
        const withoutSummary = normalizeNodeEditorModel({
            ...withSummary,
            nodes: withSummary.nodes.map((node) => ({
                ...node,
                summary: []
            }))
        });
        const scene = buildGraphScene(
            withSummary,
            layoutNodeEditorModel(withSummary)
        );
        const summaryFreeScene = buildGraphScene(
            withoutSummary,
            layoutNodeEditorModel(withoutSummary)
        );
        const preview = [...scene.previews.slice(0, 4)];

        expect(preview[2]).toBe(preview[3]);
        expect(scene.glyphs.length).toBe(summaryFreeScene.glyphs.length);
    });

    it("keeps normal-node header surfaces neutral instead of blue", () => {
        const model = normalizeNodeEditorModel({
            id: "neutral-normal-node",
            nodes: [{
                id: "normal",
                label: "Height To Normal",
                category: "normal",
                inputs: [{ id: "in", type: "grayscale" }],
                outputs: [{ id: "out", type: "color" }]
            }],
            edges: []
        });
        const scene = buildGraphScene(
            model,
            layoutNodeEditorModel(model)
        );
        const headerFillOffset = GRAPH_SCENE_STRIDES.shape + 4;
        const headerFill = scene.shapes.slice(
            headerFillOffset,
            headerFillOffset + 4
        );

        expect(headerFill[2]).toBeLessThan(headerFill[1]);
    });

    it("packs release-scale graphs into bounded transferable arrays", () => {
        const nodeCount = 2_048;
        const model = normalizeNodeEditorModel({
            id: "large-gpu-scene",
            nodes: Array.from({ length: nodeCount }, (_, index) => ({
                id: `n${index}`,
                label: `Node ${index}`,
                inputs: index === 0 ? [] : [{ id: "in" }],
                outputs: index === nodeCount - 1
                    ? []
                    : [{ id: "out" }]
            })),
            edges: Array.from({ length: nodeCount - 1 }, (_, index) => ({
                from: { nodeId: `n${index}`, port: "out" },
                to: { nodeId: `n${index + 1}`, port: "in" }
            }))
        });
        const scene = buildGraphScene(
            model,
            layoutNodeEditorModel(model)
        );

        expect(scene.nodeRecords).toBeInstanceOf(Float32Array);
        expect(scene.nodeRecords.length / GRAPH_SCENE_STRIDES.node)
            .toBe(nodeCount);
        expect(scene.edges.length / GRAPH_SCENE_STRIDES.edge)
            .toBe(nodeCount - 1);
        expect(scene.hitNodes).toHaveLength(nodeCount);
        expect(scene.hitEdges).toHaveLength(nodeCount - 1);
    });
});
