import { describe, expect, it } from "vitest";
import {
    NODE_TYPE_DRAG_MIME,
    hasNodeTypeDragPayload,
    readNodeTypeDragPayload,
    writeNodeTypeDragPayload
} from "./node-drag-payload.js";

function dataTransferStub() {
    const values = new Map();
    return {
        effectAllowed: "all",
        get types() {
            return [...values.keys()];
        },
        getData(type) {
            return values.get(type) ?? "";
        },
        setData(type, value) {
            values.set(type, value);
        }
    };
}

describe("node drag payload", () => {
    it("round trips a validated node type", () => {
        const transfer = dataTransferStub();

        expect(writeNodeTypeDragPayload(
            transfer,
            "directional-noise"
        )).toBe(true);
        expect(transfer.effectAllowed).toBe("copy");
        expect(transfer.types).toContain(NODE_TYPE_DRAG_MIME);
        expect(hasNodeTypeDragPayload(transfer)).toBe(true);
        expect(readNodeTypeDragPayload(transfer))
            .toBe("directional-noise");
    });

    it("rejects malformed and unrelated payloads", () => {
        const transfer = dataTransferStub();

        expect(writeNodeTypeDragPayload(transfer, "../unsafe"))
            .toBe(false);
        expect(hasNodeTypeDragPayload(transfer)).toBe(false);
        expect(readNodeTypeDragPayload(transfer)).toBeNull();
    });
});
