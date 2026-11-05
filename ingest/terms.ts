// KR 告知の訳語のチェック。ingest/kr_ja_terms.json (韓国語 → 日本版の表記) を使う。
// 使い方:
//   npm run terms -- kr-201
// 1. 原文の下書き (ingest/drafts/patchnotes/<id>.json) に出てくる訳語集の語と、その日本版の表記 (訳す前に見る)
// 2. 訳 (data/patchnotes.json、無ければ ingest/drafts/patchnotes/<id>-c<N>.ja.json) に残っている韓国語。訳語集にあれば置き換え候補を出す
// 3. 原文のセクションに訳語集の語があるのに、訳の同じセクションにその日本語表記が無いもの (訳し漏れ・表記ゆれの候補)
// 訳語集に無い語は、日本版クライアントの表 (dnr-client の shops.py: 商店、itemtable の名前など) で探してから追記する。
import { readFile, readdir } from "node:fs/promises";
import type { PatchBlock, PatchNote, PatchSection } from "../src/types.ts";

type Term = { ko: string; ja: string; how: string; note?: string };

const root = new URL("../", import.meta.url);
const read = async <T>(p: string): Promise<T> => JSON.parse(await readFile(new URL(p, root), "utf8"));

function blockText(b: PatchBlock): string {
  switch (b.type) {
    case "h":
    case "p":
      return b.text;
    case "ul":
      return b.items.join("\n");
    case "table":
      return [...(b.head ?? []), ...b.rows]
        .flat()
        .map((c) => (typeof c === "string" ? c : c.text))
        .concat(b.note ?? [])
        .join("\n");
    case "img":
      return [b.alt, b.caption].filter(Boolean).join("\n");
  }
}
const sectionText = (s: PatchSection) => [s.heading, ...s.blocks.map(blockText)].join("\n");
// 空白の有無の違いを吸収して探す
const squash = (s: string) => s.replace(/\s+/g, "");

async function jaSections(id: string): Promise<PatchSection[] | null> {
  const notes: PatchNote[] = await read("data/patchnotes.json");
  const n = notes.find((x) => x.id === id);
  if (n) return n.sections;
  const files = (await readdir(new URL("ingest/drafts/patchnotes/", root))).filter((f) => f.startsWith(`${id}-c`) && f.endsWith(".ja.json"));
  if (!files.length) return null;
  files.sort((a, b) => Number(a.match(/-c(\d+)/)![1]) - Number(b.match(/-c(\d+)/)![1]));
  return Promise.all(files.map((f) => read<PatchSection>(`ingest/drafts/patchnotes/${f}`)));
}

const id = process.argv[2];
if (!id) {
  console.error("usage: terms <id> (例: kr-201)");
  process.exit(1);
}
const { terms } = await read<{ terms: Term[] }>("ingest/kr_ja_terms.json");
// 長い語を先に照合し、短い語 (동블이 など) が長い語の一部として二重に出ないようにする
const sorted = [...terms].sort((a, b) => squash(b.ko).length - squash(a.ko).length);
const orig: PatchNote = await read(`ingest/drafts/patchnotes/${id}.json`);
const ja = await jaSections(id);

function found(text: string): Term[] {
  let t = squash(text);
  const out: Term[] = [];
  for (const term of sorted) {
    const k = squash(term.ko);
    if (t.includes(k)) {
      out.push(term);
      t = t.split(k).join("\u0000");
    }
  }
  return out;
}

console.log(`# 1. 原文に出てくる訳語 (${id})`);
const all = found(orig.sections.map(sectionText).join("\n"));
for (const how of ["shop", "client", "skill", "notice", "provisional"]) {
  const ts = all.filter((t) => t.how === how);
  if (ts.length) console.log(`## ${how}\n${ts.map((t) => `  ${t.ko} → ${t.ja}${t.note ? ` (${t.note})` : ""}`).join("\n")}`);
}

if (!ja) {
  console.log("\n(訳がまだ無いので 2・3 は省略)");
  process.exit(0);
}

console.log("\n# 2. 訳に残っている韓国語");
const byKo = new Map(terms.map((t) => [squash(t.ko), t]));
ja.forEach((s) => {
  const hits = new Set<string>();
  // 1 行の中で、ハングル (と間の空白・記号) が続く部分。両端の対応しない括弧は落とす
  for (const m of sectionText(s).matchAll(/\[?[가-힣][가-힣 :\[\]/.~\-]*/g)) {
    let h = m[0].trim();
    if (h.startsWith("[") && !h.includes("]")) h = h.slice(1);
    if (h.endsWith("[")) h = h.slice(0, -1).trim();
    if (!h.startsWith("[") && /^[^\[]*\]/.test(h)) h = "[" + h;
    hits.add(h);
  }
  if (!hits.size) return;
  console.log(`## ${s.heading}`);
  for (const h of hits) {
    const t = byKo.get(squash(h));
    console.log(`  ${h}${t ? `  → 訳語集: ${t.ja} (${t.how})` : ""}`);
  }
});

console.log("\n# 3. 原文にある語の日本語表記が訳の同じセクションに無い");
orig.sections.forEach((s, i) => {
  const j = ja[i];
  if (!j || j.summary_only) return;
  const jt = squash(sectionText(j));
  const miss = found(sectionText(s)).filter((t) => !jt.includes(squash(t.ja)));
  if (miss.length) console.log(`## ${j.heading}\n${miss.map((t) => `  ${t.ko} → ${t.ja} (${t.how})`).join("\n")}`);
});
