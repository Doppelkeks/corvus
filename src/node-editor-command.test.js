import { describe, expect, it } from "vitest";
import { nodeEditorCommandForKey } from "./node-editor-command.js";

function shortcut(key, overrides = {}) {
    return {
        key,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
        ...overrides
    };
}

describe("node editor commands", () => {
    it.each([
        ["c", "copy"],
        ["d", "duplicate"]
    ])("maps Ctrl+%s when nodes are selected", (key, command) => {
        expect(nodeEditorCommandForKey(shortcut(key), {
            hasSelection: true
        })).toBe(command);
    });

    it("maps paste without requiring a selection", () => {
        expect(nodeEditorCommandForKey(shortcut("v"))).toBe("paste");
    });

    it("supports Command and leaves modified shortcuts untouched", () => {
        expect(nodeEditorCommandForKey(shortcut("C", {
            ctrlKey: false,
            metaKey: true
        }), { hasSelection: true })).toBe("copy");
        expect(nodeEditorCommandForKey(shortcut("d", {
            shiftKey: true
        }), { hasSelection: true })).toBeNull();
        expect(nodeEditorCommandForKey(shortcut("c"))).toBeNull();
    });
});
