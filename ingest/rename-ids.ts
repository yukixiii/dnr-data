// クライアントデータ (ingest/client/export.json の renames) に従ってアイテム id を改名・分割・統合する。
// 使い方: npm run rename:ids            (data/ を書き換える)
//         npm run rename:ids -- --dry   (表示だけ)
// 実行後は dnr-client で export.py を再実行し、新しい id で export.json を作り直してから npm run apply:client。
//
// - 改名 (1 → 1): id/name を変え、旧 id は ingest/aliases.json に登録 (#/item/<旧id> の転送と、merge 時の別名)。
// - 統合 (複数 → 1): 既にあるレコード (items か materials) に refs・obtain・description を足し込む。
// - 分割 (1 → 複数): 等級・物理/魔法/混合・属性・段階などの変種は、旧 id をグループ id にして item_groups にまとめる
//   (古いリンクはグループに飛ぶ)。部位などで分けたものは個別のアイテムにし、旧 id は最初の分割先に転送する。
//   参照は次のように付け替える:
//     強化表の applies_to → 分割先すべて
//     レシピ → base/result の部位・ラベルが対応するものを組にし、決まらなければ分割先ごとに複製
//     ドロップ → 分割先すべての行に複製
//     グループのメンバー → その位置に分割先を並べる
//   能力値は、基本値がクライアント値と最も一致する分割先にだけ残す (他は apply:client がクライアント値で作る)。
import { readFile, writeFile } from "node:fs/promises";
import type { DropTable, EnhanceTable, GroupMember, Item, ItemGroup, Recipe } from "../src/types.ts";
import { baseNameOf, isGroupable, stageInfo } from "./groups-lib.ts";

const root = new URL("../", import.meta.url);
const dry = process.argv.includes("--dry");
const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(new URL(p, root), "utf8"));
const writeJson = (p: string, v: unknown) => writeFile(new URL(p, root), JSON.stringify(v, null, 2) + "\n");

interface Target { id: string; label?: string | null }
interface ClientItem { name: string; kind: string; slot?: string; grade?: string; stats?: { name: string; value: string }[] }
const ex: { renames: Record<string, Target[]>; items: Record<string, ClientItem> } = await readJson("ingest/client/export.json");
const items = await readJson<Item[]>("data/items.json");
const materials = await readJson<Item[]>("data/materials.json");
const recipes = await readJson<Recipe[]>("data/recipes.json");
const tables = await readJson<EnhanceTable[]>("data/enhance_tables.json");
const drops = await readJson<DropTable[]>("data/drops.json");
const groups = await readJson<ItemGroup[]>("data/item_groups.json");
const aliases = await readJson<Record<string, string>>("ingest/aliases.json");

const log: string[] = [];
const renames = ex.renames;
const isSplit = (id: string) => (renames[id]?.length ?? 0) > 1;
const targetsOf = (id: string): Target[] => renames[id] ?? [{ id }];
// 変種の分割か (ラベルが短い印: 等級・物理/魔法/混合・属性・段階)。部位の分割はラベル = アイテム名
const isVariantSplit = (id: string) =>
  isSplit(id) && renames[id].every((t) => t.label && t.label !== t.id && t.label.length <= 6 && !["メイン", "サブ"].includes(t.label));
/** 変種の分割をまとめるグループの id: 印を外した本体名 (告知の総称名「金竜防具 - アーマー」→「金竜のアーマー」) */
const groupIdOf = (oldId: string) => {
  const b = baseNameOf(renames[oldId][0].id);
  return renames[oldId].every((t) => baseNameOf(t.id) === b) ? b : oldId;
};

const LABEL_ORDER = ["ノーマル", "マジック", "レア", "エピック", "ユニーク", "レジェンド", "エンシェント", "下級", "中級", "上級", "ヒロイック",
  "物理", "魔法", "混合", "火", "氷", "雷", "闇", "1段階", "2段階", "3段階", "4段階", "5段階", "メイン", "サブ"];
