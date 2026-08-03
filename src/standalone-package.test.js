import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path) {
    return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("Corvus package boundary", () => {
    it("ships without workspace dependencies", () => {
        const packageJson = JSON.parse(source("../package.json"));
        expect(packageJson.name).toBe("@raykast/corvus");
        expect(packageJson.dependencies).toBeUndefined();
        expect(packageJson.license).toBe("MIT");
        expect(packageJson.author).toEqual({
            name: "Raykast",
            url: "https://raykast.com/"
        });
    });

    it("owns its complete theme and ProFont assets", () => {
        const styles = source("./styles.css");
        const theme = source("./theme.css");
        expect(styles).toContain('@import "./theme.css"');
        expect(styles.match(/@import/g)).toHaveLength(1);
        expect(theme).toContain('font-family: "ProFont"');
        expect(theme).toContain("ProFontWindows.ttf");
        expect(theme).toContain("--node-editor-theme-background:");
        expect(existsSync(fileURLToPath(new URL("./assets/ProFontWindows.ttf", import.meta.url)))).toBe(true);
        expect(existsSync(fileURLToPath(new URL("./assets/profont-sdf.png", import.meta.url)))).toBe(true);
    });

    it("uses the Corvus identity in public-facing copy", () => {
        const packageJson = source("../package.json");
        const readme = source("../README.md");
        const page = source("../index.html");
        const example = source("../demo/main.js");
        const publicCopy = [packageJson, readme, page, example].join("\n");
        expect(publicCopy).toContain("Corvus");
        expect(publicCopy).toContain("https://raykast.com/");
        expect(publicCopy).not.toMatch(/\b(material|art|compiler)\b/i);
    });
});
