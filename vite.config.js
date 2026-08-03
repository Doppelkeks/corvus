import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL("./index.html", import.meta.url)),
                stress: fileURLToPath(new URL("./stress.html", import.meta.url))
            }
        }
    },
    root
});
