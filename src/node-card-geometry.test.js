import { describe, expect, it } from "vitest";
import {
    NODE_CARD_GEOMETRY,
    nodeCardHeight,
    nodePreviewRect
} from "./node-card-geometry.js";

describe("node card geometry", () => {
    it("uses the compact half-width default footprint", () => {
        expect(NODE_CARD_GEOMETRY.nodeWidth).toBe(110);
        expect(NODE_CARD_GEOMETRY.minimumNodeHeight).toBe(48);
        expect(NODE_CARD_GEOMETRY.previewInset).toBe(4);
    });

    it("keeps square previews and their complete node compact", () => {
        const node = {
            inputs: [],
            outputs: [],
            preview: { aspectRatio: 1 }
        };
        const preview = nodePreviewRect(
            node,
            NODE_CARD_GEOMETRY.nodeWidth
        );

        expect(preview).toMatchObject({
            width: 102,
            height: 102
        });
        expect(nodeCardHeight(
            node,
            NODE_CARD_GEOMETRY.nodeWidth
        )).toBe(132);
    });
});