const labelRank = (l?: string | null) => (l ? LABEL_ORDER.indexOf(l) : -1);

// ---- 能力値の値の比較 (名前の表記ゆれは無視して数値だけ) ----
const nums = (stats: { value: string }[] = []) => new Set(stats.map((s) => s.value.replace(/[\s,]/g, "")));
const baseOf = (it: Item) => it.stats?.find((s) => ["基本", "+0", "[+0]", "(+0)"].includes(s.label)) ?? it.stats?.[0];
function bestTarget(old: Item, ts: Target[]): string | undefined {
  const b = baseOf(old);
  if (!b) return undefined;
  const mine = nums(b.stats);
  let best: string | undefined, score = 0;
  for (const t of ts) {
    const c = nums(ex.items[t.id]?.stats);
    const s = [...mine].filter((v) => c.has(v)).length;
    if (s > score) [best, score] = [t.id, s];
  }
  return best;
}

// ---- アイテム ----
const pool = new Map<string, { rec: Item; inMaterials: boolean }>();
for (const it of items) pool.set(it.id, { rec: it, inMaterials: false });
for (const it of materials) pool.set(it.id, { rec: it, inMaterials: true });
const removed = new Set<string>();

function mergeInto(dst: Item, src: Item) {
  const refs = new Map(dst.refs.map((r) => [r.source + "\0" + (r.note ?? ""), r]));
  for (const r of src.refs) if (![...refs.values()].some((x) => x.source === r.source)) refs.set(r.source + "\0" + (r.note ?? ""), r);
  dst.refs = [...refs.values()];
  if (src.obtain?.length) dst.obtain = [...new Set([...(dst.obtain ?? []), ...src.obtain])];
  for (const k of ["slot", "grade", "level", "series", "max_enhance", "tradable", "name_ko", "name_zh"] as const)
    if (dst[k] === undefined && src[k] !== undefined) (dst as any)[k] = src[k];
  if (!dst.stats?.length && src.stats?.length) dst.stats = src.stats;
  const strip = (x?: string) => (x ?? "").replace(/^旧「[^」]*」を分割。\s*/, "");
  const sd = strip(src.description);
  const note = sd && !strip(dst.description).includes(sd) ? `旧「${src.id}」: ${sd}` : "";
  dst.description = [dst.description, note].filter(Boolean).join(" ") || undefined;
  if (!dst.description) delete dst.description;
}

for (const [oldId, ts] of Object.entries(renames)) {
  const cur = pool.get(oldId);
  if (!cur) {
    log.push(`(存在しない) ${oldId}`);
    continue;
  }
  const old = cur.rec;
  const keepStatsFor = ts.length > 1 ? bestTarget(old, ts) : ts[0].id;
  for (const t of ts) {
    const ci = ex.items[t.id];
    const exist = pool.get(t.id);
    if (exist && t.id !== oldId) {
      // 統合: 既存レコードへ足し込み、素材側にあれば装備に移す
      mergeInto(exist.rec, { ...old, stats: t.id === keepStatsFor ? old.stats : undefined });
      if (exist.inMaterials && !cur.inMaterials) exist.inMaterials = false;
      log.push(`統合 ${oldId} → ${t.id}`);
      continue;
    }
    const rec: Item = structuredClone(old);
    rec.id = rec.name = t.id;
    if (ci?.kind && ["weapon", "armor", "accessory", "special_armor", "artifact", "talisman", "jade", "heraldry"].includes(ci.kind)) rec.kind = ci.kind as Item["kind"];
    if (t.id !== keepStatsFor) delete rec.stats;
    if (ts.length > 1) {
      const note = `旧「${oldId}」を分割。`;
      rec.description = rec.description ? `${note} ${rec.description}` : note;
    }
    pool.set(t.id, { rec, inMaterials: cur.inMaterials && ci?.kind !== undefined ? false : cur.inMaterials });
    log.push(`${ts.length > 1 ? "分割" : "改名"} ${oldId} → ${t.id}`);
  }
  if (!ts.some((t) => t.id === oldId)) {
    pool.delete(oldId);
    removed.add(oldId);
  }
  // 転送先: 変種の分割はグループ (旧 id のまま)、それ以外は最初の分割先
  if (!ts.some((t) => t.id === oldId)) aliases[oldId] = isVariantSplit(oldId) ? groupIdOf(oldId) : ts[0].id;
}

