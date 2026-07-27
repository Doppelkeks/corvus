import { describe, expect, it } from "vitest";
import {
    connectionForPorts,
    portsCanConnect
} from "./port-connection.js";

const output = {
    nodeId: "source",
    port: "out",
    direction: "output",
    type: "color"
};
const input = {
    nodeId: "target",
    port: "in",
    direction: "input",
    type: "grayscale"
};

describe("port connections", () => {
    it("normalizes connections regardless of drag direction", () => {
        expect(connectionForPorts(input, output)).toEqual({
            from: output,
            to: input
        });
    });

    it("rejects equal directions and self connections", () => {
        expect(portsCanConnect(output, { ...input, direction: "output" }))
            .toBe(false);
        expect(portsCanConnect(output, { ...input, nodeId: "source" }))
            .toBe(false);
    });
});
