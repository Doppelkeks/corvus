import { describe, expect, it } from "vitest";
import {
    DockLayoutController,
    normalizeDockLayout
} from "./dock-layout.js";

const panels = [
    { id: "catalog", defaultDock: "left" },
    { id: "inspector", defaultDock: "right" },
    { id: "preview", defaultDock: "right" }
];

describe("normalizeDockLayout", () => {
    it("creates deterministic dock tabs from panel defaults", () => {
        const result = normalizeDockLayout(panels);

        expect(result.panels.catalog.mode).toBe("left");
        expect(result.panels.preview.mode).toBe("right");
        expect(result.active).toEqual({
            left: "catalog",
            right: "inspector",
            bottom: null
        });
    });

    it("restores valid modes and active tabs while rejecting stale state", () => {
        const result = normalizeDockLayout(panels, {
            panels: {
                catalog: {
                    mode: "float",
                    rect: { x: 20, y: 30, width: 280, height: 400 }
                },
                inspector: { mode: "unknown" },
                preview: { mode: "bottom" }
            },
            active: {
                right: "missing",
                bottom: "preview"
            }
        });

        expect(result.panels.catalog).toEqual({
            mode: "float",
            rect: { x: 20, y: 30, width: 280, height: 400 }
        });
        expect(result.panels.inspector.mode).toBe("right");
        expect(result.active.bottom).toBe("preview");
        expect(result.active.right).toBe("inspector");
    });

    it("exposes a shared panel focus operation for selection-driven tools", () => {
        expect(typeof DockLayoutController.prototype.focusPanel)
            .toBe("function");
    });
});
