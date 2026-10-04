// data/*.json を読み込み、画面から引きやすい索引を作る。
import sources from "../data/sources.json";
import items from "../data/items.json";
import materials from "../data/materials.json";
import recipes from "../data/recipes.json";
import enhanceTables from "../data/enhance_tables.json";
import drops from "../data/drops.json";
import dungeons from "../data/dungeons.json";
import type { Dataset, DropEntry, DropTable, Dungeon, EnhanceTable, Item, Recipe, Ref, Region, Source } from "./types.ts";

export const ds: Dataset = {
  sources: sources as Source[],
  items: items as Item[],
  materials: materials as Item[],
  recipes: recipes as Recipe[],
  enhance_tables: enhanceTables as EnhanceTable[],
  drops: drops as DropTable[],
  dungeons: dungeons as Dungeon[],
};

const group = <T>(pairs: [string, T][]) => {
  const m = new Map<string, T[]>();
  for (const [k, v] of pairs) {
    const arr = m.get(k);
    if (arr) {
      if (!arr.includes(v)) arr.push(v);
    } else m.set(k, [v]);
  }
  return m;
};

export const allItems: Item[] = [...ds.items, ...ds.materials];
export const itemById = new Map(allItems.map((x) => [x.id, x]));
export const dungeonById = new Map(ds.dungeons.map((x) => [x.id, x]));
export const sourceById = new Map(ds.sources.map((x) => [x.id, x]));
export const tableById = new Map(ds.enhance_tables.map((x) => [x.id, x]));

// base と result が同じレシピ (ロック付与・同一装備の等級進化など) は作成ルートではなく「加工」として別扱い
const isSelf = (r: Recipe) => r.base === r.result;
export const recipesByResult = group(ds.recipes.filter((r) => !isSelf(r)).map((r) => [r.result, r]));
export const selfRecipes = group(ds.recipes.filter(isSelf).map((r) => [r.result, r]));
export const recipesByBase = group(ds.recipes.filter((r) => r.base && !isSelf(r)).map((r) => [r.base!, r]));
export const recipesByMaterial = group(ds.recipes.flatMap((r) => r.materials.map((m) => [m.item, r] as [string, Recipe])));
export const tablesByItem = group(ds.enhance_tables.flatMap((t) => t.applies_to.map((id) => [id, t] as [string, EnhanceTable])));
export const tablesByMaterial = group(
  ds.enhance_tables.flatMap((t) => t.rows.flatMap((row) => (row.materials ?? []).map((m) => [m.item, t] as [string, EnhanceTable]))),
);
export const dropsByLocation = group(ds.drops.map((d) => [d.location, d]));
export const dropsByItem = group(
  ds.drops.flatMap((d) => d.entries.map((e) => [e.item, { table: d, entry: e }] as [string, { table: DropTable; entry: DropEntry }])),
);

/** 出典の公開日のうち最新のもの (YYYY-MM-DD)。同じダンジョンの新旧シーズンの表を並べ替えるのに使う */
export function refDate(refs: Ref[]): string {
  return refs.reduce((max, r) => {
    const p = sourceById.get(r.source)?.published_at ?? "";
    return p > max ? p : max;
  }, "");
}

export const newestFirst = <T extends { refs: Ref[] }>(arr: T[]) => [...arr].sort((a, b) => refDate(b.refs).localeCompare(refDate(a.refs)));

export function regionsOf(refs: Ref[]): Region[] {
  const set = new Set<Region>();
  for (const r of refs) {
    const s = sourceById.get(r.source);
    if (s) set.add(s.region);
  }
  return (["JP", "KR", "CN"] as Region[]).filter((r) => set.has(r));
}

export const lastUpdated = ds.sources.reduce((max, s) => (s.fetched_at > max ? s.fetched_at : max), "");
