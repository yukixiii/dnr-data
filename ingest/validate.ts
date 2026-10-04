// データ検証: スキーマ + 参照整合性 (未定義の item/dungeon/source 参照、id 重複)。
// 使い方:
//   npm run validate                       data/*.json を検証
//   npm run validate -- ingest/drafts/x.json   1ファイルにまとめたドラフト(Dataset形式)を検証
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import type { Dataset, ItemGroup } from "../src/types.ts";
import { baseNameOf, isGroupable } from "./groups-lib.ts";

const COLLECTIONS = ["sources", "items", "materials", "recipes", "enhance_tables", "drops", "dungeons", "sets"] as const;
const DEF: Record<(typeof COLLECTIONS)[number], string> = {
  sources: "source",
  items: "item",
  materials: "item",
  recipes: "recipe",
  enhance_tables: "enhance_table",
  drops: "drop_table",
  dungeons: "dungeon",
  sets: "item_set",
};

const root = new URL("../", import.meta.url);
const readJson = async (p: string) => JSON.parse(await readFile(new URL(p, root), "utf8"));

export async function loadDataset(draft?: string): Promise<Dataset> {
  if (draft) {
    const d = await readJson(draft);
    return Object.fromEntries(COLLECTIONS.map((c) => [c, d[c] ?? []])) as unknown as Dataset;
  }
  const entries = await Promise.all(COLLECTIONS.map(async (c) => [c, await readJson(`data/${c}.json`)]));
  return Object.fromEntries(entries) as Dataset;
}

async function main() {
  const draft = process.argv[2];
  const ds = await loadDataset(draft);
  const schema = await readJson("data/schema/dnr.schema.json");
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  ajv.addSchema(schema);
  const errors: string[] = [];

  for (const c of COLLECTIONS) {
    const v = ajv.getSchema(`dnr.schema.json#/definitions/${DEF[c]}`)!;
    ds[c].forEach((rec: any, i: number) => {
      if (!v(rec)) {
        for (const e of v.errors ?? []) errors.push(`${c}[${i}] ${rec?.id ?? ""}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
      }
    });
  }

  // id 重複 (items と materials は同じ id 空間)
  const dup = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${label}: id 重複 "${id}"`);
      seen.add(id);
    }
  };
  dup("items+materials", [...ds.items, ...ds.materials].map((x) => x.id));
  for (const c of ["sources", "recipes", "enhance_tables", "drops", "dungeons", "sets"] as const) dup(c, ds[c].map((x) => x.id));

  const itemIds = new Set([...ds.items, ...ds.materials].map((x) => x.id));
  const dungeonIds = new Set(ds.dungeons.map((x) => x.id));
  const sourceIds = new Set(ds.sources.map((x) => x.id));
  const needItem = (where: string, id: string) => {
    if (!itemIds.has(id)) errors.push(`${where}: 未定義のアイテム "${id}"`);
  };

  for (const c of COLLECTIONS) {
    if (c === "sources") continue;
    for (const rec of ds[c] as any[]) {
      for (const r of rec.refs ?? []) if (!sourceIds.has(r.source)) errors.push(`${c} ${rec.id}: 未定義の出典 "${r.source}"`);
    }
  }
  for (const r of ds.recipes) {
    needItem(`recipe ${r.id} result`, r.result);
    if (r.base) needItem(`recipe ${r.id} base`, r.base);
    r.materials.forEach((m) => needItem(`recipe ${r.id} material`, m.item));
  }
  for (const t of ds.enhance_tables) {
    t.applies_to.forEach((id) => needItem(`enhance ${t.id} applies_to`, id));
    t.rows.forEach((row) => row.materials?.forEach((m) => needItem(`enhance ${t.id} ${row.level}`, m.item)));
  }
  const setIds = new Set(ds.sets.map((x) => x.id));
  for (const it of [...ds.items, ...ds.materials]) if (it.set && !setIds.has(it.set)) errors.push(`item ${it.id}: 未定義のセット "${it.set}"`);
  for (const d of ds.drops) {
    if (d.location_kind === "dungeon" && !dungeonIds.has(d.location)) errors.push(`drop ${d.id}: 未定義のダンジョン "${d.location}"`);
    if (d.location_kind === "box") needItem(`drop ${d.id} location`, d.location);
    d.entries.forEach((e) => needItem(`drop ${d.id} entry`, e.item));
  }

  // 段階違いの装備グループ (data/ のみ。ドラフトには含めない)
  const warnings: string[] = [];
  let groupCount = "";
  if (!draft) {
    const groups: ItemGroup[] = await readJson("data/item_groups.json");
    groupCount = ` item_groups=${groups.length}`;
    const vg = ajv.getSchema("dnr.schema.json#/definitions/item_group")!;
    const recipeIds = new Set(ds.recipes.map((r) => r.id));
    const groupOf = new Map<string, string>();
    dup("item_groups", groups.map((g) => g.id));
    for (const [i, g] of groups.entries()) {
      if (!vg(g)) for (const e of vg.errors ?? []) errors.push(`item_groups[${i}] ${g.id}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
      const order = new Map(g.members.map((m, j) => [m.item, j]));
      if (itemIds.has(g.id) && !order.has(g.id)) errors.push(`group ${g.id}: グループ id がメンバー以外のアイテム id と同じ`);
      for (const r of g.refs ?? []) if (!sourceIds.has(r.source)) errors.push(`group ${g.id}: 未定義の出典 "${r.source}"`);
      g.members.forEach((m, j) => {
        needItem(`group ${g.id} member`, m.item);
        if (groupOf.has(m.item)) errors.push(`group ${g.id}: "${m.item}" は ${groupOf.get(m.item)} にも入っている`);
        groupOf.set(m.item, g.id);
        if (m.from !== undefined && !((order.get(m.from) ?? Infinity) < j)) errors.push(`group ${g.id}: ${m.item} の from "${m.from}" が前のメンバーではない`);
        if (m.via !== undefined && !recipeIds.has(m.via)) errors.push(`group ${g.id}: ${m.item} の via "${m.via}" が未定義のレシピ`);
      });
      for (const r of ds.recipes) {
        if (!r.base || r.base === r.result || !order.has(r.base) || !order.has(r.result)) continue;
        if (order.get(r.base)! > order.get(r.result)!) errors.push(`group ${g.id}: レシピ ${r.id} (${r.base} → ${r.result}) がメンバーの並びと逆`);
      }
    }
    // まとめ規則に当てはまるのにどのグループにも入っていないアイテム
    const all = [...ds.items, ...ds.materials].filter(isGroupable);
    const byBase = new Map<string, string[]>();
    for (const it of all) byBase.set(baseNameOf(it.id), [...(byBase.get(baseNameOf(it.id)) ?? []), it.id]);
    for (const [k, ids] of byBase)
      if (ids.length >= 2 && ids.some((id) => !groupOf.has(id))) warnings.push(`警告: グループ未割り当て ${k} <= ${ids.filter((id) => !groupOf.has(id)).join(" , ")} (npm run gen:groups)`);
  }
  if (warnings.length) console.warn(warnings.join("\n"));

  const counts = COLLECTIONS.map((c) => `${c}=${ds[c].length}`).join(" ") + groupCount;
  if (errors.length) {
    console.error(errors.join("\n"));
    console.error(`\n${errors.length} 件のエラー (${counts})`);
    process.exit(1);
  }
  console.log(`OK (${counts})`);
}

await main();
