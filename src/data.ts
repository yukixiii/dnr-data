// data/*.json を読み込み、画面から引きやすい索引を作る。
// JSON は別チャンクとして並行に読み込む (本体の JS を小さくし、データだけ後から取得する)
const [sources, items, materials, recipes, enhanceTables, drops, dungeons, itemGroups, sets, aliases] = await Promise.all([
  import("../data/sources.json"),
  import("../data/items.json"),
  import("../data/materials.json"),
  import("../data/recipes.json"),
  import("../data/enhance_tables.json"),
  import("../data/drops.json"),
  import("../data/dungeons.json"),
  import("../data/item_groups.json"),
  import("../data/sets.json"),
  import("../ingest/aliases.json"),
]).then((ms) => ms.map((m) => m.default as unknown));
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
export const setMembers = group(allItems.filter((i) => i.set).map((i) => [i.set!, i.id]));
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
/** アイテム → それを含む総称 (members を持つアイテム。「上級堅固な月食のかけら」→「上級月食のかけら」) */
export const aggregatesOf = group(allItems.flatMap((i) => (i.members ?? []).map((m) => [m, i.id] as [string, string])));

/**
 * 中身が 1 種類だけの袋 (「未知の古代ネックレス袋(+12)」→ 未知の古代ネックレス など) → その中身。
 * ドロップ表では袋の代わりに中身を出し、中身のアイテムの入手先にも載せる。袋自身のページはそのまま。
 */
export const simpleBags = new Map<string, DropEntry>();
for (const [loc, ts] of dropsByLocation) {
  if (itemById.get(loc)?.kind !== "box" || !ts.every((t) => t.location_kind === "box" && t.entries.length === 1)) continue;
  if (new Set(ts.map((t) => t.entries[0].item)).size === 1) simpleBags.set(loc, ts[0].entries[0]);
}

/** 袋の個数 × 中身の個数 (どちらかが文字の表記ならそのまま並べる) */
const mulQty = (a: DropEntry["qty"], b: DropEntry["qty"]): DropEntry["qty"] => {
  if (a === undefined || a === "") return b;
  if (b === undefined || b === "" || b === 1) return a;
  if (typeof a === "number" && typeof b === "number") return a * b;
  return a === 1 ? b : `${a}×${b}`;
};

/** ドロップ表の 1 行を表示用に: 単純な袋は中身に置き換え、経由した袋を via に持つ。総称の行から引いた中身は as に総称を持つ */
export type ShownEntry = DropEntry & { via?: string; as?: string };
export const shownEntry = (e: DropEntry): ShownEntry => {
  const inner = simpleBags.get(e.item);
  return inner ? { ...e, item: inner.item, qty: mulQty(e.qty, inner.qty), via: e.item } : e;
};

export type DropHit = { table: DropTable; entry: ShownEntry };
export const dropsByItem = group(
  // 単純な袋の中身の表は、袋を経由した行 (via) で足りるので中身の入手先には出さない
  ds.drops.filter((d) => !(d.location_kind === "box" && simpleBags.has(d.location))).flatMap((d) =>
    d.entries.flatMap((e) => {
      const hits: [string, DropHit][] = [[e.item, { table: d, entry: e }]];
      const s = shownEntry(e);
      if (s.via) hits.push([s.item, { table: d, entry: s }]);
      // 総称の行は、中身のそれぞれのアイテムの入手先にも出す
      for (const m of itemById.get(e.item)?.members ?? []) hits.push([m, { table: d, entry: { ...e, item: m, as: e.item } }]);
      return hits;
    }),
  ),
);

/** 出典の公開日のうち最新のもの (YYYY-MM-DD)。同じダンジョンの新旧シーズンの表を並べ替えるのに使う */
export function refDate(refs: Ref[]): string {
  return refs.reduce((max, r) => {
    const p = sourceById.get(r.source)?.published_at ?? "";
    return p > max ? p : max;
  }, "");
}

/**
 * 並べ替え用の日付。告知日が無いゲームクライアントのデータ (jp-client-*) は取得日を使う
 * (表示の「告知日」には使わない。クライアントにしか無い表・系統が一番古い扱いにならないように)
 */
export function sortDate(refs: Ref[]): string {
  return refs.reduce((max, r) => {
    const s = sourceById.get(r.source);
    const p = s?.published_at ?? (s?.id.startsWith("jp-client-") ? s.fetched_at : "");
    return p > max ? p : max;
  }, "");
}

export const newestFirst = <T extends { refs: Ref[] }>(arr: T[]) => [...arr].sort((a, b) => sortDate(b.refs).localeCompare(sortDate(a.refs)));

/** グループの件数の表記: 段階・強化値の違いなら「全N段階」、等級・物理/魔法などの違いなら「全N種」 */
export const groupCountLabel = (g: ItemGroup) =>
  `全${g.members.length}${g.members.some((m) => /段階|^\+\d|^基本$/.test(m.label) || m.phase) ? "段階" : "種"}`;

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
