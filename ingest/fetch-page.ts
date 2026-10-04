// 任意のページ(日本語Wiki等)を取得してテキスト化し ingest/raw/ に保存する補助スクリプト。
// 使い方: npm run fetch:page -- <保存名> <URL> [本文セレクタ]
// 例:     npm run fetch:page -- vip-status "https://wikiwiki.jp/vipdranes/ステータス・装備" "#body"
import { mkdir, writeFile } from "node:fs/promises";
import { get, toText } from "./lib.ts";

const [name, url, selector = "#body, main, article, body"] = process.argv.slice(2);
if (!name || !url) {
  console.error("usage: fetch-page <name> <url> [selector]");
  process.exit(1);
}
const RAW_DIR = new URL("./raw/", import.meta.url);
await mkdir(RAW_DIR, { recursive: true });
const html = await get(encodeURI(decodeURI(url)));
const { title, text } = toText(html, selector);
await writeFile(new URL(`${name}.html`, RAW_DIR), html);
await writeFile(
  new URL(`${name}.txt`, RAW_DIR),
  `# ${title}\n# ${url}\n# fetched_at: ${new Date().toISOString()}\n\n${text}`,
);
console.log(`saved ${name} (${text.length} chars)`);
