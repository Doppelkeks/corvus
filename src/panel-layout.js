function finiteRect(value) {
    return Boolean(
        value
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
        && Number.isFinite(value.width)
        && Number.isFinite(value.height)
    );
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export class PanelLayoutController {
    constructor(container, {
        panels = [],
        storageKey = "",
        onChange = null
    } = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError("PanelLayoutController requires a container");
        }
        this.container = container;
        this.storageKey = storageKey;
        this.onChange = onChange;
        this.entries = new Map();
        this.zIndex = 10;
        this.saved = this.#readSaved();
        panels.forEach((definition) => this.add(definition));
        this.resizeObserver = new ResizeObserver(() => this.clampAll());
        this.resizeObserver.observe(container);
    }

    #readSaved() {
        if (!this.storageKey) return {};
        try {
            return JSON.parse(localStorage.getItem(this.storageKey) ?? "{}");
        } catch {
            return {};
        }
    }

    #persist() {
        if (this.storageKey) {
            localStorage.setItem(
                this.storageKey,
                JSON.stringify(this.getLayout())
            );
        }
        this.onChange?.(this.getLayout());
    }

    add({
        id,
        element,
        handle = element?.querySelector("[data-panel-drag-handle]"),
        minWidth = 200,
        minHeight = 160
    }) {
        if (!id || !(element instanceof Element) || !(handle instanceof Element)) {
            throw new Error("Panel definitions require id, element, and drag handle");
        }
        element.classList.add("node-workspace-panel");
        element.dataset.panelId = id;
        const resizeHandle = document.createElement("button");
        resizeHandle.type = "button";
        resizeHandle.className = "node-workspace-resize-handle";
        resizeHandle.setAttribute("aria-label", `Resize ${id} panel`);
        element.append(resizeHandle);
        const entry = {
            id,
            element,
            handle,
            resizeHandle,
            minWidth,
            minHeight,
            initial: null,
            cleanup: []
        };
        this.entries.set(id, entry);
        requestAnimationFrame(() => {
            const bounds = this.container.getBoundingClientRect();
            const panelBounds = element.getBoundingClientRect();
            entry.initial = {
                x: panelBounds.left - bounds.left,
                y: panelBounds.top - bounds.top,
                width: panelBounds.width,
                height: panelBounds.height
            };
            this.setRect(
                id,
                finiteRect(this.saved[id]) ? this.saved[id] : entry.initial,
                { persist: false }
            );
        });
        const beginMove = (event) => this.#beginPointerDrag(event, entry, "move");
        const beginResize = (event) => this.#beginPointerDrag(event, entry, "resize");
        const focus = () => this.bringToFront(id);
        handle.addEventListener("pointerdown", beginMove);
        handle.addEventListener("dblclick", () => this.reset(id));
        resizeHandle.addEventListener("pointerdown", beginResize);
        element.addEventListener("pointerdown", focus);
        entry.cleanup.push(
            () => handle.removeEventListener("pointerdown", beginMove),
            () => resizeHandle.removeEventListener("pointerdown", beginResize),
            () => element.removeEventListener("pointerdown", focus)
        );
        return this;
    }

    #beginPointerDrag(event, entry, mode) {
        if (event.button !== 0) return;
        if (event.target.closest("button, input, select, textarea, a")
            && event.target !== entry.resizeHandle) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.bringToFront(entry.id);
        const start = {
            x: event.clientX,
            y: event.clientY,
            rect: this.rect(entry.id)
        };
        const target = mode === "move" ? entry.handle : entry.resizeHandle;
        target.setPointerCapture(event.pointerId);
        entry.element.classList.add(mode === "move" ? "moving" : "resizing");
        const move = (moveEvent) => {
            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;
            const next = mode === "move"
                ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
                : {
                    ...start.rect,
                    width: start.rect.width + dx,
                    height: start.rect.height + dy
                };
            this.setRect(entry.id, next, { persist: false });
        };
        const finish = (upEvent) => {
            if (target.hasPointerCapture(upEvent.pointerId)) {
                target.releasePointerCapture(upEvent.pointerId);
            }
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", finish);
            target.removeEventListener("pointercancel", finish);
            entry.element.classList.remove("moving", "resizing");
            this.#persist();
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", finish);
        target.addEventListener("pointercancel", finish);
    }

    bringToFront(id) {
        const entry = this.entries.get(id);
        if (!entry) return;
        this.zIndex += 1;
        entry.element.style.zIndex = String(this.zIndex);
    }

    rect(id) {
        const entry = this.entries.get(id);
        if (!entry) return null;
        return {
            x: Number.parseFloat(entry.element.style.left) || 0,
            y: Number.parseFloat(entry.element.style.top) || 0,
            width: Number.parseFloat(entry.element.style.width)
                || entry.element.offsetWidth,
            height: Number.parseFloat(entry.element.style.height)
                || entry.element.offsetHeight
        };
    }

    setRect(id, rect, { persist = true } = {}) {
        const entry = this.entries.get(id);
        if (!entry || !finiteRect(rect)) return;
        const width = clamp(
            rect.width,
            entry.minWidth,
            Math.max(entry.minWidth, this.container.clientWidth - 12)
        );
        const height = clamp(
            rect.height,
            entry.minHeight,
            Math.max(entry.minHeight, this.container.clientHeight - 12)
        );
        const x = clamp(rect.x, 0, Math.max(0, this.container.clientWidth - width));
        const y = clamp(rect.y, 0, Math.max(0, this.container.clientHeight - height));
        Object.assign(entry.element.style, {
            left: `${x}px`,
            top: `${y}px`,
            right: "auto",
            bottom: "auto",
            width: `${width}px`,
            height: `${height}px`
        });
        if (persist) this.#persist();
    }

    clampAll() {
        for (const id of this.entries.keys()) {
            this.setRect(id, this.rect(id), { persist: false });
        }
    }

    getLayout() {
        return Object.freeze(Object.fromEntries(
            [...this.entries.keys()].map((id) => [id, this.rect(id)])
        ));
    }

    reset(id = null) {
        const entries = id
            ? [this.entries.get(id)].filter(Boolean)
            : [...this.entries.values()];
        entries.forEach((entry) => {
            if (entry.initial) {
                this.setRect(entry.id, entry.initial, { persist: false });
            }
        });
        this.#persist();
    }

    destroy() {
        this.resizeObserver.disconnect();
        for (const entry of this.entries.values()) {
            entry.cleanup.forEach((cleanup) => cleanup());
            entry.resizeHandle.remove();
        }
        this.entries.clear();
    }
}

export function createPanelLayoutController(container, options) {
    return new PanelLayoutController(container, options);
}
