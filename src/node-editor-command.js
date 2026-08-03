const COMMAND_KEYS = Object.freeze({
    c: "copy",
    d: "duplicate",
    v: "paste"
});

/**
 * Resolves graph-editing shortcuts without coupling the WebGPU interaction
 * surface to a particular domain or application model.
 */
export function nodeEditorCommandForKey(event, {
    hasSelection = false
} = {}) {
    if (
        event.defaultPrevented
        || event.altKey
        || event.shiftKey
        || (!event.ctrlKey && !event.metaKey)
    ) {
        return null;
    }
    const command = COMMAND_KEYS[event.key.toLowerCase()] ?? null;
    if (["copy", "duplicate"].includes(command) && !hasSelection) {
        return null;
    }
    return command;
}
