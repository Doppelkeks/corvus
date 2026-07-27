const DEFAULT_LIMIT = 96;
const DEFAULT_COALESCE_WINDOW_MS = 650;

function boundedLimit(value) {
    return Number.isInteger(value) && value >= 2
        ? value
        : DEFAULT_LIMIT;
}

function normalizedOptions(value, now) {
    if (
        value === null
        || value === undefined
        || typeof value !== "object"
        || Array.isArray(value)
    ) {
        return {
            revision: value,
            label: "",
            coalesceKey: null,
            timestamp: now
        };
    }
    return {
        revision: value.revision,
        label: typeof value.label === "string" ? value.label : "",
        coalesceKey: typeof value.coalesceKey === "string"
            ? value.coalesceKey
            : null,
        timestamp: Number.isFinite(value.timestamp)
            ? value.timestamp
            : now
    };
}

/**
 * Bounded, use-case-agnostic state history for node-editor hosts.
 *
 * Hosts own snapshot cloning and restoration. A coalesce key groups rapid
 * updates such as slider input into one semantic undo step.
 */
export class HistoryStack {
    constructor({
        limit = DEFAULT_LIMIT,
        coalesceWindowMs = DEFAULT_COALESCE_WINDOW_MS,
        clock = () => performance.now()
    } = {}) {
        this.limit = boundedLimit(limit);
        this.coalesceWindowMs = Math.max(0, Number(coalesceWindowMs) || 0);
        this.clock = clock;
        this.entries = [];
        this.index = -1;
        this.listeners = new Set();
    }

    get canUndo() {
        return this.index > 0;
    }

    get canRedo() {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }

    get undoLabel() {
        return this.canUndo ? this.entries[this.index]?.label ?? "" : "";
    }

    get redoLabel() {
        return this.canRedo ? this.entries[this.index + 1]?.label ?? "" : "";
    }

    get length() {
        return this.entries.length;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    state() {
        return Object.freeze({
            canUndo: this.canUndo,
            canRedo: this.canRedo,
            undoLabel: this.undoLabel,
            redoLabel: this.redoLabel,
            length: this.length,
            index: this.index
        });
    }

    reset(state, options = {}) {
        const metadata = normalizedOptions(options, this.clock());
        this.entries = [{ state, ...metadata, coalesceKey: null }];
        this.index = 0;
        this.#notify();
    }

    commit(state, options = {}) {
        const metadata = normalizedOptions(options, this.clock());
        const current = this.entries[this.index];
        if (
            metadata.revision !== undefined
            && metadata.revision !== null
            && current?.revision === metadata.revision
        ) {
            return false;
        }

        this.entries.splice(this.index + 1);
        const canCoalesce = Boolean(
            metadata.coalesceKey
            && current?.coalesceKey === metadata.coalesceKey
            && metadata.timestamp - current.timestamp
                <= this.coalesceWindowMs
        );
        const entry = { state, ...metadata };
        if (canCoalesce) {
            this.entries[this.index] = entry;
        } else {
            this.entries.push(entry);
            if (this.entries.length > this.limit) {
                this.entries.splice(0, this.entries.length - this.limit);
            }
            this.index = this.entries.length - 1;
        }
        this.#notify();
        return true;
    }

    undoEntry() {
        if (!this.canUndo) return null;
        this.index -= 1;
        this.#breakCoalescing();
        this.#notify();
        return this.entries[this.index];
    }

    redoEntry() {
        if (!this.canRedo) return null;
        this.index += 1;
        this.#breakCoalescing();
        this.#notify();
        return this.entries[this.index];
    }

    undo() {
        return this.undoEntry()?.state ?? null;
    }

    redo() {
        return this.redoEntry()?.state ?? null;
    }

    #breakCoalescing() {
        const current = this.entries[this.index];
        if (current) current.coalesceKey = null;
    }

    #notify() {
        const state = this.state();
        this.listeners.forEach((listener) => listener(state));
    }
}
