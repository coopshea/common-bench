import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // WEB_PORT / API_PORT: a second copy of the app beside one that is already running.
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: true } },
  },
});
