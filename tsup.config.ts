import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  minify: false,
  // Conserve le shebang pour l'exécutable
  banner: { js: "#!/usr/bin/env node" },
});
