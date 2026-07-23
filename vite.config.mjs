import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiRoutes = [
  "/audits",
  "/auth",
  "/backorders",
  "/email",
  "/status",
  "/import",
  "/integrations",
  "/notes",
  "/notifications",
  "/price-audit",
  "/products",
  "/shopify",
  "/users",
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
