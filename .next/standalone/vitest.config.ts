import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resuelve el alias "@/..." desde tsconfig.json de forma nativa.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
