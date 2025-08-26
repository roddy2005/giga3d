import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./"   // ← 절대경로(/giga3d/) 대신 상대경로로
});
