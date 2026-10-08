// 日韓のアップデート告知を取得し、data/patchnotes.json の下書き (原文のままのブロック列) を作る補助スクリプト。
// 使い方:
//   npm run fetch:patchnote -- kr 198      韓国パッチノートの全セクションを取得 → raw/kr-198-c<N>.html
//   npm run fetch:patchnote -- jp 1466     日本のお知らせ (raw/notice-1466.html が無ければ取得)
// どちらも ingest/drafts/patchnotes/<id>.json に下書きを出す。翻訳・要約は下書きの文字列を書き換えて行い、
// 人手でレビューしてから data/patchnotes.json に入れること (自動反映はしない)。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { get, sleep, UA } from "./lib.ts";
import type { PatchBlock, PatchCell, PatchNote, PatchSection } from "../src/types.ts";

const RAW_DIR = new URL("./raw/", import.meta.url);
const DRAFT_DIR = new URL("./drafts/patchnotes/", import.meta.url);
const KR_BASE = "https://patchnote.dragonnest.com/kr";
const JP_BASE = "https://dnr-hangame.brabragames.jp/news/notice.html";

// KR サイトは Node の fetch が付ける "Accept-Language: *" をエラーページへ飛ばすので明示する
async function krFetch(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko", ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const clean = (s: string) =>
  s
    .replace(/[ \t\r]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

// HTML 片をブロック列に変換する。
// 本文は「行」(br・p・div で区切る) と表・画像の並びとして読み、行の先頭記号で見出し・箇条書きを分ける。
// 1 マスだけの表 (JP の見出し枠・画像枠) は表とせず中身を本文として読む。
export function toBlocks($: CheerioAPI, root: AnyNode[]): PatchBlock[] {
  const out: PatchBlock[] = [];
  let line = "";
  const flush = () => {
    const t = clean(line);
    line = "";
    if (!t) return;
    const m = t.match(/^(?:◆|■|【|\[|◇)/) ? 1 : t.match(/^(?:▷|▶|◎|●)/) ? 2 : 0;
    // ▶ を箇条書きの記号に使う文 (「〜했습니다.」「〜ました。」) は見出しにしない
    if (m === 2 && /(다\.|。)$/.test(t)) {
      const item = t.replace(/^[▷▶◎●]\s*/, "");
      const last = out[out.length - 1];
      if (last?.type === "ul") last.items.push(item);
      else out.push({ type: "ul", items: [item] });
      return;
    }
    if (m) {
      out.push({ type: "h", level: m, text: t.replace(/^[◆■◇▷▶◎●]\s*/, "") });
      return;
    }
    const li = t.match(/^(?:•|・|·|ㆍ|-|‐|※)\s*(.*)$/);
    if (li) {
      const item = t.startsWith("※") ? t : li[1];
      const last = out[out.length - 1];
      if (last?.type === "ul") last.items.push(item);
      else out.push({ type: "ul", items: [item] });
      return;
    }
    out.push({ type: "p", text: t });
  };
  const cellText = (el: Element) => {
    const $c = $(el).clone();
    $c.find("br").replaceWith("\n");
    $c.find("p, div, li").each((_, p) => {
      $(p).append("\n");
    });
    return $c
      .text()
      .split("\n")
      .map(clean)
      .filter(Boolean)
      .join("\n");
  };
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") {
        line += (n as unknown as { data: string }).data;
        continue;
      }
      if (n.type !== "tag" && n.type !== "script" && n.type !== "style") continue;
      const el = n as Element;
      const tag = el.name.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "colgroup" || tag === "col") continue;
      if (tag === "br") {
        flush();
        continue;
      }
      if (tag === "img") {
        flush();
        out.push({ type: "img", alt: clean($(el).attr("alt") ?? "") || undefined });
        continue;
      }
      if (tag === "table") {
        flush();
        const trs = $(el).find("tr").toArray().filter((tr) => $(tr).closest("table")[0] === el);
        const cells = trs.map((tr) => $(tr).children("th,td").toArray());
        if (trs.length === 1 && cells[0].length === 1) {
          walk(cells[0][0].children);
          flush();
          continue;
        }
        const toCell = (c: Element): PatchCell => {
          const text = cellText(c);
          const rs = Number($(c).attr("rowspan") ?? 1);
          const cs = Number($(c).attr("colspan") ?? 1);
          return rs > 1 || cs > 1 ? { text, ...(rs > 1 ? { rowspan: rs } : {}), ...(cs > 1 ? { colspan: cs } : {}) } : text;
        };
        // thead の行 (または全マスが th の先頭行) を見出し行にする
        let headRows = trs.filter((tr) => $(tr).parent().is("thead")).length;
        if (!headRows && cells[0].every((c) => c.name === "th")) headRows = 1;
        out.push({
          type: "table",
          ...(headRows ? { head: cells.slice(0, headRows).map((r) => r.map(toCell)) } : {}),
          rows: cells.slice(headRows).map((r) => r.map(toCell)),
        });
        continue;
      }
      const isBlock = /^(p|div|li|h\d|tr|ul|ol|hr|center|blockquote)$/.test(tag);
      if (isBlock) flush();
      walk(el.children);
      if (isBlock) flush();
    }
  };
  walk(root);
  flush();
  return out;
}

