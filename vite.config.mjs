import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiRoutes = [
  "/backorders",
  "/status",
  "/import",
  "/notes",
  "/products",
  "/vendors"
];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      apiRoutes.map((route) => [
        route,
        {
          target: "http://localhost:3000",
          changeOrigin: true
        }
      ])
    )
  }
});
