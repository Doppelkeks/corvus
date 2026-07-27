const MODES = Object.freeze(["float", "left", "right", "bottom"]);

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

function normalizeMode(value, fallback = "float") {
    return MODES.includes(value) ? value : fallback;
}

export function normalizeDockLayout(definitions, saved = {}) {
    const savedPanels = saved?.panels ?? {};
    const panels = Object.fromEntries(definitions.map((definition) => {
        const fallbackMode = normalizeMode(definition.defaultDock);
        const stored = savedPanels[definition.id] ?? {};
        return [definition.id, {
            mode: normalizeMode(stored.mode, fallbackMode),
            rect: finiteRect(stored.rect)
                ? { ...stored.rect }
                : finiteRect(definition.floatRect)
                    ? { ...definition.floatRect }
                    : null
        }];
    }));
    const active = Object.fromEntries(
        ["left", "right", "bottom"].map((dock) => {
            const candidates = definitions.filter((definition) =>
                panels[definition.id].mode === dock);
            const savedId = saved?.active?.[dock];
            return [
                dock,
                candidates.some((entry) => entry.id === savedId)
                    ? savedId
                    : candidates[0]?.id ?? null
            ];
        })
    );
    return Object.freeze({
        version: 1,
        panels: Object.freeze(panels),
        active: Object.freeze(active)
    });
}

function readSaved(storageKey) {
    if (!storageKey) return {};
    try {
        return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
        return {};
    }
}

export class DockLayoutController {
    constructor(container, {
        panels = [],
        storageKey = "",
        onChange = null
    } = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError("DockLayoutController requires a container");
        }
        this.container = container;
        this.storageKey = storageKey;
        this.onChange = onChange;
        this.definitions = panels;
        this.entries = new Map();
        this.docks = new Map();
        this.zIndex = 30;
        this.state = normalizeDockLayout(panels, readSaved(storageKey));
        this.defaultState = normalizeDockLayout(panels);
        this.active = { ...this.state.active };
        this.container.classList.add("node-dock-workspace");
        container.querySelectorAll("[data-dock-id]").forEach((element) => {
            const id = element.dataset.dockId;
            const tabs = element.querySelector("[data-dock-tabs]");
            const content = element.querySelector("[data-dock-content]");
            if (MODES.includes(id) && id !== "float" && tabs && content) {
                this.docks.set(id, { id, element, tabs, content });
            }
        });
        panels.forEach((definition) => this.#add(definition));
        this.#renderAllDocks();
        this.resizeObserver = new ResizeObserver(() => this.#clampFloats());
        this.resizeObserver.observe(container);
    }

    #add(definition) {
        const {
            id,
            element,
            handle = element?.querySelector("[data-panel-drag-handle]"),
            label = id,
            minWidth = 220,
            minHeight = 180
        } = definition;
        if (!id || !(element instanceof Element) || !(handle instanceof Element)) {
            throw new Error("Dock panel definitions require id, element, and drag handle");
        }
        const originalParent = element.parentElement;
        const selector = document.createElement("select");
        selector.className = "node-dock-location";
        selector.setAttribute("aria-label", `${label} panel location`);
        [
            ["left", "Dock left"],
            ["right", "Dock right"],
            ["bottom", "Dock bottom"],
            ["float", "Float panel"]
        ].forEach(([value, text]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            selector.append(option);
        });
        handle.append(selector);
        const resizeHandle = document.createElement("button");
        resizeHandle.type = "button";
        resizeHandle.className = "node-workspace-resize-handle";
        resizeHandle.setAttribute("aria-label", `Resize ${label} panel`);
        element.append(resizeHandle);
        element.classList.add("node-workspace-panel");
        element.dataset.panelId = id;
        const stored = this.state.panels[id];
        const entry = {
            id,
            label,
            element,
            handle,
            selector,
            resizeHandle,
            originalParent,
            minWidth,
            minHeight,
            mode: stored.mode,
            rect: stored.rect,
            cleanup: []
        };
        this.entries.set(id, entry);
        const selectMode = () => this.setMode(id, selector.value);
        const beginMove = (event) => this.#beginPointerDrag(event, entry, "move");
        const beginResize = (event) =>
            this.#beginPointerDrag(event, entry, "resize");
        const focus = () => this.bringToFront(id);
        const keydown = (event) => this.#handleKeydown(event, entry);
        const toggleFloat = (event) => {
            if (!event.target.closest("select, button, input, a")) {
                this.setMode(id, entry.mode === "float"
                    ? normalizeMode(definition.defaultDock, "right")
                    : "float");
            }
        };
        selector.addEventListener("change", selectMode);
        handle.addEventListener("pointerdown", beginMove);
        handle.addEventListener("dblclick", toggleFloat);
        handle.addEventListener("keydown", keydown);
        resizeHandle.addEventListener("pointerdown", beginResize);
        element.addEventListener("pointerdown", focus);
        entry.cleanup.push(
            () => selector.removeEventListener("change", selectMode),
            () => handle.removeEventListener("pointerdown", beginMove),
            () => handle.removeEventListener("dblclick", toggleFloat),
            () => handle.removeEventListener("keydown", keydown),
            () => resizeHandle.removeEventListener("pointerdown", beginResize),
            () => element.removeEventListener("pointerdown", focus)
        );
        this.#place(entry, { persist: false });
    }

