import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const serverPort = Number(process.env["PORT"] ?? 4780);

export default defineConfig({
  root: resolve(root, "src/client"),
  publicDir: resolve(root, "assets"),
  plugins: [react()],
  // The version the client shows and puts in a problem report.
  define: { __LUNAR_BUILD__: JSON.stringify(process.env["LUNAR_BUILD"] || "dev") },
  build: { outDir: resolve(root, "dist/client"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: { "/ws": { target: `ws://127.0.0.1:${String(serverPort)}`, ws: true } },
  },
});
