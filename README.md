# `@echo/node-editor`

A use-case-agnostic, WebGPU-accelerated node editor for browser applications.
It knows about nodes, ports, edges, layout, selection, and workspace panels; it
does not import material, art, compiler, or runtime packages.

## Model

```js
const model = {
  id: "example",
  nodes: [{
    id: "source",
    label: "Source",
    type: "generator",
    category: "input",
    inputs: [],
    outputs: [{ id: "out", label: "Output", type: "color" }],
    preview: { label: "Generated output", aspectRatio: 16 / 9 },
    summary: [{ label: "seed", value: "42" }]
  }, {
    id: "result",
    label: "Result",
    type: "output",
    category: "output",
    inputs: [{ id: "in", label: "Input", type: "color" }],
    outputs: []
  }],
  edges: [{
    id: "source-to-result",
    type: "color",
    from: { nodeId: "source", port: "out" },
    to: { nodeId: "result", port: "in" }
  }]
};
```

## Editor

```js
import { createNodeEditor } from "@echo/node-editor";
import "@echo/node-editor/styles.css";

const editor = createNodeEditor(container, {
  // Prefer lending an existing application device.
  gpuDevice,
  onRendererChange: ({ backend, ready }) => {
    console.log(backend, ready);
  }
});

editor.update(model, {
  positions,
  viewState,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onDeleteNode,
  onDeleteEdge,
  onSelectPort,
  onMoveNode,
  onPositionsChange,
  onViewChange
});
```

The returned editor also provides `autoLayout`, `zoomBy`, `resetView`,
`getPositions`, `getView`, `getPreviewTargets`, `setPreviewStates`, `stats`,
and `destroy`. Preview canvases are deliberately renderer-agnostic: hosts
receive the live canvas targets, paint them with their own GPU/runtime, and
report `ready`, `loading`, `unavailable`, or `error` states. No thumbnail
assets are stored by the framework.

Existing nodes retain their presentation coordinates when edges or domain data
change. Automatic layout is recalculated only for new nodes or when
`autoLayout()` is explicitly requested.

## Rendering boundary

Connections are sampled into triangle geometry and rasterized on a WebGPU
canvas. Vertex buffers grow geometrically and are reused between frames.
Transparent semantic paths and midpoint controls provide generous pointer and
keyboard targets without becoming a second visual renderer.

Node cards remain DOM because text, focus, forms, and accessibility benefit from
browser-native controls. Domain evaluation is not part of this package.

If no `gpuDevice` is supplied, the editor requests a high-performance WebGPU
device. Applications with an existing GPU runtime should lend that device so
the graph and application use separate pipelines on one device.

## Floating panels

```js
import { createPanelLayoutController } from "@echo/node-editor";

const panels = createPanelLayoutController(workspace, {
  storageKey: "my-app.workspace.v1",
  panels: [
    { id: "library", element: libraryPanel },
    { id: "inspector", element: inspectorPanel }
  ]
});
```

Each element needs a descendant marked with `data-panel-drag-handle`.
Panels can be dragged, resized from the lower-right corner, moved with arrow
keys, resized with Shift + arrow keys, and reset with `reset()`.

## Headless utilities

`normalizeNodeEditorModel`, `layoutNodeEditorModel`, `sampleCubicEdge`, and
`hitTestEdges` are independent of the DOM and WebGPU. They are covered by the
package's unit tests and can be reused by alternate host adapters.
