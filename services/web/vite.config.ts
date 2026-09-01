import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the backend on :8000. This is why the app can use
// same-origin relative URLs everywhere and never reads VITE_API_BASE_URL in dev — one
// less thing to configure, and no CORS preflight in the common path.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:8000",
        changeOrigin: true,
        // Voice is a WebSocket at /api/voice/stream. Without this the upgrade request
        // is proxied as a plain GET, the socket never opens, and the browser reports
        // only "connection failed" with nothing in the API log to explain it.
        ws: true,
      },
    },
  },
});
