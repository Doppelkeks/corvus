import { buildGraphScene } from "./graph-scene.js";
import { layoutNodeEditorModel } from "./layout.js";

function transferableScene(scene) {
    return [
        scene.nodeRecords.buffer,
        scene.shapes.buffer,
        scene.glyphs.buffer,
        scene.edges.buffer,
        scene.previews.buffer
    ];
}

self.addEventListener("message", ({ data }) => {
    if (data?.type !== "prepare") return;
    const { requestId, model, positions, layoutOptions, sceneOptions } = data;
    try {
        const layout = layoutNodeEditorModel(model, {
            ...layoutOptions,
            positions
        });
        const scene = buildGraphScene(model, layout, sceneOptions);
        self.postMessage({
            type: "prepared",
            requestId,
            layout,
            scene
        }, transferableScene(scene));
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId,
            message: error instanceof Error ? error.message : String(error)
        });
    }
});
