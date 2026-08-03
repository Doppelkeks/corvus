function value(value, fallback = "—") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function selectedIds(selection) {
    const source = selection?.selectedNodeIds;
    const ids = source instanceof Set
        ? [...source]
        : Array.isArray(source)
            ? source
            : [];
    if (selection?.selectedNodeId && ids.length === 0) {
        ids.push(selection.selectedNodeId);
    }
    return ids;
}

function portRows(ports) {
    return (ports ?? []).map((port) => Object.freeze({
        label: value(port.label, port.id),
        value: value(port.type, "value")
    }));
}

/** Builds a stable, renderer-independent description of the current selection. */
export function describeNodeInspector(model, selection = {}) {
    const nodes = model?.nodes ?? [];
    const edges = model?.edges ?? [];
    const ids = selectedIds(selection).filter((id) =>
        nodes.some((node) => node.id === id));
    if (ids.length > 1) {
        return Object.freeze({
            kind: "nodes",
            eyebrow: "Selection",
            title: `${ids.length} nodes`,
            rows: Object.freeze([{
                label: "Selected",
                value: ids.join(", ")
            }]),
            sections: Object.freeze([]),
            node: null,
            edge: null
        });
    }
    const edge = edges.find((entry) =>
        entry.id === selection.selectedEdgeId);
    if (edge) {
        const source = nodes.find((node) => node.id === edge.from.nodeId);
        const target = nodes.find((node) => node.id === edge.to.nodeId);
        return Object.freeze({
            kind: "edge",
            eyebrow: "Connection",
            title: `${value(source?.label, edge.from.nodeId)} → ${value(target?.label, edge.to.nodeId)}`,
            rows: Object.freeze([
                { label: "ID", value: edge.id },
                { label: "Type", value: value(edge.type, "value") },
                { label: "From", value: `${edge.from.nodeId}.${edge.from.port}` },
                { label: "To", value: `${edge.to.nodeId}.${edge.to.port}` }
            ]),
            sections: Object.freeze([]),
            node: null,
            edge
        });
    }
    const node = nodes.find((entry) => entry.id === ids[0]);
    if (node) {
        const sections = [];
        if (node.summary?.length) {
            sections.push(Object.freeze({
                title: "Summary",
                rows: Object.freeze(node.summary.map((entry) => Object.freeze({
                    label: value(entry.label),
                    value: value(entry.value)
                })))
            }));
        }
        if (node.inputs?.length) {
            sections.push(Object.freeze({
                title: "Inputs",
                rows: Object.freeze(portRows(node.inputs))
            }));
        }
        if (node.outputs?.length) {
            sections.push(Object.freeze({
                title: "Outputs",
                rows: Object.freeze(portRows(node.outputs))
            }));
        }
        return Object.freeze({
            kind: "node",
            eyebrow: "Node",
            title: value(node.label, node.id),
            rows: Object.freeze([
                { label: "ID", value: node.id },
                { label: "Type", value: value(node.type) },
                { label: "Category", value: value(node.category) }
            ]),
            sections: Object.freeze(sections),
            node,
            edge: null
        });
    }
    return Object.freeze({
        kind: "empty",
        eyebrow: "Inspector",
        title: "Nothing selected",
        rows: Object.freeze([]),
        sections: Object.freeze([]),
        node: null,
        edge: null
    });
}

function element(tag, className = "", text = null) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== null) result.textContent = text;
    return result;
}

function rowsElement(rows) {
    const list = element("dl", "corvus-inspector-rows");
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        list.append(
            element("dt", "", row.label),
            element("dd", "", row.value)
        );
    }
    return list;
}

export class NodeInspector {
    constructor(container, { renderDetails = null } = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError("NodeInspector requires a container");
        }
        this.container = container;
        this.renderDetails = renderDetails;
        this.description = null;
        container.classList.add("corvus-inspector");
    }

    update(model, selection = {}) {
        const description = describeNodeInspector(model, selection);
        const fragment = document.createDocumentFragment();
        const header = element("header", "corvus-inspector-heading");
        header.append(
            element("span", "corvus-inspector-eyebrow", description.eyebrow),
            element("h2", "", description.title)
        );
        fragment.append(header);
        if (description.kind === "empty") {
            fragment.append(element(
                "p",
                "corvus-inspector-empty",
                "Select a node or connection to inspect it."
            ));
        } else {
            fragment.append(rowsElement(description.rows));
            for (let index = 0; index < description.sections.length; index += 1) {
                const sectionDescription = description.sections[index];
                const section = element("section", "corvus-inspector-section");
                section.append(
                    element("h3", "", sectionDescription.title),
                    rowsElement(sectionDescription.rows)
                );
                fragment.append(section);
            }
        }
        const details = this.renderDetails?.(description);
        if (details instanceof Node) fragment.append(details);
        this.container.replaceChildren(fragment);
        this.description = description;
        return description;
    }

    destroy() {
        this.container.classList.remove("corvus-inspector");
        this.container.replaceChildren();
        this.description = null;
    }
}

export function createNodeInspector(container, options) {
    return new NodeInspector(container, options);
}