async function kr(no: string) {
  const top = await krFetch(`${KR_BASE}/${no}`);
  await writeFile(new URL(`kr-${no}.html`, RAW_DIR), top);
  const $top = load(top);
  const title = clean($top("title").text());
  const date = $top("body").text().match(/(\d{4})\.(\d{2})\.(\d{2})/);
  const heads = $top(".ban_box li h3").toArray().map((h) => clean($top(h).text()));
  const sections: PatchSection[] = [];
  for (let n = 1; n <= heads.length; n++) {
    const html = await krFetch(`${KR_BASE}/Category/Details/${n}?patchnoteno=${no}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await writeFile(new URL(`kr-${no}-c${n}.html`, RAW_DIR), html);
    const $ = load(html);
    const blocks = toBlocks($, $(".cont").first().contents().toArray());
    // 先頭の見出し帯 (セクション名の繰り返し) は落とす
    while (blocks[0] && blocks[0].type === "p" && blocks[0].text === heads[n - 1]) blocks.shift();
    sections.push({ heading: heads[n - 1], url: `${KR_BASE}/${no}/c/${n}`, blocks });
    console.log(`c${n} ${heads[n - 1]}: ${blocks.length} blocks`);
    await sleep(1000);
  }
  return {
    id: `kr-${no}`,
    region: "KR",
    date: date ? `${date[1]}-${date[2]}-${date[3]}` : "",
    title,
    url: `${KR_BASE}/${no}`,
    fetched_at: new Date().toISOString().slice(0, 10),
    sections,
  } satisfies PatchNote;
}

// JP: 「■◯◯」の大見出しでセクションに分ける (目次の枠は捨てる)
async function jp(no: string) {
  const path = new URL(`notice-${no}.html`, RAW_DIR);
  const url = `${JP_BASE}?mode=read&no=${no}`;
  const html = await readFile(path, "utf8").catch(async () => {
    const h = await get(url);
    await writeFile(path, h);
    return h;
  });
  const $ = load(html);
  const title = clean($(".viewTitle").first().text());
  const date = $(".noticeView").text().match(/作成日\s*(\d{4}-\d{2}-\d{2})/);
  const blocks = toBlocks($, $(".readBody").first().contents().toArray());
  const sections: PatchSection[] = [];
  for (const b of blocks) {
    if (b.type === "h" && b.text.startsWith("■") === false && /^(アップデート|追加変更点|\d+月イベント|運営イベント)$/.test(b.text)) {
      // 先頭の目次にも同じ見出しが出るので、2 回目からを本文とする
      if (sections.some((s) => s.heading === b.text)) sections.length = 0;
      sections.push({ heading: b.text, url, blocks: [] });
      continue;
    }
    if (sections.length) sections[sections.length - 1].blocks.push(b);
  }
  return {
    id: `jp-notice-${no}`,
    region: "JP",
    date: date?.[1] ?? "",
    title,
    url,
    fetched_at: new Date().toISOString().slice(0, 10),
    sections,
  } satisfies PatchNote;
}

const [region, no] = process.argv.slice(2);
if (!/^(kr|jp)$/.test(region ?? "") || !/^\d+$/.test(no ?? "")) {
  console.error("usage: fetch-patchnote kr|jp <no>");
  process.exit(1);
}
await mkdir(RAW_DIR, { recursive: true });
await mkdir(DRAFT_DIR, { recursive: true });
const note = region === "kr" ? await kr(no) : await jp(no);
await writeFile(new URL(`${note.id}.json`, DRAFT_DIR), JSON.stringify(note, null, 2) + "\n");
console.log(`saved drafts/patchnotes/${note.id}.json (${note.sections.length} sections)`);
