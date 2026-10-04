import { defineConfig } from "vite";

// base: "./" で任意のサブパス(GitHub Pages 等)にそのまま置ける
export default defineConfig({
  base: "./",
  // data/*.json をバンドルに含めるため大きめ (gzip で約150KB)
  build: { chunkSizeWarningLimit: 2000 },
});
