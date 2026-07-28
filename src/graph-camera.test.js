import { describe, expect, it } from "vitest";
import {
    graphWheelDeltaPixels,
    normalizeGraphView,
    screenToGraphPoint,
    zoomGraphViewAt,
    zoomGraphViewFromWheel
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

    it("zooms from an unmodified wheel around the pointer", () => {
        const view = {
            zoom: 1,
            scrollLeft: -320,
            scrollTop: 180
        };
        const anchor = { x: 240, y: 160 };
        const graphPoint = screenToGraphPoint(view, anchor);
        const zoomedIn = zoomGraphViewFromWheel(
            view,
            { deltaY: -120, deltaMode: 0 },
            anchor,
            600
        );
        const zoomedOut = zoomGraphViewFromWheel(
            view,
            { deltaY: 120, deltaMode: 0 },
            anchor,
            600
        );

        expect(zoomedIn.zoom).toBeGreaterThan(view.zoom);
        expect(zoomedOut.zoom).toBeLessThan(view.zoom);
        expect(screenToGraphPoint(zoomedIn, anchor).x)
            .toBeCloseTo(graphPoint.x);
        expect(screenToGraphPoint(zoomedIn, anchor).y)
            .toBeCloseTo(graphPoint.y);
    });

    it("normalizes wheel line and page deltas", () => {
        expect(graphWheelDeltaPixels({
            deltaY: 3,
            deltaMode: 1
        }, 600)).toBe(48);
        expect(graphWheelDeltaPixels({
            deltaY: 1,
            deltaMode: 2
        }, 600)).toBe(600);
    });
});
