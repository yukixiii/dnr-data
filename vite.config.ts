import { defineConfig } from "vite";

// base: "./" で任意のサブパス(GitHub Pages 等)にそのまま置ける
export default defineConfig({
  base: "./",
  // data/*.json は別チャンク (src/data.ts の動的 import)。最大の items.json は段階別能力値を含むため大きめ
  // (gzip で約 100KB)。本体の JS は小さい
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
