export const NODE_TYPE_DRAG_MIME =
    "application/x-node-editor-node-type";

const NODE_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function isNodeTypeDragPayload(value) {
    return typeof value === "string" && NODE_TYPE_PATTERN.test(value);
}

export function hasNodeTypeDragPayload(dataTransfer) {
    return Array.from(dataTransfer?.types ?? [])
        .includes(NODE_TYPE_DRAG_MIME);
}

export function writeNodeTypeDragPayload(dataTransfer, nodeTypeId) {
    if (!dataTransfer || !isNodeTypeDragPayload(nodeTypeId)) return false;
    dataTransfer.effectAllowed = "copy";
    dataTransfer.setData(NODE_TYPE_DRAG_MIME, nodeTypeId);
    return true;
}

export function readNodeTypeDragPayload(dataTransfer) {
    if (!dataTransfer || !hasNodeTypeDragPayload(dataTransfer)) return null;
    const nodeTypeId = dataTransfer.getData(NODE_TYPE_DRAG_MIME);
    return isNodeTypeDragPayload(nodeTypeId) ? nodeTypeId : null;
}
