import { describe, expect, it } from "vitest";
import {
    DOCK_DROP_TARGETS,
    dockDropTargetAt
} from "./dock-drop-overlay.js";

describe("dock drop overlay", () => {
    it("uses one visual target for every supported placement", () => {
        expect(DOCK_DROP_TARGETS.map(({ mode }) => mode)).toEqual([
            "left",
            "right",
            "bottom",
            "float"
        ]);
    });

    it("resolves pointer positions against concrete docking zones", () => {
        const zones = [{
            mode: "left",
            rect: { left: 0, right: 200, top: 0, bottom: 700 }
        }, {
            mode: "float",
            rect: { left: 300, right: 600, top: 200, bottom: 500 }
        }];

        expect(dockDropTargetAt(zones, 80, 400)).toBe("left");
        expect(dockDropTargetAt(zones, 420, 300)).toBe("float");
        expect(dockDropTargetAt(zones, 900, 300)).toBeNull();
    });
});
