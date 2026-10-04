// ingest/dngamer-export.js でダウンロードした JSON を ingest/raw/dngamer-<スレッドid>.txt に変換する。
// 使い方: npm run import:dngamer -- <dngamer-export-YYYYMMDD.json のパス>
// 元の JSON は ingest/raw/dngamer-export.json にコピーして残す。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { toText } from "./lib.ts";

interface Export {
  fetched_at: string;
  threads: {
    id: number;
    url: string;
    title: string;
    posts: { author: string; posted_at: string; edited_at: string; html: string }[];
  }[];
}

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: import-dngamer <dngamer-export.json>");
  process.exit(1);
}
const RAW_DIR = new URL("./raw/", import.meta.url);
await mkdir(RAW_DIR, { recursive: true });
const json = await readFile(path, "utf8");
const data: Export = JSON.parse(json);
await writeFile(new URL("dngamer-export.json", RAW_DIR), json);

for (const t of data.threads) {
  const posts = t.posts.map((p) => {
    // XenForo の本文には見出し等にゼロ幅スペースが入るので除去 (名前の突き合わせの邪魔になる)
    const { text } = toText(`<div id="post">${p.html.replace(/[​﻿]/g, "")}</div>`, "#post");
    const date = (s: string) => s.slice(0, 10);
    const head = `=== post ${date(p.posted_at)}${p.edited_at ? ` (edited ${date(p.edited_at)})` : ""} by ${p.author}`;
    return `${head}\n${text.trim()}\n`;
  });
  await writeFile(
    new URL(`dngamer-${t.id}.txt`, RAW_DIR),
    `# ${t.title}\n# ${t.url}\n# fetched_at: ${data.fetched_at}\n\n${posts.join("\n")}`,
  );
  console.log(`saved dngamer-${t.id} ${t.title} (${t.posts.length} posts)`);
}
