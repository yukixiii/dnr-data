// ingest/drafts/*.json (抽出ドラフト) を id で突き合わせて統合し、data/*.json を書き出す。
// 使い方: npm run merge -- [出力ディレクトリ (既定: data)]
// 注意: 出力先の既存ファイルは上書きされる。data/ を手で直した後は別ディレクトリに出力して差分を見ること。
//
// 統合ルール
//  - アイテム/素材/ダンジョン: 同じ id は1件に統合。refs・obtain・stats は和集合、
//    単一値フィールドは出典の公開日が新しいドラフトの値を優先 (新しい告知ほど現状に近いため)。
//    items と materials の両方に現れた id は、装備系 kind を持つ方 (items) に寄せる。
//  - レシピ/強化表/ドロップ表: id はお知らせ番号付きで一意なので連結。重複 id は後勝ちせず警告。
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { Dataset, Dungeon, Item, Ref, Source } from "../src/types.ts";

const root = new URL("../", import.meta.url);
const draftDir = new URL("ingest/drafts/", root);
const outDir = new URL(`${process.argv[2] ?? "data"}/`, root);

const MATERIAL_KINDS = new Set(["material", "currency", "box", "consumable", "other"]);

const files = (await readdir(draftDir)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
const drafts: Partial<Dataset>[] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(new URL(f, draftDir), "utf8"))),
);

// 別名の正規化: ingest/aliases.json の { "別表記": "正式表記" } と、空白の有無だけが違う表記 (空白なしに寄せる)
const aliases: Record<string, string> = JSON.parse(await readFile(new URL("ingest/aliases.json", root), "utf8"));
const allNames = new Set(
  drafts.flatMap((d) => [...(d.items ?? []), ...(d.materials ?? []), ...(d.dungeons ?? [])].map((x) => x.id)),
);
for (const n of allNames) {
  const squeezed = n.replace(/[\s　]+/g, "");
  if (squeezed !== n && allNames.has(squeezed) && !aliases[n]) aliases[n] = squeezed;
}
const canon = (id: string) => {
  let cur = id;
  for (let i = 0; i < 5 && aliases[cur]; i++) cur = aliases[cur];
  return cur;
};
for (const d of drafts) {
  for (const x of [...(d.items ?? []), ...(d.materials ?? []), ...(d.dungeons ?? [])]) {
    const c = canon(x.id);
    if (c !== x.id) {
      const field = "kind" in x && (d.dungeons ?? []).includes(x as Dungeon) ? "notes" : "description";
      (x as any)[field] = [(x as any)[field], `別表記: ${x.id}`].filter(Boolean).join(" / ");
      x.id = c;
      x.name = c;
    }
  }
  for (const r of d.recipes ?? []) {
    r.result = canon(r.result);
    if (r.base) r.base = canon(r.base);
    r.materials.forEach((m) => (m.item = canon(m.item)));
  }
  for (const t of d.enhance_tables ?? []) {
    t.applies_to = [...new Set(t.applies_to.map(canon))];
    t.rows.forEach((row) => row.materials?.forEach((m) => (m.item = canon(m.item))));
  }
  for (const t of d.drops ?? []) {
    t.location = canon(t.location);
    t.entries.forEach((e) => (e.item = canon(e.item)));
  }
}

const sources = new Map<string, Source>();
for (const d of drafts) for (const s of d.sources ?? []) if (!sources.has(s.id)) sources.set(s.id, s);

// レコードの新しさ = refs 中で最も新しい出典の公開日
const recency = (refs: Ref[]) =>
  refs.reduce((max, r) => {
    const p = sources.get(r.source)?.published_at ?? "";
    return p > max ? p : max;
  }, "");

const refKey = (r: Ref) => `${r.source}\u0000${r.note ?? ""}`;
const union = <T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string) => {
  if (!a && !b) return undefined;
  const m = new Map<string, T>();
  for (const x of [...(a ?? []), ...(b ?? [])]) if (!m.has(key(x))) m.set(key(x), x);
  return [...m.values()];
};

function mergeRecord<T extends Item | Dungeon>(older: T, newer: T): T {
  const merged: any = { ...older };
  for (const [k, v] of Object.entries(newer)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    merged[k] = v;
  }
  merged.refs = union(older.refs, newer.refs, refKey);
  if ("obtain" in older || "obtain" in newer) merged.obtain = union((older as Item).obtain, (newer as Item).obtain, (x) => x);
  if ("stats" in older || "stats" in newer)
    merged.stats = union((older as Item).stats, (newer as Item).stats, (x) => JSON.stringify(x));
  // kind は「装備系 > 素材系 > other」で具体的な方を残す
  if ("kind" in older && older.kind !== newer.kind) {
    const rank = (k: string) => (MATERIAL_KINDS.has(k) ? (k === "other" ? 0 : 1) : 2);
    merged.kind = rank(newer.kind) >= rank(older.kind) ? newer.kind : older.kind;
  }
  return merged;
}

function mergeById<T extends Item | Dungeon>(records: T[]): T[] {
  const sorted = [...records].sort((a, b) => recency(a.refs).localeCompare(recency(b.refs)));
  const m = new Map<string, T>();
  for (const r of sorted) m.set(r.id, m.has(r.id) ? mergeRecord(m.get(r.id)!, r) : r);
  return [...m.values()];
}

const allItems = mergeById(drafts.flatMap((d) => [...(d.items ?? []), ...(d.materials ?? [])]));
const items = allItems.filter((x) => !MATERIAL_KINDS.has(x.kind)).sort((a, b) => a.id.localeCompare(b.id, "ja"));
const materials = allItems.filter((x) => MATERIAL_KINDS.has(x.kind)).sort((a, b) => a.id.localeCompare(b.id, "ja"));
const dungeons = mergeById(drafts.flatMap((d) => d.dungeons ?? [])).sort((a, b) => a.id.localeCompare(b.id, "ja"));

function concat<K extends "recipes" | "enhance_tables" | "drops">(key: K): Dataset[K] {
  const m = new Map<string, Dataset[K][number]>();
  for (const d of drafts)
    for (const r of (d[key] ?? []) as Dataset[K]) {
      if (m.has(r.id)) console.warn(`警告: ${key} の id 重複 "${r.id}" (先のものを採用)`);
      else m.set(r.id, r);
    }
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id)) as Dataset[K];
}

// sets.json・option_tables.json はクライアントデータ (apply:client) だけが作るので merge では書かない
const out: Omit<Dataset, "sets" | "option_tables"> = {
  sources: [...sources.values()].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")),
  items,
  materials,
  recipes: concat("recipes"),
  enhance_tables: concat("enhance_tables"),
  drops: concat("drops"),
  dungeons,
};

await mkdir(outDir, { recursive: true });
for (const [k, v] of Object.entries(out)) await writeFile(new URL(`${k}.json`, outDir), JSON.stringify(v, null, 2) + "\n");
console.log(`merged ${files.length} drafts -> ${outDir.pathname}`);
console.log(Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(" "));
