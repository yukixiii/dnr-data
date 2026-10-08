// データ検証: スキーマ + 参照整合性 (未定義の item/dungeon/source 参照、id 重複)。
// 使い方:
//   npm run validate                       data/*.json を検証
//   npm run validate -- ingest/drafts/x.json   1ファイルにまとめたドラフト(Dataset形式)を検証
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import type { ChangelogDay, Dataset, ItemGroup, PatchCell, PatchNote } from "../src/types.ts";
import { baseNameOf, isGroupable } from "./groups-lib.ts";

const COLLECTIONS = ["sources", "items", "materials", "recipes", "enhance_tables", "drops", "dungeons", "sets", "option_tables"] as const;
const DEF: Record<(typeof COLLECTIONS)[number], string> = {
  sources: "source",
  items: "item",
  materials: "item",
  recipes: "recipe",
  enhance_tables: "enhance_table",
  drops: "drop_table",
  dungeons: "dungeon",
  sets: "item_set",
  option_tables: "option_table",
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
  for (const c of ["sources", "recipes", "enhance_tables", "drops", "dungeons", "sets", "option_tables"] as const) dup(c, ds[c].map((x) => x.id));

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
  // 統合された強化表の旧 id の転送先
  if (!draft) {
    const tableIds = new Set(ds.enhance_tables.map((t) => t.id));
    const tableAliases: Record<string, string> = await readJson("ingest/table_aliases.json");
    for (const [from, to] of Object.entries(tableAliases)) {
      if (!tableIds.has(to)) errors.push(`table_aliases ${from}: 転送先の表 "${to}" が無い`);
      if (tableIds.has(from)) errors.push(`table_aliases ${from}: 転送元の id が表として残っている`);
    }
    const optionIds = new Set(ds.option_tables.map((t) => t.id));
    const optionAliases: Record<string, string> = await readJson("ingest/option_aliases.json");
    for (const [from, to] of Object.entries(optionAliases)) {
      if (!optionIds.has(to)) errors.push(`option_aliases ${from}: 転送先のランダムオプション表 "${to}" が無い`);
      if (tableIds.has(from)) errors.push(`option_aliases ${from}: 転送元の id が強化表として残っている`);
    }
  }
  for (const t of ds.option_tables) {
    t.applies_to.forEach((id) => needItem(`option ${t.id} applies_to`, id));
    for (const id of Object.keys(t.applies_parts ?? {})) if (!t.applies_to.includes(id)) errors.push(`option ${t.id}: applies_parts の "${id}" が applies_to に無い`);
    for (const p of t.lines) if (!t.pools[p]) errors.push(`option ${t.id}: 行の候補表 "${p}" が無い`);
    for (const r of t.rerolls) {
      for (const n of r.lines) if (n > t.lines.length) errors.push(`option ${t.id}: 再付与の行 ${n} が行数 ${t.lines.length} を超える`);
      for (const m of r.materials) [m.item, ...(m.alt ?? [])].forEach((id) => needItem(`option ${t.id} reroll`, id));
    }
  }
  const setIds = new Set(ds.sets.map((x) => x.id));
  for (const it of [...ds.items, ...ds.materials]) if (it.set && !setIds.has(it.set)) errors.push(`item ${it.id}: 未定義のセット "${it.set}"`);
  for (const it of [...ds.items, ...ds.materials]) it.members?.forEach((m) => needItem(`item ${it.id} members`, m));
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
  // 更新履歴 (data/ のみ): 日付は新しい順で重複なし、リンク先は実在するもの
  if (!draft) {
    const days: ChangelogDay[] = await readJson("data/changelog.json");
    const groupIds = new Set((await readJson("data/item_groups.json")).map((g: ItemGroup) => g.id));
    const vc = ajv.getSchema("dnr.schema.json#/definitions/changelog_day")!;
    days.forEach((d, i) => {
      if (!vc(d)) for (const e of vc.errors ?? []) errors.push(`changelog[${i}] ${d.date}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
      if (i > 0 && !(d.date < days[i - 1].date)) errors.push(`changelog[${i}] ${d.date}: 日付が新しい順でないか重複している`);
      for (const c of d.changes ?? [])
        for (const l of c.links ?? []) {
          if (l.kind === "item" && !itemIds.has(l.id) && !groupIds.has(l.id)) errors.push(`changelog ${d.date}: 未定義のアイテム "${l.id}"`);
          if (l.kind === "dungeon" && !dungeonIds.has(l.id)) errors.push(`changelog ${d.date}: 未定義のダンジョン "${l.id}"`);
          if (l.kind === "page" && !l.label) errors.push(`changelog ${d.date}: ページのリンク "${l.id}" に label が無い`);
        }
    });
  }
  // 日韓のアップデート (data/ のみ): 新しい順、id 重複なし、表は結合マスを広げると長方形になること
  if (!draft) {
    const notes: PatchNote[] = await readJson("data/patchnotes.json");
    const vp = ajv.getSchema("dnr.schema.json#/definitions/patch_note")!;
    const seen = new Set<string>();
    notes.forEach((n, i) => {
      if (!vp(n)) for (const e of vp.errors ?? []) errors.push(`patchnotes[${i}] ${n.id}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
      if (seen.has(n.id)) errors.push(`patchnotes ${n.id}: id が重複している`);
      seen.add(n.id);
      if (i > 0 && n.date > notes[i - 1].date) errors.push(`patchnotes ${n.id}: 日付が新しい順でない`);
      n.sections?.forEach((s) =>
        s.blocks?.forEach((b, j) => {
          if (b.type !== "table") return;
          const widths = tableWidths([...(b.head ?? []), ...b.rows]);
          if (new Set(widths).size > 1) errors.push(`patchnotes ${n.id} 「${s.heading}」 blocks[${j}]: 表の列数が行ごとに違う (${widths.join(",")})`);
        }),
      );
    });
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

/** 結合マスを広げたときの各行の列数 */
function tableWidths(rows: PatchCell[][]): number[] {
  const carry: number[] = []; // 列ごとに、上の行の rowspan があと何行続くか
  return rows.map((row) => {
    let col = 0;
    const skip = () => {
      while (carry[col] > 0) carry[col++]--;
    };
    for (const c of row) {
      skip();
      const rs = typeof c === "string" ? 1 : (c.rowspan ?? 1);
      const cs = typeof c === "string" ? 1 : (c.colspan ?? 1);
      for (let k = 0; k < cs; k++) carry[col++] = rs - 1;
    }
    skip();
    return col;
  });
}
