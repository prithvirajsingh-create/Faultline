import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/scenarios": "http://localhost:3000",
      "/proxy": "http://localhost:3000"
    }
  }
});
