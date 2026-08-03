import { describe, expect, it } from "vitest";
import { nodeEditorAccentChannels } from "./node-editor-theme.js";

describe("node editor theme", () => {
    it("normalizes product accents for GPU uniforms", () => {
        expect(nodeEditorAccentChannels("#ff7a1a")).toEqual([
            1,
            0x7a / 255,
            0x1a / 255,
            1
        ]);
        expect(nodeEditorAccentChannels("rgb(135, 214, 31)")).toEqual([
            135 / 255,
            214 / 255,
            31 / 255,
            1
        ]);
    });

    it("uses the shared GenArt accent only as a hostless fallback", () => {
        expect(nodeEditorAccentChannels("var(--color-accent)")).toEqual([
            0x87 / 255,
            0xd6 / 255,
            0x1f / 255,
            1
        ]);
        expect(nodeEditorAccentChannels("var(--accent)")).toEqual([
            0x87 / 255,
            0xd6 / 255,
            0x1f / 255,
            1
        ]);
    });
});