// ---- 参照の付け替え ----
const slotOf = (id: string) => ex.items[id]?.slot ?? pool.get(id)?.rec.slot;
/** 分割先のうち、相手 (other) と部位・ラベルが対応するもの */
function pick(ts: Target[], other: string, otherTs?: Target[]): Target | undefined {
  const so = slotOf(other);
  const bySlot = ts.filter((t) => so && slotOf(t.id) === so);
  if (bySlot.length === 1) return bySlot[0];
  const ol = otherTs?.find((x) => x.id === other)?.label;
  if (ol) {
    const byLabel = ts.filter((t) => t.label && (t.label === ol || ol.endsWith(t.label) || t.label.endsWith(ol)));
    if (byLabel.length === 1) return byLabel[0];
  }
  return undefined;
}

const outRecipes: Recipe[] = [];
for (const r of recipes) {
  const res = targetsOf(r.result);
  const base = r.base ? targetsOf(r.base) : undefined;
  const mats = r.materials.map((m) => ({ m, ts: targetsOf(m.item) }));
  const combos: { result: string; base?: string }[] = [];
  if (r.base && r.base === r.result && res.length > 1) {
    // 同じ装備の等級を上げるレシピ (クローニング ユニーク → レジェンド 等): 隣り合う分割先を組にする
    const sorted = [...res].sort((a, b) => labelRank(a.label) - labelRank(b.label));
    for (let i = 0; i + 1 < sorted.length; i++) combos.push({ base: sorted[i].id, result: sorted[i + 1].id });
  } else if (res.length > 1 && base && base.length > 1) {
    for (const t of res) {
      const b = pick(base, t.id, res);
      if (b) combos.push({ result: t.id, base: b.id });
    }
    if (!combos.length) for (const t of res) for (const b of base) combos.push({ result: t.id, base: b.id });
  } else if (res.length > 1) {
    const b = base?.[0].id;
    const one = b ? pick(res, b) : undefined;
    if (one) combos.push({ result: one.id, base: b });
    else for (const t of res) combos.push({ result: t.id, base: b });
  } else if (base && base.length > 1) {
    const one = pick(base, res[0].id);
    if (one) combos.push({ result: res[0].id, base: one.id });
    else for (const b of base) combos.push({ result: res[0].id, base: b.id });
  } else combos.push({ result: res[0].id, base: base?.[0].id });
  // 素材の分割: 分割先ごとにレシピを複製 (王城の紋章 → 剣/弓/スタッフ/シールドの紋章 など)
  const splitMat = mats.find((x) => x.ts.length > 1);
  const expanded: { result: string; base?: string; mat?: [string, string] }[] = [];
  for (const c of combos) {
    if (!splitMat) expanded.push(c);
    else for (const t of splitMat.ts) expanded.push({ ...c, mat: [splitMat.m.item, t.id] });
  }
  expanded.forEach((c, i) => {
    const nr: Recipe = structuredClone(r);
    if (expanded.length > 1) {
      nr.id = `${r.id}-${i + 1}`;
      nr.notes = [r.notes, `原文の総称「${[r.result, r.base, splitMat?.m.item].filter((x) => x && isSplit(x)).join("・")}」を分割した各アイテムのレシピ。`].filter(Boolean).join(" ");
    }
    nr.result = c.result;
    if (c.base) nr.base = c.base;
    nr.materials = nr.materials.map((m) => ({ ...m, item: c.mat && m.item === c.mat[0] ? c.mat[1] : targetsOf(m.item)[0].id }));
    outRecipes.push(nr);
  });
  if (expanded.length > 1) log.push(`レシピ複製 ${r.id} → ${expanded.length} 件`);
}

