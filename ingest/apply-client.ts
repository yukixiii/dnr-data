// 日本版クライアントデータ (ingest/client/export.json) で data/ の空欄を埋める。
// 使い方: npm run apply:client            (変更内容を表示して data/ に書き込む)
//         npm run apply:client -- --dry   (表示だけ)
//
// 方針: 既存の値は書き換えない (公式お知らせ等の値はクライアントとほぼ一致することを確認済み)。
// 埋めるのは次の空欄だけで、埋めたレコードには出典 jp-client-<pakの日付> を追加する。
//  - アイテム: 等級 (grade)、装備レベル (level)、能力値が1つも無いアイテムの「基本」能力値
//  - 強化表 (日本版の出典を持つ表のみ): 確率・ゴールド・素材が無い行
//  - レシピ (日本版の出典を持つもののみ): ゴールド、成功率 (craft/evolve/upgrade/refine)、「不明」の個数
// 既存の値とクライアント値が食い違う箇所は書き換えずに一覧表示する。
// export.json は非公開のツール (dnr-client) が書き出す。npm run merge で data/ を作り直した後は再実行すること。
import { readFile, writeFile } from "node:fs/promises";
import type { EnhanceTable, Item, ItemGroup, Qty, Recipe, Ref, Source, Stat, StatSet } from "../src/types.ts";

const root = new URL("../", import.meta.url);
const dry = process.argv.includes("--dry");
const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(new URL(p, root), "utf8"));
const writeJson = (p: string, v: unknown) => writeFile(new URL(p, root), JSON.stringify(v, null, 2) + "\n");

interface ClientStat { name: string; value: string }
interface Export {
  source: string;
  pak_date: string;
  items: Record<string, { client_id: number; grade?: string; level?: number; stats?: ClientStat[]; stats_note?: string; skill_id?: number }>;
  enhance: Record<string, { enchant_id: number; rows: Record<string, { rate: number; gold: number; materials: Qty[]; protect_qty: number }> }>;
  recipes: Record<string, { compound_id: number; rate: number; gold: number; materials: Qty[] }>;
  unresolved: Record<string, string>;
}

const ex = await readJson<Export>("ingest/client/export.json");
const sources = await readJson<Source[]>("data/sources.json");
const items = await readJson<Item[]>("data/items.json");
const tables = await readJson<EnhanceTable[]>("data/enhance_tables.json");
const recipes = await readJson<Recipe[]>("data/recipes.json");
const groups = await readJson<ItemGroup[]>("data/item_groups.json");

const SRC = ex.source;
if (!sources.some((s) => s.id === SRC)) {
  sources.push({
    id: SRC,
    url: "https://dnr-hangame.brabragames.jp/",
    region: "JP",
    kind: "official",
    title: `ドラゴンネストR ゲームクライアントのデータ (${ex.pak_date} 更新時点)`,
    // published_at は付けない: 告知ではないので、表の「告知日」や新着お知らせに出さない
    fetched_at: new Date().toISOString().slice(0, 10),
  });
  sources.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}
const regionOf = new Map(sources.map((s) => [s.id, s.region]));
const isJp = (refs: Ref[]) => refs.some((r) => regionOf.get(r.source) === "JP" && r.source !== SRC);
const addRef = (refs: Ref[], note: string) => {
  const cur = refs.find((r) => r.source === SRC);
  if (!cur) refs.push({ source: SRC, note });
  else if (!cur.note?.split("・").includes(note)) cur.note = [cur.note, note].filter(Boolean).join("・");
};

const NOTE = "空欄をクライアントデータで補完";
// 埋めた記録の notes に、どの空欄をクライアントデータで埋めたかを書き足す (再実行時は置き換える)
const FILL_NOTE_RE = /空欄だった[^。]*はクライアントデータ\([^)]*\)の値。/;
function noteFilled(rec: { notes?: string }, kinds: Set<string>) {
  if (!kinds.size) return;
  const order = ["成功率", "ゴールド", "素材", "個数"];
  const prev = rec.notes?.match(FILL_NOTE_RE)?.[0].match(/空欄だった(.*)はクライアントデータ/)?.[1].split("・") ?? [];
  const all = order.filter((k) => kinds.has(k) || prev.includes(k));
  const sentence = `空欄だった${all.join("・")}はクライアントデータ(${ex.pak_date}時点)の値。`;
  const base = (rec.notes ?? "").replace(FILL_NOTE_RE, "").trim();
  rec.notes = [base, sentence].filter(Boolean).join(" ");
}
const log: string[] = [];
const conflicts: string[] = [];
const count: Record<string, number> = {};
const inc = (k: string) => (count[k] = (count[k] ?? 0) + 1);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

