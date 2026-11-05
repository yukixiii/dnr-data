// KR 告知の訳語のチェック。ingest/kr_ja_terms.json (韓国語 → 日本版の表記) を使う。
// 使い方:
//   npm run terms -- kr-201
// 1. 原文の下書き (ingest/drafts/patchnotes/<id>.json) に出てくる訳語集の語と、その日本版の表記 (訳す前に見る)
// 2. 訳 (data/patchnotes.json、無ければ ingest/drafts/patchnotes/<id>-c<N>.ja.json) に残っている韓国語。訳語集にあれば置き換え候補を出す
// 3. 原文のセクションに訳語集の語があるのに、訳の同じセクションにその日本語表記が無いもの (訳し漏れ・表記ゆれの候補)
// 訳語集に無い語は、日本版クライアントの表 (dnr-client の shops.py: 商店、itemtable の名前など) で探してから追記する。
// 訳語集の後に、クライアントから自動で作った名前の対応 (ingest/client/kr_ja_names.json、dnr-client の kr_terms.py) も引く。
// 自動の対応は how: "auto" (日本版の名前が複数あれば / で並べる) と "auto-none" (日本版にまだ無い名前) で出す。訳語集にある語は訳語集が優先。
import { access, readFile, readdir } from "node:fs/promises";
import type { PatchBlock, PatchListItem, PatchNote, PatchSection } from "../src/types.ts";

type Term = { ko: string; ja: string; how: string; note?: string; alts?: string[] };
type AutoName = { ko: string; ja: string[]; kind: string[]; id: number };
// 自動の対応は短い語 (2 文字以下) が他の語の一部に当たりやすいので使わない。
// 称号・その他の表にしか出ない名前は、普通の言葉 (강력한 = 称号「大丈夫！そんな私は」など) が多いので 5 文字以上だけ使う
const AUTO_MIN = 3;
const AUTO_MIN_WEAK = 5;
const weak = (n: AutoName) => n.kind.every((k) => k === "title" || k === "other");

const root = new URL("../", import.meta.url);
const read = async <T>(p: string): Promise<T> => JSON.parse(await readFile(new URL(p, root), "utf8"));

const listText = (items: PatchListItem[]): string =>
  items.map((i) => (typeof i === "string" ? i : [i.text, listText(i.items)].join("\n"))).join("\n");

function blockText(b: PatchBlock): string {
  switch (b.type) {
    case "h":
    case "p":
      return b.text;
    case "ul":
      return listText(b.items);
    case "aside":
      return [b.title ?? "", ...b.blocks.map(blockText)].join("\n");
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
const { terms: manual } = await read<{ terms: Term[] }>("ingest/kr_ja_terms.json");
const AUTO_FILE = "ingest/client/kr_ja_names.json";
const autoNames = await access(new URL(AUTO_FILE, root))
  .then(() => read<{ names: AutoName[] }>(AUTO_FILE).then((x) => x.names))
  .catch(() => [] as AutoName[]);
const manualKo = new Set(manual.map((t) => squash(t.ko)));
const auto: Term[] = autoNames
  .filter((n) => squash(n.ko).length >= (weak(n) ? AUTO_MIN_WEAK : AUTO_MIN) && !manualKo.has(squash(n.ko)))
  .map((n) =>
    n.ja.length
      ? { ko: n.ko, ja: n.ja.join(" / "), alts: n.ja, how: "auto", note: `${n.kind.join(",")} uistring ${n.id}` }
      : { ko: n.ko, ja: "", how: "auto-none", note: `${n.kind.join(",")} uistring ${n.id}` },
  );
const terms = [...manual, ...auto];
const orig: PatchNote = await read(`ingest/drafts/patchnotes/${id}.json`);
const ja = await jaSections(id);

// 本文を先頭から読み、各位置で一致する最も長い語を取る (取った部分は読み飛ばすので、短い語が長い語の一部として二重に出ない)。
// 語が数万あるので、先頭 2 文字で候補を引く
const index = new Map<string, { k: string; term: Term }[]>();
for (const term of terms) {
  const k = squash(term.ko);
  if (!k) continue;
  const key = k.slice(0, 2);
  index.set(key, [...(index.get(key) ?? []), { k, term }]);
}
for (const list of index.values()) list.sort((a, b) => b.k.length - a.k.length);

function found(text: string): Term[] {
  const t = squash(text);
  const out = new Set<Term>();
  for (let i = 0; i < t.length; ) {
    const hit = index.get(t.slice(i, i + 2))?.find((c) => t.startsWith(c.k, i));
    if (hit) {
      out.add(hit.term);
      i += hit.k.length;
    } else i++;
  }
  return [...out];
}

console.log(`# 1. 原文に出てくる訳語 (${id})`);
const all = found(orig.sections.map(sectionText).join("\n"));
const HOW_LABEL: Record<string, string> = {
  auto: "auto (クライアントの uistring ID で自動対応)",
  "auto-none": "auto-none (日本版クライアントにまだ無い名前。仮訳が要る)",
};
for (const how of ["shop", "client", "skill", "notice", "provisional", "auto", "auto-none"]) {
  const ts = all.filter((t) => t.how === how);
  if (ts.length)
    console.log(`## ${HOW_LABEL[how] ?? how}\n${ts.map((t) => `  ${t.ko} → ${t.ja || "?"}${t.note ? ` (${t.note})` : ""}`).join("\n")}`);
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
    console.log(`  ${h}${t?.ja ? `  → ${t.how.startsWith("auto") ? "自動対応" : "訳語集"}: ${t.ja} (${t.how})` : ""}`);
  }
});

console.log("\n# 3. 原文にある語の日本語表記が訳の同じセクションに無い");
orig.sections.forEach((s, i) => {
  const j = ja[i];
  if (!j || j.summary_only) return;
  const jt = squash(sectionText(j));
  const miss = found(sectionText(s)).filter((t) => t.ja && !(t.alts ?? [t.ja]).some((a) => jt.includes(squash(a))));
  if (miss.length) console.log(`## ${j.heading}\n${miss.map((t) => `  ${t.ko} → ${t.ja} (${t.how})`).join("\n")}`);
});