// 統合で中身が同じになったレシピは 1 つにまとめ、複製時に付けた id の連番と注記を戻す
{
  const sig = (r: Recipe) => JSON.stringify([r.type, r.result, r.base, r.result_qty, r.materials, r.gold, r.rate, r.where]);
  const byFamily = new Map<string, Recipe[]>();
  const seen = new Map<string, Recipe>();
  for (let i = outRecipes.length - 1; i >= 0; i--) {
    const r = outRecipes[i];
    const k = sig(r);
    if (seen.has(k)) outRecipes.splice(i, 1);
    seen.set(k, r);
  }
  for (const r of outRecipes) {
    const fam = r.id.replace(/-\d+$/, "");
    if (fam !== r.id) byFamily.set(fam, [...(byFamily.get(fam) ?? []), r]);
  }
  for (const [fam, rs] of byFamily) {
    if (rs.length !== 1 || !recipes.some((x) => x.id === fam)) continue;
    const r = rs[0];
    r.id = fam;
    r.notes = r.notes?.replace(/\s*原文の総称「[^」]*」を分割した各アイテムのレシピ。/, "").trim() || undefined;
    if (!r.notes) delete r.notes;
  }
}

for (const t of tables) {
  t.applies_to = [...new Set(t.applies_to.flatMap((a) => targetsOf(a).map((x) => x.id)))];
  for (const row of t.rows) row.materials = row.materials?.map((m) => ({ ...m, item: targetsOf(m.item)[0].id }));
}
for (const d of drops) {
  if (d.location_kind === "box") d.location = targetsOf(d.location)[0].id;
  const splitNames = new Set<string>();
  d.entries = d.entries.flatMap((e) => {
    const ts = targetsOf(e.item);
    if (ts.length > 1 && isVariantSplit(e.item)) splitNames.add(e.item);
    return ts.map((t) => ({ ...e, item: t.id }));
  });
  // 統合で同じ行になったものは 1 つに
  const seen = new Set<string>();
  d.entries = d.entries.filter((e) => {
    const k = JSON.stringify(e);
    return !seen.has(k) && (seen.add(k), true);
  });
  if (splitNames.size) {
    const note = `原文は分割前の名前 (${[...splitNames].slice(0, 2).join("・")}${splitNames.size > 2 ? " など" : ""}) での記載で、等級などの違いは区別されていない。`;
    if (!d.notes?.includes(note)) d.notes = [d.notes, note].filter(Boolean).join(" ");
  }
}

