import { describe, expect, it } from "vitest";
import {
    closestCompatiblePort,
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

    it("selects the nearest compatible port inside the snap radius", () => {
        const source = { nodeId: "source", port: "out", direction: "output" };
        const nodes = [{
            id: "source",
            x: 0,
            y: 0,
            ports: [{ id: "out", direction: "output", x: 100, y: 20 }]
        }, {
            id: "near",
            x: 180,
            y: 20,
            ports: [{ id: "in", direction: "input", x: 0, y: 30 }]
        }, {
            id: "far",
            x: 260,
            y: 20,
            ports: [{ id: "in", direction: "input", x: 0, y: 30 }]
        }];

        const match = closestCompatiblePort(nodes, { x: 205, y: 52 }, source, 72);

        expect(match.node.id).toBe("near");
        expect(match.port.id).toBe("in");
        expect(match.point).toEqual({ x: 180, y: 50 });
        expect(closestCompatiblePort(nodes, { x: 400, y: 50 }, source, 40)).toBeNull();
    });
});
