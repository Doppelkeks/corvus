import { describe, expect, it } from "vitest";
import {
    normalizeGraphView,
    screenToGraphPoint,
    zoomGraphViewAt
} from "./graph-camera.js";

describe("unbounded graph camera", () => {
    it("preserves signed offsets in every direction", () => {
        expect(normalizeGraphView(null)).toEqual({
            zoom: 1,
            scrollLeft: 0,
            scrollTop: 0
        });
        expect(normalizeGraphView({
            zoom: 1,
            scrollLeft: -250_000,
            scrollTop: -125_000
        })).toEqual({
            zoom: 1,
            scrollLeft: -250_000,
            scrollTop: -125_000
        });
        expect(normalizeGraphView({
            zoom: 1,
            scrollLeft: 250_000,
            scrollTop: 125_000
        })).toEqual({
            zoom: 1,
            scrollLeft: 250_000,
            scrollTop: 125_000
        });
    });

    it("keeps screen-to-graph conversion correct across negative space", () => {
        expect(screenToGraphPoint(
            { zoom: 2, scrollLeft: -800, scrollTop: -400 },
            { x: 200, y: 100 }
        )).toEqual({ x: -300, y: -150 });
    });

    it("keeps the graph point beneath the cursor fixed while zooming", () => {
        const view = {
            zoom: 1,
            scrollLeft: -640,
            scrollTop: 360
        };
        const anchor = { x: 320, y: 180 };
        const graphPoint = screenToGraphPoint(view, anchor);
        const zoomed = zoomGraphViewAt(view, 1.8, anchor);

        expect(screenToGraphPoint(zoomed, anchor)).toEqual(graphPoint);
        expect(zoomed.scrollLeft).toBeLessThan(0);
    });
});
