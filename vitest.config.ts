import { defineConfig } from "vitest/config";

// Unit tests for the pure modules (no Workers runtime needed).
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "node" } });
