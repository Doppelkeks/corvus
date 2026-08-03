# Corvus

Corvus is a high-performance, WebGPU-accelerated node editor for browser
applications. It renders the graph, labels, ports, connections, selection, and
live previews in one GPU canvas while keeping state ownership in your
application.

Corvus is open source and developed by [Raykast](https://raykast.com/).

## Highlights

- One viewport-sized WebGPU canvas, even when graph coordinates are very large.
- GPU-rendered cards, text, ports, connection ribbons, selection, and previews.
- Deterministic layout and scene packing in a dedicated module worker.
- Spatially indexed pointer hit testing and compact typed-array scene data.
- Direct sampling of host-provided `GPUTexture` previews without readback.
- Application-owned state through a small model and callback boundary.
- Dockable workspace panels and reusable headless graph utilities.
- A complete scoped theme with ProFont and no runtime dependencies.

## Requirements

- A browser with WebGPU support.
- Node.js 20 or newer for local development.

## Run the complete example

The repository includes a working example with node creation, automatic
layout, viewport reset, node movement, port connections, selection, and
keyboard deletion.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The complete host implementation is in
[`demo/main.js`](demo/main.js), with its page in [`index.html`](index.html).

## Install

```sh
pnpm add @raykast/corvus
```

Import the editor and its complete default theme:

```js
import { createNodeEditor } from "@raykast/corvus";
import "@raykast/corvus/styles.css";
```

Give the host element an explicit size:

```css
#editor {
  width: 100%;
  height: 42rem;
}
```

Create a graph and mount Corvus:

```js
const model = {
  id: "request-flow",
  label: "Request flow",
  nodes: [
    {
      id: "request",
      label: "Request",
      type: "source",
      category: "source",
      inputs: [],
      outputs: [{ id: "value", label: "Value", type: "value" }],
      summary: [{ label: "method", value: "GET" }]
    },
    {
      id: "response",
      label: "Response",
      type: "output",
      category: "output",
      terminal: true,
      inputs: [{ id: "input", label: "Input", type: "value" }],
      outputs: [],
      summary: [{ label: "status", value: "200" }]
    }
  ],
  edges: [
    {
      id: "request-to-response",
      type: "value",
      from: { nodeId: "request", port: "value" },
      to: { nodeId: "response", port: "input" }
    }
  ]
};

const editor = createNodeEditor(document.querySelector("#editor"), {
  onRendererChange(status) {
    console.log(`Corvus renderer: ${status.backend}`);
  },
  onError(error) {
    console.error(error);
  }
});

editor.update(model);
```

`editor.update()` accepts positions, annotations, view state, selection state,
and callbacks for connection, movement, deletion, duplication, dropping,
selection, and context actions. The example demonstrates a complete mutable
host around those callbacks.

## Model boundary

Each node has a stable `id`, display `label`, optional category and color,
input/output ports, optional summary rows, and an optional preview descriptor.
Each edge identifies one output and one input by node and port ID. Corvus
normalizes and freezes the model passed to the renderer; your application
retains ownership of its source state.

Existing nodes keep their presentation coordinates when graph data changes.
New nodes receive deterministic positions. Call `autoLayout()` when the whole
graph should be arranged again.

## Editor API

The returned editor provides:

- `update(model, options)`
- `autoLayout()`
- `zoomBy(amount)`
- `resetView()`
- `getPositions()`
- `getView()`
- `getPreviewTargets()`
- `setPreviewTextures(textures)`
- `stats()`
- `destroy()`

Applications with an existing WebGPU runtime can pass `gpuDevice` to
`createNodeEditor()`. Corvus then creates separate pipelines on the same device
and can sample compatible preview textures directly.

## Rendering architecture

The visible editor uses one WebGPU canvas. A module worker performs layout,
scene packing, connection sampling, and spatial-index construction. The UI
thread uploads compact scene data, while compute passes transform and cull node
shapes and tessellate connection curves from live positions.

Glyphs come from a high-resolution ProFont signed-distance atlas uploaded to a
GPU texture. ProFont and the generated atlas are MIT-licensed, with attribution
recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Regenerate the checked-in atlas and fixed-width layout metrics with:

```sh
python -m pip install -r requirements-font.txt
pnpm font:generate
```

## Dockable workspace panels

```js
import { createDockLayoutController } from "@raykast/corvus";

const workspace = createDockLayoutController(workspaceElement, {
  storageKey: "example.workspace.v1",
  panels: [
    {
      id: "library",
      label: "Node library",
      element: libraryPanel,
      defaultDock: "left",
      floatRect: { x: 16, y: 64, width: 360, height: 560 }
    },
    {
      id: "inspector",
      label: "Inspector",
      element: inspectorPanel,
      defaultDock: "right"
    }
  ]
});
```

The workspace supports left, right, and bottom dock regions, floating panels,
pointer and keyboard movement, resizing, persisted layouts, active tabs, and a
visual drop overlay.

## Headless utilities

`normalizeNodeEditorModel`, `layoutNodeEditorModel`, `buildGraphScene`,
`sampleCubicEdge`, and `hitTestEdges` can be used without the DOM or WebGPU.

## Theming

`styles.css` includes the complete default theme and ProFont webfont. Override
the scoped `--node-editor-theme-*` properties to integrate Corvus into a host:

```css
.node-editor {
  --node-editor-theme-background: #07090b;
  --node-editor-theme-surface: #101820;
  --node-editor-theme-text: #f5fbff;
  --node-editor-accent: #ff8a3d;
}
```

## Development

```sh
pnpm install
pnpm check
pnpm dev
```

Corvus is available under the MIT License. Developed by
[Raykast](https://raykast.com/).
