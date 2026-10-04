// data/item_groups.json (段階違いをまとめた装備グループ) の下書きを作る。
// 使い方: npm run gen:groups
//  - ファイルが無ければ groups-lib.ts の規則で生成して書き出す (書き出した後は手で見直して調整する)。
//  - ファイルがあれば上書きせず、まだどのグループにも入っていない候補と、存在しないメンバーを表示するだけ。
import { access, readFile, writeFile } from "node:fs/promises";
import type { GroupMember, Item, ItemGroup, Recipe } from "../src/types.ts";
import { baseNameOf, isGroupable, stageInfo } from "./groups-lib.ts";

const root = new URL("../", import.meta.url);
const readJson = async (p: string) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const outPath = new URL("data/item_groups.json", root);

// レシピは無いが原文の説明から前段が分かるもの (from: 前段メンバー, via: 総称レシピ)
const GOLD_THREAD = ["アーマー", "グローブ", "サブウェポン", "ヘルム", "ボトム", "メインウェポン"];
const LINKS: Record<string, Pick<GroupMember, "from" | "via">> = {
  "祝福された[増幅]古竜のメインウェポン": { from: "[増幅]古竜メインウェポン" },
  "祝福された[増幅]古竜のサブウェポン": { from: "[増幅]古竜サブウェポン" },
  ...Object.fromEntries(GOLD_THREAD.map((s) => [`金糸${s}[Ⅱ]`, { from: `金糸${s}`, via: "n1387-goldthread2-evolve" }])),
};

const items: Item[] = [...(await readJson("data/items.json")), ...(await readJson("data/materials.json"))];
const recipes: Recipe[] = await readJson("data/recipes.json");
const itemIds = new Set(items.map((x) => x.id));

const buckets = new Map<string, Item[]>();
for (const it of items.filter(isGroupable)) {
  const k = baseNameOf(it.id);
  buckets.set(k, [...(buckets.get(k) ?? []), it]);
}

function build(id: string, members: Item[]): ItemGroup {
  const sorted = [...members].sort((a, b) => {
    const x = stageInfo(a.id);
    const y = stageInfo(b.id);
    return x.rank - y.rank || x.n - y.n || a.id.localeCompare(b.id, "ja");
  });
  // グループ内レシピの向き (base → result) と並び順が食い違うときは result を base の後ろへ移す
  const ids = new Set(sorted.map((m) => m.id));
  for (const r of recipes) {
    if (!r.base || r.base === r.result || !ids.has(r.base) || !ids.has(r.result)) continue;
    const bi = sorted.findIndex((m) => m.id === r.base);
    const ri = sorted.findIndex((m) => m.id === r.result);
    if (ri < bi) sorted.splice(bi, 0, ...sorted.splice(ri, 1));
  }
  return {
    id,
    name: id,
    members: sorted.map((m) => {
      const s = stageInfo(m.id);
      return { item: m.id, label: s.label, ...(s.phase ? { phase: s.phase } : {}), ...LINKS[m.id] };
    }),
  };
}

const candidates = [...buckets.entries()].filter(([, v]) => v.length >= 2);

let exists = true;
try {
  await access(outPath);
} catch {
  exists = false;
}

if (!exists) {
  const groups = candidates.map(([k, v]) => build(k, v)).sort((a, b) => a.id.localeCompare(b.id, "ja"));
  await writeFile(outPath, JSON.stringify(groups, null, 2) + "\n");
  console.log(`wrote ${groups.length} groups / ${groups.reduce((s, g) => s + g.members.length, 0)} members -> data/item_groups.json`);
  console.log("生成した内容を見直してからコミットしてください。");
} else {
  const groups: ItemGroup[] = await readJson("data/item_groups.json");
  const assigned = new Set(groups.flatMap((g) => g.members.map((m) => m.item)));
  let n = 0;
  for (const g of groups)
    for (const m of g.members)
      if (!itemIds.has(m.item)) {
        console.log(`存在しないメンバー: ${g.id} / ${m.item}`);
        n++;
      }
  for (const [k, v] of candidates) {
    const left = v.filter((x) => !assigned.has(x.id));
    if (left.length) {
      console.log(`未割り当ての候補: ${k} <= ${left.map((x) => x.id).join(" , ")}`);
      n++;
    }
  }
  console.log(n ? `${n} 件。data/item_groups.json を手で更新してください。` : "差分なし");
}
