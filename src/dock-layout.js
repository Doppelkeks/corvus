import { DockDropOverlay } from "./dock-drop-overlay.js";

const MODES = Object.freeze(["float", "left", "right", "bottom"]);
const DOCKS = Object.freeze(["left", "right", "bottom"]);
const DRAG_THRESHOLD = 5;

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
    const active = Object.fromEntries(DOCKS.map((dock) => {
        const candidates = definitions.filter((definition) =>
            panels[definition.id].mode === dock);
        const savedId = saved?.active?.[dock];
        return [
            dock,
            candidates.some((entry) => entry.id === savedId)
                ? savedId
                : candidates[0]?.id ?? null
        ];
    }));
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
        this.cancelDrag = null;
        this.state = normalizeDockLayout(panels, readSaved(storageKey));
        this.defaultState = normalizeDockLayout(panels);
        this.active = { ...this.state.active };
        this.container.classList.add("node-dock-workspace");
        container.querySelectorAll("[data-dock-id]").forEach((element) => {
            const id = element.dataset.dockId;
            const tabs = element.querySelector("[data-dock-tabs]");
            const content = element.querySelector("[data-dock-content]");
            if (DOCKS.includes(id) && tabs && content) {
                this.docks.set(id, { id, element, tabs, content });
            }
        });
        panels.forEach((definition) => this.#add(definition));
        this.#renderAllDocks();
        this.dropOverlay = new DockDropOverlay(container);
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
            throw new Error(
                "Dock panel definitions require id, element, and drag handle"
            );
        }
        const originalParent = element.parentElement;
        const resizeHandle = document.createElement("button");
        resizeHandle.type = "button";
        resizeHandle.className = "node-workspace-resize-handle";
        resizeHandle.setAttribute("aria-label", `Resize ${label} panel`);
        element.append(resizeHandle);
        element.classList.add("node-workspace-panel");
        element.dataset.panelId = id;
        handle.setAttribute(
            "aria-label",
            `${label} panel. Drag to move or dock.`
        );
        const stored = this.state.panels[id];
        const entry = {
            id,
            label,
            element,
            handle,
            resizeHandle,
            originalParent,
            defaultDock: normalizeMode(definition.defaultDock, "right"),
            minWidth,
            minHeight,
            mode: stored.mode,
            rect: stored.rect,
            suppressClick: false,
            cleanup: []
        };
        this.entries.set(id, entry);
        const beginMove = (event) => this.#beginDockDrag(event, entry);
        const beginResize = (event) => this.#beginResize(event, entry);
        const focus = () => this.bringToFront(id);
        const keydown = (event) => this.#handleKeydown(event, entry);
        const toggleFloat = (event) => {
            if (!event.target.closest("button, input, select, textarea, a")) {
                this.setMode(
                    id,
                    entry.mode === "float" ? entry.defaultDock : "float"
                );
            }
        };
        handle.addEventListener("pointerdown", beginMove);
        handle.addEventListener("dblclick", toggleFloat);
        handle.addEventListener("keydown", keydown);
        resizeHandle.addEventListener("pointerdown", beginResize);
        element.addEventListener("pointerdown", focus);
        entry.cleanup.push(
            () => handle.removeEventListener("pointerdown", beginMove),
            () => handle.removeEventListener("dblclick", toggleFloat),
            () => handle.removeEventListener("keydown", keydown),
            () => resizeHandle.removeEventListener("pointerdown", beginResize),
            () => element.removeEventListener("pointerdown", focus)
        );
        this.#place(entry, { persist: false });
    }

    #handleKeydown(event, entry) {
        const dockShortcuts = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowDown: "bottom",
            ArrowUp: "float"
        };
        if (event.altKey && dockShortcuts[event.key]) {
            event.preventDefault();
            this.setMode(entry.id, dockShortcuts[event.key]);
            return;
        }
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
                tab.dataset.panelId = entry.id;
                tab.textContent = entry.label;
                tab.title = `Drag ${entry.label} to move or dock`;
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-selected", String(active));
                tab.addEventListener("pointerdown", (event) =>
                    this.#beginDockDrag(event, entry, { fromTab: true }));
                tab.addEventListener("click", (event) => {
                    if (entry.suppressClick) {
                        event.preventDefault();
                        entry.suppressClick = false;
                        return;
                    }
                    this.activate(dock.id, entry.id);
                });
                tab.addEventListener("dblclick", () =>
                    this.setMode(entry.id, "float"));
                dock.tabs.append(tab);
            }
        }
    }

    #dragRect(entry) {
        if (entry.mode === "float") {
            return { ...(entry.rect ?? this.#defaultRect(entry)) };
        }
        const dock = this.docks.get(entry.mode);
        const source = entry.element.hidden
            ? dock?.content
            : entry.element;
        const sourceRect = source?.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const fallback = entry.rect ?? this.#defaultRect(entry);
        const width = clamp(
            fallback.width,
            entry.minWidth,
            Math.max(entry.minWidth, this.container.clientWidth - 24)
        );
        const height = clamp(
            fallback.height,
            entry.minHeight,
            Math.max(entry.minHeight, this.container.clientHeight - 24)
        );
        return {
            x: clamp(
                (sourceRect?.left ?? containerRect.left) - containerRect.left,
                0,
                Math.max(0, this.container.clientWidth - width)
            ),
            y: clamp(
                (sourceRect?.top ?? containerRect.top) - containerRect.top,
                0,
                Math.max(0, this.container.clientHeight - height)
            ),
            width,
            height
        };
    }

    #beginDockDrag(event, entry, { fromTab = false } = {}) {
        if (event.button !== 0) return;
        if (
            !fromTab
            && event.target.closest("button, input, select, textarea, a")
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancelDrag?.();
        if (entry.mode === "float") this.bringToFront(entry.id);
        const target = event.currentTarget;
        const start = {
            x: event.clientX,
            y: event.clientY,
            rect: this.#dragRect(entry)
        };
        let dragging = false;
        let ghostRect = { ...start.rect };
        let dropMode = null;

        const cleanup = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            target.classList.remove("dragging");
            target.removeAttribute("aria-grabbed");
            entry.element.classList.remove("dock-drag-source");
            this.container.classList.remove("node-dock-dragging");
            this.dropOverlay.hide();
            this.cancelDrag = null;
        };
        const move = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;
            if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            if (!dragging) {
                dragging = true;
                entry.suppressClick = fromTab;
                target.classList.add("dragging");
                target.setAttribute("aria-grabbed", "true");
                entry.element.classList.add("dock-drag-source");
                this.container.classList.add("node-dock-dragging");
                this.dropOverlay.show(entry.label, start.rect);
            }
            ghostRect = {
                ...start.rect,
                x: start.rect.x + dx,
                y: start.rect.y + dy
            };
            this.dropOverlay.setGhostRect(ghostRect);
            dropMode = this.dropOverlay.targetAt(
                moveEvent.clientX,
                moveEvent.clientY
            );
            this.dropOverlay.setActive(dropMode);
        };
        const finish = (upEvent) => {
            if (upEvent.pointerId !== event.pointerId) return;
            const cancelled = upEvent.type === "pointercancel";
            cleanup();
            if (!dragging || cancelled) {
                entry.suppressClick = false;
                return;
            }
            if (fromTab) {
                window.setTimeout(() => {
                    entry.suppressClick = false;
                });
            }
            if (dropMode && dropMode !== "float") {
                if (entry.mode === dropMode) {
                    this.activate(dropMode, entry.id);
                } else {
                    this.setMode(entry.id, dropMode);
                }
                return;
            }
            entry.rect = ghostRect;
            if (entry.mode === "float") {
                this.#applyFloatRect(entry);
                this.bringToFront(entry.id);
                this.#persist();
            } else {
                this.setMode(entry.id, "float");
            }
        };
        this.cancelDrag = cleanup;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    }

    #beginResize(event, entry) {
        if (entry.mode !== "float" || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.bringToFront(entry.id);
        const start = {
            x: event.clientX,
            y: event.clientY,
            rect: { ...(entry.rect ?? this.#defaultRect(entry)) }
        };
        const target = entry.resizeHandle;
        target.setPointerCapture(event.pointerId);
        entry.element.classList.add("resizing");
        const move = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            entry.rect = {
                ...start.rect,
                width: start.rect.width + moveEvent.clientX - start.x,
                height: start.rect.height + moveEvent.clientY - start.y
            };
            this.#applyFloatRect(entry);
        };
        const finish = (upEvent) => {
            if (upEvent.pointerId !== event.pointerId) return;
            if (target.hasPointerCapture(upEvent.pointerId)) {
                target.releasePointerCapture(upEvent.pointerId);
            }
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", finish);
            target.removeEventListener("pointercancel", finish);
            entry.element.classList.remove("resizing");
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

    focusPanel(id) {
        const entry = this.entries.get(id);
        if (!entry) return false;
        if (entry.mode === "float") {
            entry.element.hidden = false;
            this.bringToFront(id);
            return true;
        }
        this.activate(entry.mode, id);
        return true;
    }

    setMode(id, mode) {
        const entry = this.entries.get(id);
        const nextMode = normalizeMode(mode);
        if (!entry) return;
        if (nextMode === entry.mode) {
            if (nextMode !== "float") this.activate(nextMode, id);
            return;
        }
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
        this.cancelDrag?.();
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
        this.cancelDrag?.();
        this.resizeObserver.disconnect();
        this.dropOverlay.destroy();
        for (const entry of this.entries.values()) {
            entry.cleanup.forEach((cleanup) => cleanup());
            entry.resizeHandle.remove();
            entry.originalParent?.append(entry.element);
            entry.element.hidden = false;
            entry.element.classList.remove(
                "node-workspace-panel",
                "node-workspace-panel-floating",
                "node-workspace-panel-docked",
                "dock-drag-source"
            );
            entry.element.removeAttribute("data-panel-id");
        }
        this.entries.clear();
        this.container.classList.remove(
            "node-dock-workspace",
            "node-dock-dragging"
        );
    }
}

export function createDockLayoutController(container, options) {
    return new DockLayoutController(container, options);
}
