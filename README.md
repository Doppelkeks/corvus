# Corvus

Corvus is a high-performance, WebGPU-accelerated node editor for browser
applications. It renders the graph, labels, ports, connections, selection, and
live previews in one GPU canvas while keeping state ownership in your
application.

Corvus is open source and developed by [Raykast](https://raykast.com/).

## Highlights

- One viewport-sized WebGPU canvas, even when graph coordinates are very large.
- GPU-rendered cards, text, ports, connection ribbons, selection, and previews.
- Stable viewport culling submits only visible shapes, glyphs, previews, and edges.
- Deterministic layout and scene packing in a dedicated module worker.
- Spatially indexed pointer hit testing and compact typed-array scene data.
- Direct sampling of host-provided `GPUTexture` previews without readback.
- Application-owned state through a small model and callback boundary.
- A standard selection inspector that can be docked, floated, or extended.
- Nearest-compatible-port highlighting and connection snapping.
- Dockable workspace panels and reusable headless graph utilities.
- A complete scoped theme with ProFont and no runtime dependencies.

## Requirements

- A browser with WebGPU support.
- Node.js 20 or newer for local development.

## Run the complete example

The repository includes a working example with node creation, automatic
layout, viewport reset, node movement, port connections, nearest-port snapping,
selection inspection, dock/floating panel behavior, and keyboard deletion.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The complete host implementation is in
[`demo/main.js`](demo/main.js), with its page in [`index.html`](index.html).

## Run the stress scene

Open `/stress.html` from the same development server to load a deterministic
5,000-node graph with 5,930 connections and 142,320 potential edge segments.
The page reports generation, preparation, and live visible-work counts while
viewport culling submits only on-screen nodes, text, previews, and connections
to the GPU. Controls can rebuild the scene with 1,000, 5,000, or 10,000 nodes.

The generator is isolated in [`demo/stress-scene.js`](demo/stress-scene.js), so
the large graph is reproducible and does not inflate the normal example.

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

During a connection drag, Corvus searches the nearby spatial-index cells for
the closest compatible port. The GPU preview snaps to that port and highlights
it before the pointer reaches the socket. Set `portSnapRadius` when creating the
editor to change the default 72-pixel attraction distance, or set it to `0` to
disable snapping.

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
scene packing, connection sampling, and spatial-index construction. Each
invalidated frame builds stable compact lists from live viewport bounds, so
off-screen shapes, glyphs, previews, and connections are not submitted. Curves
crossing the viewport remain included even when both endpoint nodes are outside.
Compute passes transform only visible shapes and tessellate only visible curves.

Glyphs come from a high-resolution ProFont signed-distance atlas uploaded to a
GPU texture. ProFont and the generated atlas are MIT-licensed, with attribution
recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Regenerate the checked-in atlas and fixed-width layout metrics with:

```sh
python -m pip install -r requirements-font.txt
pnpm font:generate
```

## Standard inspector

Corvus includes a renderer-independent inspector for nodes, connections, and
multi-node selections. Its default view covers identity, category, summary,
and ports. The optional `renderDetails` hook can append host-specific controls.

```js
import { createNodeInspector } from "@raykast/corvus";

const inspector = createNodeInspector(inspectorElement, {
  renderDetails(description) {
    if (description.kind !== "node") return null;
    const controls = document.createElement("div");
    controls.textContent = `Host controls for ${description.node.id}`;
    return controls;
  }
});

inspector.update(model, {
  selectedNodeId,
  selectedNodeIds,
  selectedEdgeId
});
```

The inspector is an ordinary element, so it can be registered directly with
the dock controller as shown in the runnable example.

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