// ---- グループ ----
const memberSeen = new Set<string>();
for (const g of groups) {
  const out: (GroupMember & { split?: boolean })[] = [];
  for (const m of g.members) {
    const ts = targetsOf(m.item);
    if (ts.length === 1) {
      out.push({ ...m, item: ts[0].id, ...(m.from ? { from: targetsOf(m.from)[0].id } : {}) });
      continue;
    }
    const sorted = [...ts].sort((a, b) => labelRank(a.label) - labelRank(b.label));
    for (const t of sorted) {
      out.push(
        m.phase
          ? { item: t.id, label: m.label, phase: t.label ?? m.phase, split: true } // ブローチ: 段階はそのまま、区切りを等級に
          : { item: t.id, label: t.label ?? m.label, ...(m.label !== "通常" ? { phase: m.label } : { phase: "通常" }), split: true },
      );
    }
  }
  // ブローチのように 1 段階ずつ等級に分けたものは、連続する分割部分を区切り (等級) ごとに並べ直す
  for (let i = 0; i < out.length; ) {
    if (!out[i].split) { i++; continue; }
    let j = i;
    while (j < out.length && out[j].split) j++;
    const run = out.slice(i, j).map((m, k) => ({ m, k }));
    run.sort((a, b) => labelRank(a.m.phase) - labelRank(b.m.phase) || a.k - b.k);
    out.splice(i, j - i, ...run.map((x) => x.m));
    i = j;
  }
  // 区切りが「通常」だけになったもの (分割しなかった側が無い) は区切りを外す
  if (out.every((m) => !m.phase || m.phase === "通常")) for (const m of out) delete m.phase;
  g.members = out
    .map(({ split, ...m }) => m)
    .filter((m) => !memberSeen.has(m.item) && (memberSeen.add(m.item), true));
}
// 変種の分割で、まだどのグループにも入っていないものは旧 id をグループ id にしてまとめる
for (const [oldId, ts] of Object.entries(renames)) {
  if (!isVariantSplit(oldId) || ts.every((t) => memberSeen.has(t.id))) continue;
  const gid = groupIdOf(oldId);
  if (groups.some((g) => g.id === gid)) continue;
  const sorted = [...ts].sort((a, b) => labelRank(a.label) - labelRank(b.label));
  groups.push({ id: gid, name: gid, members: sorted.map((t) => ({ item: t.id, label: t.label! })) });
  sorted.forEach((t) => memberSeen.add(t.id));
  log.push(`グループ追加 ${gid}`);
}
// 分割で 1 件になったグループ・空のグループは消す
const outGroups = groups.filter((g) => g.members.length >= 2);
// まとめ規則に当てはまるのにどのグループにも入っていないもの (部位で分けた後の Ⅰ/Ⅱ など) を足す
{
  const inGroup = new Set(outGroups.flatMap((g) => g.members.map((m) => m.item)));
  const byBase = new Map<string, string[]>();
  for (const { rec } of pool.values()) if (isGroupable(rec)) byBase.set(baseNameOf(rec.id), [...(byBase.get(baseNameOf(rec.id)) ?? []), rec.id]);
  for (const [b, ids] of byBase) {
    const missing = ids.filter((id) => !inGroup.has(id));
    if (ids.length < 2 || !missing.length) continue;
    let g = outGroups.find((x) => x.id === b) ?? outGroups.find((x) => x.members.some((m) => ids.includes(m.item)));
    if (!g) outGroups.push((g = { id: b, name: b, members: [] }));
    for (const id of missing) {
      const st = stageInfo(id);
      g.members.push({ item: id, label: st.label, ...(st.phase ? { phase: st.phase } : {}) });
    }
    if (!g.members.some((m) => m.phase)) g.members.sort((a, c) => { const x = stageInfo(a.item), y = stageInfo(c.item); return x.rank - y.rank || x.n - y.n; });
    log.push(`グループ補完 ${g.id}: ${missing.join(", ")}`);
  }
}

// ---- 書き出し ----
const outItems: Item[] = [];
const outMaterials: Item[] = [];
const order = [...items.map((x) => x.id), ...materials.map((x) => x.id)];
const emitted = new Set<string>();
const emit = (id: string) => {
  const p = pool.get(id);
  if (!p || emitted.has(id)) return;
  emitted.add(id);
  (p.inMaterials ? outMaterials : outItems).push(p.rec);
};
for (const id of order) {
  if (renames[id]) for (const t of renames[id]) emit(t.id);
  emit(id);
}
for (const id of pool.keys()) emit(id);

console.log(log.join("\n"));
console.log(`\nitems ${items.length} → ${outItems.length}, materials ${materials.length} → ${outMaterials.length}, recipes ${recipes.length} → ${outRecipes.length}, groups ${groups.length} → ${outGroups.length}`);
if (!dry) {
  await writeJson("data/items.json", outItems);
  await writeJson("data/materials.json", outMaterials);
  await writeJson("data/recipes.json", outRecipes);
  await writeJson("data/enhance_tables.json", tables);
  await writeJson("data/drops.json", drops);
  await writeJson("data/item_groups.json", outGroups);
  await writeJson("ingest/aliases.json", Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))));
}
