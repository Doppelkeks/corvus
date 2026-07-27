import { describe, expect, it, vi } from "vitest";
import { HistoryStack } from "./history-stack.js";

describe("HistoryStack", () => {
    it("moves through committed state and exposes semantic labels", () => {
        const history = new HistoryStack();
        history.reset({ value: 1 });
        history.commit({ value: 2 }, { label: "Add node" });
        history.commit({ value: 3 }, { label: "Connect nodes" });

        expect(history.undoLabel).toBe("Connect nodes");
        expect(history.undo()).toEqual({ value: 2 });
        expect(history.redoLabel).toBe("Connect nodes");
        expect(history.undo()).toEqual({ value: 1 });
        expect(history.canUndo).toBe(false);
        expect(history.redo()).toEqual({ value: 2 });
    });

    it("coalesces rapid updates with the same semantic key", () => {
        let now = 0;
        const history = new HistoryStack({
            coalesceWindowMs: 500,
            clock: () => now
        });
        history.reset({ value: 0 });
        now = 10;
        history.commit({ value: 1 }, {
            label: "Change scale",
            coalesceKey: "param:node:scale"
        });
        now = 200;
        history.commit({ value: 2 }, {
            label: "Change scale",
            coalesceKey: "param:node:scale"
        });

        expect(history.length).toBe(2);
        expect(history.undo()).toEqual({ value: 0 });

        history.redo();
        now = 900;
        history.commit({ value: 3 }, {
            label: "Change scale",
            coalesceKey: "param:node:scale"
        });
        expect(history.length).toBe(3);
    });

    it("truncates redo state and respects the configured bound", () => {
        const history = new HistoryStack({ limit: 3 });
        history.reset(0);
        history.commit(1);
        history.commit(2);
        history.commit(3);
        expect(history.length).toBe(3);
        expect(history.undo()).toBe(2);
        history.commit(4);
        expect(history.canRedo).toBe(false);
        expect(history.undo()).toBe(2);
        expect(history.undo()).toBe(1);
    });

    it("notifies subscribers when availability changes", () => {
        const listener = vi.fn();
        const history = new HistoryStack();
        const unsubscribe = history.subscribe(listener);
        history.reset(0);
        history.commit(1);
        history.undo();
        unsubscribe();
        history.redo();

        expect(listener).toHaveBeenCalledTimes(3);
        expect(listener.mock.calls[1][0]).toMatchObject({
            canUndo: true,
            canRedo: false
        });
    });
});