// ---- アイテム ----
// 段階違いのまとめ (item_groups) の中では能力名を揃える。同じグループで能力値が既にあるメンバーについて、
// クライアント値と既存値を値の一致で突き合わせ、クライアント側の名前 → 既存の名前 の対応を作る。
const itemById = new Map(items.map((i) => [i.id, i]));
const siblings = new Map<string, string[]>();
for (const g of groups) for (const m of g.members) siblings.set(m.item, g.members.map((x) => x.item).filter((x) => x !== m.item));
const origStatNames = new Map(items.map((i) => [i.id, (i.stats ?? []).flatMap((s) => s.stats.map((x) => x.name))]));
// 同じ能力の表記ゆれ (先頭がクライアント値の書き出しで使う名前)
const SYNONYMS = [
  ["攻撃力", "物理/魔法攻撃力", "物魔攻", "物/魔攻撃", "物魔攻撃力", "物/魔攻撃力"],
  ["物魔攻撃%", "攻撃力%", "物魔攻%", "物理/魔法攻撃力%", "物魔攻(%)", "攻撃%"],
  ["属性%", "属性攻撃力%", "属性(%)", "属性攻撃力(%)", "属性攻撃%"],
  ["物理防御", "物理防御力", "物防", "物理防"],
  ["魔法防御", "魔法防御力", "魔防", "魔法防"],
  ["最大HP", "HP", "MaxHP"],
  ["最大HP%", "HP%", "最大HP(%)"],
  ["CTD", "CTダメージ"],
];
const normValue = (v: string) => v.replace(/[\s　]/g, "").replace(/[～〜]/g, "~");
const baseSet = (it: Item): StatSet | undefined =>
  it.stats?.find((s) => ["基本", "+0", "[+0]", "(+0)"].includes(s.label)) ?? (it.stats?.length === 1 ? it.stats[0] : undefined);
