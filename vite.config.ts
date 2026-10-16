import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // WRANGLER_CONFIG lets tests run without a Cloudflare login (see scripts/local-config.mjs).
  plugins: [agents(), react(), cloudflare({ configPath: process.env.WRANGLER_CONFIG })],
});
