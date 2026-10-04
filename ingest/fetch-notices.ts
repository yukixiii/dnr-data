// 公式お知らせを取得して ingest/raw/ に保存する補助スクリプト。
// 使い方:
//   npm run fetch:notices -- list [検索語] [ページ数]   一覧を表示 (例: list 確率 3)
//   npm run fetch:notices -- 1440 1455 1466            本文を取得し raw/notice-<no>.html と .txt を保存
// 取得結果は人手でレビューしてから data/*.json に反映すること (自動反映はしない)。
import { mkdir, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import { get, sleep, toText } from "./lib.ts";

const BASE = "https://dnr-hangame.brabragames.jp/news/notice.html";
const RAW_DIR = new URL("./raw/", import.meta.url);

async function list(sw: string, pages: number) {
  for (let page = 1; page <= pages; page++) {
    const html = await get(`${BASE}?sw=${encodeURIComponent(sw)}&page=${page}`);
    const $ = load(html);
    $("a[href*='mode=read']").each((_, a) => {
      const href = $(a).attr("href") ?? "";
      const no = href.match(/no=(\d+)/)?.[1];
      const title = $(a).text().replace(/\s+/g, " ").trim();
      if (no && title) console.log(`${no}\t${title}`);
    });
    await sleep(1000);
  }
}

async function fetchNotice(no: string) {
  const url = `${BASE}?mode=read&no=${no}`;
  const html = await get(url);
  const { title, text } = toText(html, ".readBody, .noticeView", ".viewTitle");
  await writeFile(new URL(`notice-${no}.html`, RAW_DIR), html);
  await writeFile(
    new URL(`notice-${no}.txt`, RAW_DIR),
    `# ${title}\n# ${url}\n# fetched_at: ${new Date().toISOString()}\n\n${text}`,
  );
  console.log(`saved notice-${no} (${text.length} chars)`);
}

const args = process.argv.slice(2);
await mkdir(RAW_DIR, { recursive: true });
if (args[0] === "list") {
  await list(args[1] ?? "", Number(args[2] ?? 1));
} else if (args.length) {
  for (const no of args) {
    await fetchNotice(no);
    await sleep(1000);
  }
} else {
  console.error("usage: fetch-notices list [sw] [pages] | <no>...");
  process.exit(1);
}
