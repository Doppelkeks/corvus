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
`getPositions`, `getView`, `getPreviewTargets`, `setPreviewTextures`, `stats`,
and `destroy`. Hosts can lend node preview `GPUTexture` objects created on the
same device. The graph samples those textures directly, without per-node
canvases, readback, or stored thumbnail assets.

Existing nodes retain their presentation coordinates when edges or domain data
change. Automatic layout is recalculated only for new nodes or when
`autoLayout()` is explicitly requested.

## Rendering boundary

The visible editor is one WebGPU canvas. Grid, anti-aliased connection ribbons,
rounded node cards, ports, bitmap-atlas glyphs, selection, and live previews are
all rendered in that surface. There are no HTML node cards, SVG hit paths, or
per-node preview canvases.

A dedicated module worker performs deterministic layout, scene packing, edge
sampling, and spatial-index construction, then transfers compact typed arrays
to the UI thread. WebGPU compute passes transform and cull node shapes and
tessellate every Bézier connection from live node positions. Pointer hit tests
use the worker-built spatial index, while drag updates touch only one packed
node record. The canvas remains viewport-sized even when graph coordinates are
very large.

The surrounding product may use ordinary HTML for dock panels and forms; those
are application UI, not part of the graph surface. Glyphs come from packed
bitmap data uploaded directly to a GPU texture, so the renderer has no hidden
Canvas2D or DOM fallback.

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

`normalizeNodeEditorModel`, `layoutNodeEditorModel`, `buildGraphScene`,
`sampleCubicEdge`, and `hitTestEdges` are independent of the DOM and WebGPU.
They are covered by package tests and can be reused by alternate host adapters.
Socket anchors and wire endpoints share the same packed graph coordinates, so
zoom and pan cannot introduce endpoint drift.