    #handleKeydown(event, entry) {
        if (entry.mode !== "float") return;
        const directions = {
            ArrowLeft: [-16, 0],
            ArrowRight: [16, 0],
            ArrowUp: [0, -16],
            ArrowDown: [0, 16]
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const current = entry.rect ?? this.#defaultRect(entry);
        entry.rect = event.shiftKey
            ? {
                ...current,
                width: current.width + direction[0],
                height: current.height + direction[1]
            }
            : {
                ...current,
                x: current.x + direction[0],
                y: current.y + direction[1]
            };
        this.#applyFloatRect(entry);
        this.#persist();
    }

    #defaultRect(entry) {
        const width = Math.min(
            Math.max(entry.minWidth, 320),
            Math.max(entry.minWidth, this.container.clientWidth - 24)
        );
        const height = Math.min(
            Math.max(entry.minHeight, 420),
            Math.max(entry.minHeight, this.container.clientHeight - 24)
        );
        return {
            x: Math.max(12, this.container.clientWidth - width - 12),
            y: 56,
            width,
            height
        };
    }

    #applyFloatRect(entry) {
        const source = finiteRect(entry.rect)
            ? entry.rect
            : this.#defaultRect(entry);
        const width = clamp(
            source.width,
            entry.minWidth,
            Math.max(entry.minWidth, this.container.clientWidth - 12)
        );
        const height = clamp(
            source.height,
            entry.minHeight,
            Math.max(entry.minHeight, this.container.clientHeight - 12)
        );
        const rect = {
            x: clamp(
                source.x,
                0,
                Math.max(0, this.container.clientWidth - width)
            ),
            y: clamp(
                source.y,
                0,
                Math.max(0, this.container.clientHeight - height)
            ),
            width,
            height
        };
        entry.rect = rect;
        Object.assign(entry.element.style, {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            right: "auto",
            bottom: "auto",
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });
    }

    #place(entry, { persist = true } = {}) {
        entry.selector.value = entry.mode;
        entry.element.classList.toggle(
            "node-workspace-panel-floating",
            entry.mode === "float"
        );
        entry.element.classList.toggle(
            "node-workspace-panel-docked",
            entry.mode !== "float"
        );
        if (entry.mode === "float") {
            this.container.append(entry.element);
            entry.element.hidden = false;
            this.#applyFloatRect(entry);
            this.bringToFront(entry.id);
        } else {
            const dock = this.docks.get(entry.mode);
            if (!dock) {
                entry.mode = "float";
                this.#place(entry, { persist });
                return;
            }
            dock.content.append(entry.element);
            Object.assign(entry.element.style, {
                left: "",
                top: "",
                right: "",
                bottom: "",
                width: "",
                height: "",
                zIndex: ""
            });
            if (!this.active[entry.mode]) this.active[entry.mode] = entry.id;
        }
        this.#renderAllDocks();
        if (persist) this.#persist();
    }

    #renderAllDocks() {
        for (const dock of this.docks.values()) {
            const entries = [...this.entries.values()].filter((entry) =>
                entry.mode === dock.id);
            dock.element.hidden = entries.length === 0;
            dock.tabs.replaceChildren();
            if (entries.length === 0) continue;
            if (!entries.some((entry) => entry.id === this.active[dock.id])) {
                this.active[dock.id] = entries[0].id;
            }
            for (const entry of entries) {
                const active = entry.id === this.active[dock.id];
                entry.element.hidden = !active;
                const tab = document.createElement("button");
                tab.type = "button";
                tab.className = "node-dock-tab";
                tab.textContent = entry.label;
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-selected", String(active));
                tab.addEventListener("click", () =>
                    this.activate(dock.id, entry.id));
                dock.tabs.append(tab);
            }
        }
    }

    #beginPointerDrag(event, entry, mode) {
        if (entry.mode !== "float" || event.button !== 0) return;
        if (
            event.target.closest("button, input, select, textarea, a")
            && event.target !== entry.resizeHandle
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.bringToFront(entry.id);
        const start = {
            x: event.clientX,
            y: event.clientY,
            rect: { ...(entry.rect ?? this.#defaultRect(entry)) }
        };
        const target = mode === "move" ? entry.handle : entry.resizeHandle;
        target.setPointerCapture(event.pointerId);
        entry.element.classList.add(mode === "move" ? "moving" : "resizing");
        const move = (moveEvent) => {
            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;
            entry.rect = mode === "move"
                ? {
                    ...start.rect,
                    x: start.rect.x + dx,
                    y: start.rect.y + dy
                }
                : {
                    ...start.rect,
                    width: start.rect.width + dx,
                    height: start.rect.height + dy
                };
            this.#applyFloatRect(entry);
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

    #clampFloats() {
        for (const entry of this.entries.values()) {
            if (entry.mode === "float") this.#applyFloatRect(entry);
        }
    }

    #persist() {
        const state = this.getLayout();
        if (this.storageKey) {
            localStorage.setItem(this.storageKey, JSON.stringify(state));
        }
        this.onChange?.(state);
    }

    activate(dockId, panelId) {
        const entry = this.entries.get(panelId);
        if (!entry || entry.mode !== dockId) return;
        this.active[dockId] = panelId;
        this.#renderAllDocks();
        this.#persist();
    }

    setMode(id, mode) {
        const entry = this.entries.get(id);
        const nextMode = normalizeMode(mode);
        if (!entry || nextMode === entry.mode) return;
        entry.mode = nextMode;
        if (nextMode !== "float") this.active[nextMode] = id;
        this.#place(entry);
    }

    bringToFront(id) {
        const entry = this.entries.get(id);
        if (!entry || entry.mode !== "float") return;
        this.zIndex += 1;
        entry.element.style.zIndex = String(this.zIndex);
    }

    getLayout() {
        return Object.freeze({
            version: 1,
            panels: Object.freeze(Object.fromEntries(
                [...this.entries.values()].map((entry) => [entry.id, {
                    mode: entry.mode,
                    rect: finiteRect(entry.rect) ? { ...entry.rect } : null
                }])
            )),
            active: Object.freeze({ ...this.active })
        });
    }

    reset() {
        const state = this.defaultState;
        this.active = { ...state.active };
        for (const entry of this.entries.values()) {
            entry.mode = state.panels[entry.id].mode;
            entry.rect = state.panels[entry.id].rect;
            this.#place(entry, { persist: false });
        }
        this.#renderAllDocks();
        this.#persist();
    }

    destroy() {
        this.resizeObserver.disconnect();
        for (const entry of this.entries.values()) {
            entry.cleanup.forEach((cleanup) => cleanup());
            entry.selector.remove();
            entry.resizeHandle.remove();
            entry.originalParent?.append(entry.element);
            entry.element.hidden = false;
            entry.element.classList.remove(
                "node-workspace-panel",
                "node-workspace-panel-floating",
                "node-workspace-panel-docked"
            );
        }
        this.entries.clear();
        this.container.classList.remove("node-dock-workspace");
    }
}

export function createDockLayoutController(container, options) {
    return new DockLayoutController(container, options);
}
