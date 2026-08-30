import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
// `vitest/config` re-exports Vite's own `defineConfig` with the `test`
// block typed, so the dev server, the build and the spec share one config.
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

// Every .html file in the repo is a page and a build entry, so a multi-page
// hand-written site needs no build config: add pages, link them, ship.
// (Vite's default would build only the root index.html and silently drop the
// rest from dist/ — fine locally, 404s deployed.)
const SKIP = new Set([
  "node_modules",
  "dist",
  "spec",
  "scripts",
  "reflections",
  "src",
  "public",
  "physical_level_delivery",
  "physical_level_delivery_v2",
]);

function htmlEntries(dir = "."): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlEntries(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

const DATASET_ROOT = resolve("physical_level_delivery_v2/web_game_data");
const DATASET_URL = "/web_game_data/";

function datasetFiles(dir = DATASET_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? datasetFiles(path) : [path];
  });
}

/**
 * Serves and ships the delivered browser dataset from its one home in
 * `physical_level_delivery_v2/`, so the authoritative handoff is never
 * duplicated into `public/` where the two copies could drift.
 */
function deliveredDataset(): Plugin {
  return {
    name: "binary-ninja-dataset",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.startsWith(DATASET_URL)) return next();
        const file = resolve(DATASET_ROOT, decodeURIComponent(path.slice(DATASET_URL.length)));
        if (!file.startsWith(DATASET_ROOT)) return next();
        try {
          const body = readFileSync(file);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const file of datasetFiles()) {
        const rel = file.slice(DATASET_ROOT.length + 1).split(sep).join("/");
        this.emitFile({
          type: "asset",
          fileName: `web_game_data/${rel}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

// `base: "./"` makes built asset URLs relative, so the site works under any
// GitHub Pages path (username.github.io/your-repo/) without further config.
export default defineConfig({
  base: "./",
  plugins: [deliveredDataset()],
  // The traversal spec drives the real fixed-step physics over eight routes,
  // searching a plan for every hop. That is seconds of simulation per level,
  // not milliseconds, so the default 5s per test is far too tight.
  test: {
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
  build: {
    rollupOptions: {
      input: htmlEntries(),
    },
  },
});
