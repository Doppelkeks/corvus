import { describe, expect, it } from "vitest";
import {
    createGraphComment,
    createGraphCommentSection,
    moveGraphAnnotation,
    nodesContainedByCommentSection,
    normalizeGraphAnnotations,
    resizeGraphAnnotation
} from "./graph-annotations.js";

describe("graph annotations", () => {
    it("normalizes portable comments and comment sections", () => {
        const annotations = normalizeGraphAnnotations([{
            id: "note",
            text: "Check the edge wear",
            x: 12,
            y: 18
        }, {
            id: "group",
            kind: "section",
            title: "Surface",
            color: "#F26A21",
            width: 420,
            height: 260
        }]);

        expect(annotations[0]).toMatchObject({
            id: "note",
            kind: "comment",
            width: 240,
            height: 92
        });
        expect(annotations[1]).toMatchObject({
            id: "group",
            kind: "section",
            color: "#f26a21",
            width: 420,
            height: 260
        });
    });

    it("rejects duplicate ids so selection remains unambiguous", () => {
        expect(() => normalizeGraphAnnotations([
            { id: "same" },
            { id: "same", kind: "section" }
        ])).toThrow(/Duplicate annotation id/);
    });

    it("captures only fully enclosed nodes when a section starts moving", () => {
        const section = createGraphCommentSection({
            id: "section",
            x: 100,
            y: 100,
            width: 400,
            height: 300
        });
        const contained = nodesContainedByCommentSection(section, [{
            id: "inside",
            x: 130,
            y: 150,
            width: 180,
            height: 100
        }, {
            id: "crosses-edge",
            x: 440,
            y: 180,
            width: 100,
            height: 100
        }, {
            id: "outside",
            x: -200,
            y: -100,
            width: 180,
            height: 100
        }]);

        expect(contained).toEqual(["inside"]);
    });

    it("moves annotations and preserves minimum resize geometry", () => {
        const comment = createGraphComment({
            id: "comment",
            x: 10,
            y: 20
        });
        expect(moveGraphAnnotation(comment, { x: 15, y: -5 }))
            .toMatchObject({ x: 25, y: 15 });

        const resized = resizeGraphAnnotation(comment, {
            left: 10,
            top: 20,
            right: 30,
            bottom: 40
        });
        expect(resized.width).toBe(160);
        expect(resized.height).toBe(64);
    });
});
