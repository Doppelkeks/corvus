import { createNodeEditor } from "../src/index.js";
import "../src/styles.css";
import "./styles.css";

const model = {
    id: "standalone-demo",
    label: "Standalone demo",
    nodes: [
        {
            id: "noise",
            label: "Noise",
            type: "generator",
            category: "source",
            inputs: [],
            outputs: [{ id: "value", label: "Value", type: "float" }],
            preview: { label: "Noise preview", aspectRatio: 1 },
            summary: [{ label: "scale", value: "4.0" }]
        },
        {
            id: "levels",
            label: "Levels",
            type: "filter",
            category: "transform",
            inputs: [{ id: "source", label: "Source", type: "float" }],
            outputs: [{ id: "value", label: "Value", type: "float" }],
            summary: [{ label: "contrast", value: "1.2" }]
        },
        {
            id: "output",
            label: "Output",
            type: "output",
            category: "result",
            terminal: true,
            inputs: [{ id: "source", label: "Source", type: "float" }],
            outputs: [],
            summary: []
        }
    ],
    edges: [
        {
            id: "noise-levels",
            type: "float",
            from: { nodeId: "noise", port: "value" },
            to: { nodeId: "levels", port: "source" }
        },
        {
            id: "levels-output",
            type: "float",
            from: { nodeId: "levels", port: "value" },
            to: { nodeId: "output", port: "source" }
        }
    ]
};

const container = document.querySelector("#editor");
const editor = createNodeEditor(container, {
    onError(error) {
        console.error(error);
    }
});

editor.update(model, {
    onPositionsChange(positions) {
        console.debug("Node positions", positions);
    }
});
