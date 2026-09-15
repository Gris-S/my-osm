import { defineConfig } from "vitest/config";

// Tests des calculs purs de l'application (`tests/`). Ils tournent dans Node,
// sans navigateur : `tests/setup.ts` fournit le strict minimum que certains
// modules lisent au chargement (langue, stockage).
export default defineConfig({
  define: {
    __DIAGNOSTICS__: "true",
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
  },
});
