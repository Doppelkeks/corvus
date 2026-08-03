import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path) {
    return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("standalone package boundary", () => {
    it("ships without workspace dependencies", () => {
        const packageJson = JSON.parse(source("../package.json"));
        expect(packageJson.name).toBe("@raykast/webgpu-node-editor");
        expect(packageJson.dependencies).toBeUndefined();
        expect(packageJson.license).toBe("MIT");
    });

    it("owns its complete theme and ProFont assets", () => {
        const styles = source("./styles.css");
        const theme = source("./theme.css");
        expect(styles).toContain('@import "./theme.css"');
        expect(styles).not.toContain("@echo/");
        expect(theme).toContain('font-family: "ProFont"');
        expect(theme).toContain("ProFontWindows.ttf");
        expect(theme).toContain("--node-editor-theme-background:");
        expect(existsSync(fileURLToPath(new URL("./assets/ProFontWindows.ttf", import.meta.url)))).toBe(true);
        expect(existsSync(fileURLToPath(new URL("./assets/profont-sdf.png", import.meta.url)))).toBe(true);
    });
});
