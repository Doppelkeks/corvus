export const DOCK_DROP_TARGETS = Object.freeze([
    Object.freeze({ mode: "left", label: "Dock left" }),
    Object.freeze({ mode: "right", label: "Dock right" }),
    Object.freeze({ mode: "bottom", label: "Dock bottom" }),
    Object.freeze({ mode: "float", label: "Float" })
]);

function contains(rect, x, y) {
    return x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom;
}

export function dockDropTargetAt(zones, x, y) {
    return zones.find((zone) => contains(zone.rect, x, y))?.mode ?? null;
}

function zoneElement({ mode, label }) {
    const element = document.createElement("div");
    element.className = `node-dock-drop-zone node-dock-drop-zone-${mode}`;
    element.dataset.dockTarget = mode;
    element.innerHTML = `
        <span class="node-dock-drop-zone-icon" aria-hidden="true"></span>
        <strong>${label}</strong>
    `;
    return element;
}

export class DockDropOverlay {
    constructor(container) {
        this.container = container;
        this.element = document.createElement("div");
        this.element.className = "node-dock-drop-layer";
        this.element.hidden = true;
        this.element.setAttribute("aria-hidden", "true");
        this.zones = new Map(DOCK_DROP_TARGETS.map((definition) => [
            definition.mode,
            zoneElement(definition)
        ]));
        this.ghost = document.createElement("div");
        this.ghost.className = "node-dock-drag-ghost";
        this.ghostLabel = document.createElement("strong");
        this.ghostHint = document.createElement("span");
        this.ghostHint.textContent = "Release to place";
        this.ghost.append(this.ghostLabel, this.ghostHint);
        this.element.append(...this.zones.values(), this.ghost);
        container.append(this.element);
        this.activeMode = null;
    }

    show(label, rect) {
        this.ghostLabel.textContent = label;
        this.element.hidden = false;
        this.setGhostRect(rect);
        this.setActive(null);
    }

    setGhostRect(rect) {
        Object.assign(this.ghost.style, {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });
    }

    targetAt(clientX, clientY) {
        const zones = [...this.zones.entries()].map(([mode, element]) => ({
            mode,
            rect: element.getBoundingClientRect()
        }));
        return dockDropTargetAt(zones, clientX, clientY);
    }

    setActive(mode) {
        this.activeMode = mode;
        for (const [zoneMode, element] of this.zones) {
            element.classList.toggle("active", zoneMode === mode);
        }
        this.element.dataset.activeDock = mode ?? "";
    }

    hide() {
        this.element.hidden = true;
        this.setActive(null);
    }

    destroy() {
        this.element.remove();
        this.zones.clear();
    }
}