function renameFor(id: string): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const sid of siblings.get(id) ?? []) {
    const sib = itemById.get(sid);
    const cs = ex.items[sid]?.stats;
    const bs = sib && baseSet(sib);
    if (!cs || !bs) continue;
    for (const c of cs) {
      const hit = bs.stats.find((p) => normValue(p.value) === normValue(c.value));
      if (!hit) continue;
      const v = votes.get(c.name) ?? new Map<string, number>();
      v.set(hit.name, (v.get(hit.name) ?? 0) + 1);
      votes.set(c.name, v);
    }
  }
  const rename = new Map([...votes].map(([k, v]) => [k, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  // 値で対応が取れなかった名前は、同じ意味の表記 (SYNONYMS) のうち兄弟が使っているものに寄せる
  const used = new Set((siblings.get(id) ?? []).flatMap((sid) => origStatNames.get(sid) ?? []));
  for (const group of SYNONYMS) {
    const cands = group.filter((n) => used.has(n));
    if (cands.length === 1) for (const n of group) if (!rename.has(n)) rename.set(n, cands[0]);
  }
  return rename;
}

for (const it of items) {
  const c = ex.items[it.id];
  if (!c) continue;
  if (c.grade && !it.grade) {
    it.grade = c.grade;
    addRef(it.refs, NOTE);
    inc("item.grade");
  } else if (c.grade && it.grade && !it.grade.includes(c.grade)) {
    conflicts.push(`${it.id}: 等級 ${it.grade} / クライアント ${c.grade}`);
  }
  if (c.level && it.level === undefined) {
    it.level = c.level;
    addRef(it.refs, NOTE);
    inc("item.level");
  }
  if (c.stats?.length && !(it.stats ?? []).some((s) => s.stats.length)) {
    const rename = renameFor(it.id);
    it.stats = [{ label: "基本", stats: c.stats.map((s): Stat => ({ name: rename.get(s.name) ?? s.name, value: s.value })) }];
    addRef(it.refs, NOTE);
    inc("item.stats");
    log.push(`能力値追加 ${it.id}: ${it.stats[0].stats.map((s) => `${s.name} ${s.value}`).join(", ")}`);
  }
}

// ---- 強化表 ----
for (const t of tables) {
  const c = ex.enhance[t.id];
  if (!c) continue;
  if (!isJp(t.refs)) {
    log.push(`海外版の表 ${t.id}: クライアントの日本版の値あり (強化ID ${c.enchant_id})。書き換えはしない`);
    continue;
  }
  const kinds = new Set<string>();
  for (const row of t.rows) {
    const cr = c.rows[row.level];
    if (!cr) continue;
    if (row.rate === undefined) {
      row.rate = cr.rate;
      kinds.add("成功率");
      inc("enhance.rate");
    } else if (Math.abs(row.rate - cr.rate) > 1e-6) conflicts.push(`${t.id} ${row.level}: 確率 ${row.rate} / クライアント ${cr.rate}`);
    if (row.gold === undefined && cr.gold) {
      row.gold = cr.gold;
      kinds.add("ゴールド");
      inc("enhance.gold");
    } else if (num(row.gold) !== undefined && num(row.gold) !== cr.gold) conflicts.push(`${t.id} ${row.level}: ゴールド ${row.gold} / クライアント ${cr.gold}`);
    if (!row.materials && cr.materials.length) {
      row.materials = cr.materials.map((m) => ({ ...m }));
      kinds.add("素材");
      inc("enhance.materials");
    }
    const jelly = row.materials?.find((m) => m.item === "冒険者のアイテム保護魔法ゼリー");
    if (jelly && cr.protect_qty && parseInt(String(jelly.qty), 10) !== cr.protect_qty)
      conflicts.push(`${t.id} ${row.level}: 保護ゼリー ${jelly.qty} / クライアント ${cr.protect_qty}`);
  }
  if (kinds.size) {
    addRef(t.refs, NOTE);
    noteFilled(t, kinds);
  }
}

// ---- レシピ ----
const RATE_TYPES = new Set<Recipe["type"]>(["craft", "evolve", "upgrade", "refine"]);
for (const r of recipes) {
  const c = ex.recipes[r.id];
  if (!c || !isJp(r.refs)) continue;
  const kinds = new Set<string>();
  if (r.gold === undefined && c.gold) {
    r.gold = c.gold;
    kinds.add("ゴールド");
    inc("recipe.gold");
  } else if (r.gold !== undefined && r.gold !== c.gold) conflicts.push(`${r.id}: ゴールド ${r.gold} / クライアント ${c.gold}`);
  if (r.rate === undefined && RATE_TYPES.has(r.type)) {
    r.rate = c.rate;
    kinds.add("成功率");
    inc("recipe.rate");
  }
  const strip = (s: string) => s.replace(/\((マジック|レア|エピック|ユニーク|レジェンド)\)$/, "").normalize("NFKC").replace(/[\s　]+/g, "");
  for (const m of r.materials) {
    if (typeof m.qty === "number") continue;
    const cm = c.materials.find((x) => strip(x.item) === strip(m.item));
    if (cm && !/\d/.test(String(m.qty))) {
      log.push(`個数補完 ${r.id}: ${m.item} ${m.qty} → ${cm.qty}`);
      m.qty = cm.qty;
      kinds.add("個数");
      inc("recipe.qty");
    }
  }
  if (kinds.size) {
    addRef(r.refs, NOTE);
    noteFilled(r, kinds);
  }
}

console.log(Object.entries(count).map(([k, v]) => `${k}=${v}`).join(" ") || "変更なし");
if (process.argv.includes("-v")) for (const l of log) console.log("  " + l);
if (conflicts.length) {
  console.log(`\n既存値とクライアント値の食い違い (書き換えていない) ${conflicts.length} 件:`);
  for (const c of conflicts) console.log("  " + c);
}
console.log(`\nクライアントと対応が取れなかったアイテム ${Object.keys(ex.unresolved).length} 件 (export.json の unresolved)`);

if (!dry) {
  await writeJson("data/sources.json", sources);
  await writeJson("data/items.json", items);
  await writeJson("data/enhance_tables.json", tables);
  await writeJson("data/recipes.json", recipes);
}
