// data/*.json を読み込み、画面から引きやすい索引を作る。
import sources from "../data/sources.json";
import items from "../data/items.json";
import materials from "../data/materials.json";
import recipes from "../data/recipes.json";
import enhanceTables from "../data/enhance_tables.json";
import drops from "../data/drops.json";
import dungeons from "../data/dungeons.json";
import itemGroups from "../data/item_groups.json";
import sets from "../data/sets.json";
import aliases from "../ingest/aliases.json";
import type { Dataset, DropEntry, DropTable, Dungeon, EnhanceTable, GroupMember, Item, ItemGroup, ItemSet, Recipe, Ref, Region, Source } from "./types.ts";

export const ds: Dataset = {
  sources: sources as Source[],
  items: items as Item[],
  materials: materials as Item[],
  recipes: recipes as Recipe[],
  enhance_tables: enhanceTables as EnhanceTable[],
  drops: drops as DropTable[],
  dungeons: dungeons as Dungeon[],
  sets: sets as ItemSet[],
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
export const setById = new Map(ds.sets.map((x) => [x.id, x]));
/** 改名・統合された旧 id → 新しい id (ingest/aliases.json)。古いリンクを開いたときに転送する */
const aliasOf = aliases as Record<string, string>;

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

export const recipeById = new Map(ds.recipes.map((x) => [x.id, x]));

// ---------- 段階違いの同一装備グループ ----------
// recipes/drops/enhance_tables は各段階のアイテム id を指したまま。画面側でグループ単位に束ねる。

export const groups = itemGroups as ItemGroup[];
export const groupById = new Map(groups.map((g) => [g.id, g]));
const groupOfItem = new Map(groups.flatMap((g) => g.members.map((m) => [m.item, g] as [string, ItemGroup])));
export const groupOf = (id: string) => groupOfItem.get(id);
export const memberOf = (id: string): GroupMember | undefined => groupOf(id)?.members.find((m) => m.item === id);
export const memberIndex = (g: ItemGroup, id: string) => g.members.findIndex((m) => m.item === id);
export const lastMember = (g: ItemGroup) => g.members[g.members.length - 1].item;
/** 一覧やグループ id から開いたときに表示する段階: ステータスのある最終段階 (無ければ最終段階) */
export const defaultMember = (g: ItemGroup) =>
  [...g.members].reverse().find((m) => itemById.get(m.item)?.stats?.length)?.item ?? lastMember(g);
export const groupItemIds = (id: string) => groupOf(id)?.members.map((m) => m.item) ?? [id];

/** 段階の表示名 ("マジック 3段階" "増幅" 等)。グループ外ならアイテム名 */
export function memberLabel(id: string) {
  const m = memberOf(id);
  if (!m) return itemById.get(id)?.name ?? id;
  return m.phase && m.label === "基本" ? m.phase : [m.phase, m.label].filter(Boolean).join(" ");
}

/** 同じグループ内の段階を上げるレシピ */
export const isIntra = (r: Recipe) => !!r.base && r.base !== r.result && !!groupOf(r.base) && groupOf(r.base) === groupOf(r.result);

/** グループの外から来るレシピ (作成ルートの1手順になるもの)。分解は除く */
export const interPreds = (id: string) => (recipesByResult.get(id) ?? []).filter((r) => !isIntra(r) && r.type !== "dismantle");

/** #/item/<id> の id を解決。段階アイテムならそのグループ、グループ id なら defaultMember を選択中にする */
export function resolveDetail(id: string): { group?: ItemGroup; focus: string } | undefined {
  if (itemById.has(id)) return { group: groupOf(id), focus: id };
  const g = groupById.get(id);
  if (g) return { group: g, focus: defaultMember(g) };
  // 旧 id: 分割されたものはグループ (または最初の分割先) へ
  const to = aliasOf[id];
  return to && to !== id ? resolveDetail(to) : undefined;
}

/** 一覧の1単位: グループは1件にまとめ、所属アイテムは個別に出さない。series/level は最初に値を持つ段階のもの */
export type ListUnit = { item: Item; group?: ItemGroup; members: Item[]; series?: string; level?: number };

export function listUnits(mode: "equipment" | "materials"): ListUnit[] {
  const inEquip = new Set(ds.items.map((x) => x.id));
  const pool = mode === "equipment" ? ds.items : ds.materials;
  const units: ListUnit[] = [];
  const done = new Set<string>();
  for (const it of pool) {
    const g = groupOf(it.id);
    if (!g) {
      units.push({ item: it, members: [it], series: it.series, level: it.level });
      continue;
    }
    // 装備を1つでも含むグループは装備一覧に出す (素材扱いのセイヴィア紋章(上級)等は装備側でまとめる)
    const belongs = g.members.some((m) => inEquip.has(m.item)) === (mode === "equipment");
    if (!belongs || done.has(g.id)) continue;
    done.add(g.id);
    const members = g.members.map((m) => itemById.get(m.item)!).filter(Boolean);
    units.push({
      item: itemById.get(defaultMember(g))!,
      group: g,
      members,
      series: members.find((m) => m.series)?.series,
      level: members.find((m) => m.level)?.level,
    });
  }
  return units;
}
