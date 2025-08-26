import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/giga3d/"   // 저장소명이 정확히 들어가야 합니다
});
