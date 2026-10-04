// 日本版クライアントデータ (ingest/client/export.json) を data/ に反映する。クライアントの値を正とする。
// 使い方: npm run apply:client            (変更内容を表示して data/ に書き込む)
//         npm run apply:client -- --dry   (表示だけ)   -v で詳細
//
// 方針 (ゲーム内の値が最も正しい):
//  - クライアントが持つ値は常にクライアントの値にする。既存の値 (告知・wiki・海外版) と違っていた場合は
//    元の値をアイテムは description、表・レシピは notes に「告知では …」の文で残す (再実行しても重複しない)。
//  - アイテム: 等級・Lv・部位・種類・最大強化・セット・能力値 (基本 + 強化段階 +1～+N + 細工段階) をクライアント値で作り直す。
//    取引・説明は既存の文の方が詳しいので、空の時だけクライアント値を入れる。
//  - 強化表: クライアントの強化 ID と対応が取れた表は確率・ゴールド・素材をクライアント値にし、能力値はアイテム側に移す。
//    海外版 (KR/CN) だけの表は日本版クライアントの表に置き換える。対応の取れない表はそのまま残す。
//    強化表の無いアイテムには、強化 ID ごとの表 (client-enh-<強化ID>) を作る。
//  - レシピ: 照合できたもの (itemcompoundtable) はゴールド・成功率・素材の個数をクライアント値にする。
//  - セット効果: data/sets.json をクライアント値で作る。
//  - 能力値の名前は表記ゆれを 1 つに揃える (STAT_NAMES)。
// export.json は非公開のツール (dnr-client) が書き出す。npm run merge / rename:ids の後は export.py → apply:client を再実行する。
import { readFile, writeFile } from "node:fs/promises";
import type { EnhanceRow, EnhanceTable, Item, ItemGroup, ItemSet, Qty, Recipe, Ref, Source, Stat, StatSet } from "../src/types.ts";
import { baseNameOf, completeGroups } from "./groups-lib.ts";

const root = new URL("../", import.meta.url);
const dry = process.argv.includes("--dry");
const verbose = process.argv.includes("-v");
const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(new URL(p, root), "utf8"));
const writeJson = (p: string, v: unknown) => writeFile(new URL(p, root), JSON.stringify(v, null, 2) + "\n");

interface CStat { name: string; value: string }
interface CMat { item: string; qty: number; client_id?: number }
interface CRow { rate: number; gold: number; materials: CMat[]; protect_qty: number; break_rate?: number; down?: [number, number] }
interface CItem {
  client_id: number; name: string; kind: string; slot?: string; grade?: string; level?: number; tier?: string; label?: string;
  stats?: CStat[]; stats_note?: string; variants_note?: string; enchant_id?: number; max_enhance?: number;
  levels?: Record<string, CStat[]>; stages?: Record<string, CStat[]>; tradable?: string; description?: string; set?: string;
}
interface Export {
  source: string;
  pak_date: string;
  items: Record<string, CItem>;
  keep: Record<string, string>;
  enhance: Record<string, { enchant_id: number; level_offset: number; rows: Record<string, CRow>; max_level: number }>;
  enchants: Record<string, Record<string, CRow>>;
  recipes: Record<string, { compound_id: number; rate: number; gold: number; materials: { item: string; qty: number }[] }>;
  sets: Record<string, { name: string | null; text: string | null; bonuses: { count: number; stats?: CStat[]; skill?: string }[]; items: string[] }>;
  new_items: string[];
}

const ex = await readJson<Export>("ingest/client/export.json");
const sources = await readJson<Source[]>("data/sources.json");
const items = await readJson<Item[]>("data/items.json");
const materials = await readJson<Item[]>("data/materials.json");
const tables = await readJson<EnhanceTable[]>("data/enhance_tables.json");
const recipes = await readJson<Recipe[]>("data/recipes.json");
const groups = await readJson<ItemGroup[]>("data/item_groups.json");

const SRC = ex.source;
const srcRec: Source = {
  id: SRC,
  url: "https://dnr-hangame.brabragames.jp/",
  region: "JP",
  kind: "official",
  title: `ドラゴンネストR ゲームクライアントのデータ (${ex.pak_date} 更新時点)`,
  // published_at は付けない: 告知ではないので、表の「告知日」や新着お知らせに出さない
  fetched_at: sources.find((s) => s.id === SRC)?.fetched_at ?? new Date().toISOString().slice(0, 10),
};
if (!sources.some((s) => s.id === SRC)) sources.push(srcRec);
const sourceById = new Map(sources.map((s) => [s.id, s]));
const isOverseas = (refs: Ref[]) => refs.length > 0 && refs.every((r) => sourceById.get(r.source)?.region !== "JP");
const srcLabel = (refs: Ref[]) => {
  // 元の値の出典: 日本版の告知 → 日本版のその他 → 海外版 の順
  const cands = refs.map((r) => sourceById.get(r.source)).filter((s): s is Source => !!s && s.id !== SRC);
  const s = cands.find((x) => x.region === "JP" && x.kind === "official") ?? cands.find((x) => x.region === "JP") ?? cands[0];
  if (!s) return "既存の値";
  return s.region === "JP" ? (s.kind === "official" ? `告知(${s.id})` : `${s.title.slice(0, 20)}(${s.id})`) : `海外版(${s.id})`;
};
const LEGACY_NOTE = "空欄をクライアントデータで補完";
const addRef = (refs: Ref[], note?: string) => {
  const cur = refs.find((r) => r.source === SRC);
  if (!cur) refs.push(note ? { source: SRC, note } : { source: SRC });
  else {
    const parts = (cur.note ?? "").split("・").filter((x) => x && x !== LEGACY_NOTE);
    if (note && !parts.includes(note)) parts.push(note);
    if (parts.length) cur.note = parts.join("・");
    else delete cur.note;
  }
};
// 以前の空欄補完の注記 (今はクライアント値で全体を作り直すので不要)
const LEGACY_FILL = /\s*空欄だった[^。]*はクライアントデータ\([^)]*\)の値。/g;
const dropLegacy = (rec: { notes?: string }) => {
  if (rec.notes) rec.notes = rec.notes.replace(LEGACY_FILL, "").trim() || undefined;
  if (rec.notes === undefined) delete rec.notes;
};

// ---- 能力値の名前の統一 (クライアントの書き出しと同じ表記に寄せる) ----
const STAT_NAMES: Record<string, string[]> = {
  攻撃力: ["物理/魔法攻撃力", "物魔攻", "物/魔攻撃", "物魔攻撃力", "物/魔攻撃力", "物･魔", "物・魔", "物魔攻撃", "攻撃"],
  "物魔攻撃%": ["攻撃力%", "攻撃%", "物魔攻%", "物魔攻(%)", "攻撃力(%)", "物理/魔法攻撃力%", "物魔攻撃力%", "物魔%"],
  "属性%": ["属性", "属性攻撃", "属性攻撃力", "属性攻撃力(%)", "属性(%)", "全属性", "全属性攻撃力", "全属性攻撃", "属性攻撃力%", "属攻%", "属性攻"],
  物理防御: ["物防", "物理防御力", "物理防"],
  魔法防御: ["魔防", "魔法防御力", "魔法防"],
  物魔防御: ["物魔防", "物/魔防御", "物魔防御力", "物・魔防", "物･魔防"],
  最大HP: ["HP", "MaxHP"],
  "最大HP%": ["HP%", "HP(%)", "MaxHP(%)", "MaxHP%", "最大HP(%)"],
  CTD: ["CTダメージ"],
  最小攻撃力: ["最小攻撃"],
  最大攻撃力: ["最大攻撃"],
  "物理攻撃力%": ["物理攻撃力(%)"],
  "魔法攻撃力%": ["魔法攻撃力(%)", "魔法攻撃力％"],
  "力%": ["力(%)"],
  "敏捷%": ["敏捷(%)"],
  "知力%": ["知力(%)"],
  "体力%": ["体力(%)"],
  FD: ["词条最终伤害"],
};
const statName = new Map(Object.entries(STAT_NAMES).flatMap(([k, vs]) => vs.map((v) => [v, k] as [string, string])));
const normStats = (ss: Stat[] = []) => ss.map((s) => (statName.has(s.name) ? { ...s, name: statName.get(s.name)! } : s));
const normLabel = (l: string) => l.replace(/^\[\+(\d+)\]$/, "+$1").replace(/^\(\+(\d+)\)$/, "+$1");

// 値の比較 (名前の表記は無視して数値の組で比べる。"17%" と "17.00%" は同じ)
const num = (v: string) => {
  const t = v.replace(/[,\s]/g, "");
  const m = t.match(/^([+-]?[\d.]+)(%?)$/);
  return m ? `${Number(m[1])}${m[2]}` : t;
};
const NUMERIC = /^[+-]?[\d,.]+%?$/;
/** 数値の値の集合 (物理/魔法を 2 行に分けた表記と「攻撃力」1 行の表記、最小/最大の 2 行と「a~b」を同じとみなす) */
const valueSet = (ss: (Stat | CStat)[]) =>
  new Set(ss.flatMap((s) => s.value.split(/~|～| \/ /).map((v) => v.trim())).filter((v) => NUMERIC.test(v.replace(/\s/g, ""))).map(num));
/** 告知の値がすべてクライアントの値に含まれるか (告知は上がった能力だけを載せることがある) */
const sameValues = (a: (Stat | CStat)[], b: (Stat | CStat)[]) => {
  const y = valueSet(b);
  return [...valueSet(a)].every((v) => y.has(v));
};
/** 数値でない能力 (スキル効果の説明など) はクライアントに無いので残す */
const textStats = (ss: Stat[]) => ss.filter((s) => !s.value.split(/~|～| \/ /).every((v) => NUMERIC.test(v.replace(/\s/g, ""))));
const fmtStats = (ss: Stat[]) => ss.map((s) => `${s.name} ${s.value}`).join("、");

// 元の値を残す文 (同じ文は 1 度だけ)
function keepOld(rec: { description?: string; notes?: string }, field: "description" | "notes", sentence: string) {
  const cur = rec[field] ?? "";
  if (cur.includes(sentence)) return;
  rec[field] = [cur, sentence].filter(Boolean).join(" ");
}

const log: string[] = [];
const conflicts: string[] = [];
const count: Record<string, number> = {};
const inc = (k: string, n = 1) => (count[k] = (count[k] ?? 0) + n);
const GRADES = ["ノーマル", "マジック", "レア", "エピック", "ユニーク", "レジェンド", "エンシェント"];
const atomic = (v: unknown) => typeof v === "number" || (typeof v === "string" && !/[\/→~～、,]/.test(v) && v.length < 20);

// ---- 新しいアイテム (最新世代の装備でまだ data に無いもの) ----
// 系統: 同じ本体名 (段階・等級違い) か同じセットの既存アイテムの系統、無ければ名前の規則
const SERIES_RULES: [RegExp, string][] = [
  [/^永遠の.+?(の|型)能力強化紋章/, "永遠の能力強化紋章"],
  [/^永遠の.+のタリスマン/, "永遠のタリスマン"],
  [/ヴァズモス/, "ヴァズモス武器"],
  [/メビウスの紋章$/, "メビウスの紋章"],
  [/ブラックドラゴンの.*タリスマン/, "ブラックドラゴンタリスマン"],
  [/^(祝福された)?(オーガダパ|ウンブラ|メルカ|ティタニオン|イベール|クアノス|シャリカ)のタリスマン/, "パラドックスタリスマン"],
  [/^金糸.*\[Ⅱ\]$/, "金糸装備[Ⅱ]"],
  [/^金糸/, "金糸装備"],
];
{
  const existing = new Set([...items, ...materials].map((i) => i.id));
  const seriesByBase = new Map<string, string>();
  for (const it of items) if (it.series && !seriesByBase.has(baseNameOf(it.id))) seriesByBase.set(baseNameOf(it.id), it.series);
  const seriesBySet = new Map<string, string>();
  for (const it of items) {
    const c = ex.items[it.id];
    if (c?.set && it.series && !seriesBySet.has(c.set)) seriesBySet.set(c.set, it.series);
  }
  for (const id of ex.new_items ?? []) {
    if (existing.has(id)) continue;
    const c = ex.items[id];
    const series = seriesByBase.get(baseNameOf(id)) ?? (c.set ? seriesBySet.get(c.set) : undefined) ?? SERIES_RULES.find(([re]) => re.test(id))?.[1];
    items.push({ id, name: id, kind: c.kind as Item["kind"], ...(series ? { series } : {}), refs: [{ source: SRC, note: "ゲームクライアントの値" }] });
    existing.add(id);
    inc("item.new");
    if (verbose) log.push(`新しいアイテム ${id} (${series ?? "系統なし"})`);
  }
  for (const [g, id] of completeGroups(groups, [...items, ...materials])) log.push(`グループに追加 ${g}: ${id}`);
}

// ---- 能力値の名前を全体で統一 ----
for (const it of [...items, ...materials]) for (const s of it.stats ?? []) s.stats = normStats(s.stats);
for (const t of tables) for (const r of t.rows) if (r.stats) r.stats = normStats(r.stats);

// ---- セット効果 ----
const sets: ItemSet[] = [];
const setIdOf = (k: string) => `client-${k}`;
const itemById = new Map([...items, ...materials].map((i) => [i.id, i]));
for (const [k, s] of Object.entries(ex.sets)) {
  const members = s.items.filter((id) => itemById.has(id));
  if (!members.length) continue;
  const series = [...new Set(members.map((id) => itemById.get(id)!.series).filter(Boolean))];
  const name = s.name ?? (series.length === 1 ? series[0]! : `${members[0]} ほか`);
  sets.push({
    id: setIdOf(k),
    name,
    ...(s.text ? { description: s.text } : {}),
    bonuses: s.bonuses.map((b) => ({ count: b.count, ...(b.stats?.length ? { stats: b.stats } : {}), ...(b.skill ? { skill: b.skill } : {}) })),
    refs: [{ source: SRC }],
  });
}
const setIds = new Set(sets.map((s) => s.id));

// ---- アイテム ----
// 名前を推定・仮で付けていた旨と、告知の能力値表の説明 (能力値はクライアント値に置き換えた) は消す
const PROVISIONAL_NAME = /便宜上|仮の名称|正式名称(は)?不明|正式なアイテム名|名称は(推定|類推)|から類推|部位別の正式名称が無い|^\s*stats の「/;
const LEVEL_LABEL = /^\+(\d+)$/;
for (const it of [...items, ...materials]) {
  const c = ex.items[it.id];
  if (!c) continue;
  const before = JSON.stringify(it);
  const from = srcLabel(it.refs);
  const changed: string[] = [];
  const setField = <K extends "grade" | "level" | "slot" | "max_enhance">(k: K, v: Item[K] | undefined, label: string) => {
    if (v === undefined || v === it[k]) return;
    if (it[k] !== undefined && atomic(it[k]) && String(it[k]) !== String(v)) {
      keepOld(it, "description", `${from}では${label}「${it[k]}」。`);
      conflicts.push(`${it.id}: ${label} ${it[k]} → ${v}`);
    }
    it[k] = v;
    changed.push(label);
  };
  if (["weapon", "armor", "accessory", "special_armor", "artifact", "talisman", "jade", "heraldry"].includes(c.kind) && it.kind !== c.kind) {
    it.kind = c.kind as Item["kind"];
    changed.push("種類");
  }
  setField("grade", c.grade, "等級");
  setField("level", c.level, "装備レベル");
  setField("slot", c.slot, "部位");
  setField("max_enhance", c.max_enhance, "最大強化");
  if (!c.enchant_id && it.max_enhance !== undefined && ["weapon", "armor", "accessory", "special_armor"].includes(c.kind)) {
    keepOld(it, "description", `${from}では最大強化「${it.max_enhance}」。`);
    conflicts.push(`${it.id}: 最大強化 ${it.max_enhance} → なし (クライアントでは強化不可)`);
    delete it.max_enhance;
    changed.push("最大強化");
  }
  if (c.set && setIds.has(setIdOf(c.set)) && it.set !== setIdOf(c.set)) {
    it.set = setIdOf(c.set);
    changed.push("セット");
  }
  if (!it.tradable && c.tradable) {
    it.tradable = c.tradable;
    changed.push("取引");
  }
  // 名前を推定・仮で付けていた旨の文は、クライアントの正式名になったので消す
  if (it.description) {
    // 文 (。で終わる) と、統合時に足した「旧「…」: …」の区切りで分け、該当する部分だけ取り除く
    const kept = it.description
      .split(/(?<=。)|(?=\s旧「)/)
      .filter((x) => !PROVISIONAL_NAME.test(x))
      .join("")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (kept !== it.description) {
      if (kept) it.description = kept;
      else delete it.description;
    }
  }
  if (!it.description && c.description) it.description = c.description;

  // 能力値: 基本 + 強化段階 + 細工段階をクライアント値で作り直す
  if (c.stats?.length || c.levels || c.stages) {
    const old = (it.stats ?? []).map((s) => ({ ...s, label: normLabel(s.label) }));
    const fresh: StatSet[] = [];
    if (c.stats?.length) fresh.push({ label: "基本", stats: c.stats.map((s) => ({ ...s })) });
    for (const [lv, ss] of Object.entries(c.levels ?? {})) fresh.push({ label: lv, stats: ss.map((s) => ({ ...s })) });
    for (const [lv, ss] of Object.entries(c.stages ?? {})) fresh.push({ label: lv, stats: ss.map((s) => ({ ...s })) });
    const freshBy = new Map(fresh.map((s) => [s.label, s]));
    const keep: StatSet[] = [];
    const diffs: string[] = [];
    const noEnhance: string[] = [];
    for (const o of old) {
      const lbl = ["基本", "+0", "通常"].includes(o.label) ? "基本" : o.label;
      const f = freshBy.get(lbl);
      if (f) {
        const nums = o.stats.filter((s) => !textStats([s]).length);
        if (nums.length && !sameValues(nums, f.stats)) diffs.push(`${o.label}: ${fmtStats(nums)}`);
        for (const t of textStats(o.stats)) if (!f.stats.some((x) => x.name === t.name)) f.stats.push(t);
        continue;
      }
      if (/^セット効果/.test(o.label) && it.set) continue; // セット効果は sets.json へ
      if (LEVEL_LABEL.test(lbl) && c.levels) {
        diffs.push(`${o.label}: ${fmtStats(o.stats)}`); // クライアントに無い段階 (最大強化を超える等)
        continue;
      }
      if (LEVEL_LABEL.test(lbl) && !c.enchant_id) {
        noEnhance.push(o.label); // クライアントでは強化できない装備
        continue;
      }
      keep.push(o); // 条件付きの能力 (エンシェント追加・増幅オプション・ランダムオプション範囲など) はそのまま
    }
    if (diffs.length) {
      keepOld(it, "description", `${from}の能力値 (クライアントと違う段階): ${diffs.join(" / ")}。`);
      conflicts.push(`${it.id}: 能力値 ${diffs.length} 段階が告知と違う`);
    }
    if (noEnhance.length) {
      keepOld(it, "description", `${from}には ${noEnhance[0]}～${noEnhance[noEnhance.length - 1]} の能力値表があるが、クライアントではこの等級は強化できない。`);
      conflicts.push(`${it.id}: クライアントでは強化不可 (告知に ${noEnhance.length} 段階の表)`);
    }
    if (c.stats_note) fresh[0] && (fresh[0].stats = fresh[0].stats.map((s, i) => (i === 0 ? { ...s, note: c.stats_note } : s)));
    it.stats = [...fresh, ...keep];
    changed.push("能力値");
  }
  if (c.variants_note)
    keepOld(it, "description", c.kind === "weapon" && c.variants_note !== c.name
      ? `一部の職業の武器 (${c.variants_note.slice(0, 40)}) は能力値が少し違う。`
      : "クライアントには同じ名前で能力値が少し違う行もある (ここでは行数の多い方を掲載)。");
  addRef(it.refs, "ゲームクライアントの値");
  if (JSON.stringify(it) !== before) {
    inc("item");
    if (verbose) log.push(`アイテム ${it.id}: ${changed.join("・")}`);
  }
}

// ---- 強化表 ----
const qtyOk = (q: Qty["qty"]) => typeof q === "number";
const PROTECT = /ゼリー/;
function clientRow(level: string, c: CRow, prev?: EnhanceRow): EnhanceRow {
  const row: EnhanceRow = { level, rate: c.rate };
  if (c.gold) row.gold = c.gold;
  const mats: Qty[] = c.materials.map((m) => ({ item: matId(m), qty: m.qty }));
  if (mats.length) row.materials = mats;
  if (prev?.on_fail) row.on_fail = prev.on_fail;
  else if (c.rate < 100) {
    const parts: string[] = [];
    if (c.break_rate) parts.push(`破壊 ${c.break_rate}%`);
    if (c.down && (c.down[0] || c.down[1])) parts.push(c.down[0] === c.down[1] ? `-${c.down[0]}` : `-${c.down[0]}～-${c.down[1]}`);
    if (c.protect_qty) parts.push(`保護ゼリー ${c.protect_qty} 個で防止`);
    if (parts.length) row.on_fail = parts.join("、");
  }
  if (prev?.rate_text && !/[\d.]+%/.test(prev.rate_text)) row.rate_text = prev.rate_text;
  return row;
}
// クライアントの素材名 → data の id (名前がそのまま無ければ、既存の表で同じ位置にあった素材)
const allIds = new Set([...items, ...materials].map((i) => i.id));
const matAlias = new Map<string, string>();
const GRADE_PAREN = /\((ノーマル|マジック|レア|エピック|ユニーク|レジェンド|エンシェント|下級|中級|上級|ヒロイック|\d+段階)\)$/;
function matId(m: CMat) {
  if (allIds.has(m.item)) return m.item;
  if (matAlias.has(m.item)) return matAlias.get(m.item)!;
  // 職業ごとに別アイテムの素材 (紅月の核(アルタ) など) は職業を外した名前にまとめる
  const base = m.item.replace(/\([^)]*\)$/, "");
  if (base !== m.item && !GRADE_PAREN.test(m.item)) return base;
  return m.item;
}
const missingMats = new Map<string, CMat>();

const appliesClient = (t: EnhanceTable) => t.applies_to.some((a) => ex.items[a]);
const outTables: EnhanceTable[] = [];
const coveredEnchants = new Set<string>();
for (const r of [...tables, ...recipes]) dropLegacy(r);
// 以前の空欄補完の出典注記を外す (クライアント値を使っていないレコードは出典ごと外す)
for (const rec of [...tables, ...recipes] as { refs: Ref[] }[]) {
  const i = rec.refs.findIndex((r) => r.source === SRC && r.note === LEGACY_NOTE);
  if (i >= 0) rec.refs.splice(i, 1);
}
for (const t of tables) {
  const c = ex.enhance[t.id];
  if (!c) {
    outTables.push(t);
    continue;
  }
  coveredEnchants.add(String(c.enchant_id));
  const overseas = isOverseas(t.refs);
  const from = srcLabel(t.refs);
  // 既存の行の素材名とクライアントの素材名の対応 (同じ個数の素材)
  for (const row of t.rows) {
    const cr = c.rows[row.level];
    if (!cr) continue;
    for (const pm of row.materials ?? []) {
      if (!qtyOk(pm.qty) || PROTECT.test(pm.item) || allIds.has(pm.item) === false) continue;
      const cm = cr.materials.filter((m) => m.qty === pm.qty && m.item !== pm.item && !allIds.has(m.item));
      if (cm.length === 1 && !matAlias.has(cm[0].item)) matAlias.set(cm[0].item, pm.item);
    }
  }
  const diffs: string[] = [];
  const rows: EnhanceRow[] = [];
  const statsMoved = appliesClient(t);
  for (const row of t.rows) {
    const cr = c.rows[row.level];
    if (!cr) {
      rows.push(statsMoved ? (({ stats, ...r }) => r)(row) : row);
      continue;
    }
    const nr = clientRow(row.level, cr, row);
    if (!statsMoved && row.stats) nr.stats = row.stats;
    if (row.rate !== undefined && Math.abs(row.rate - cr.rate) > 1e-6) diffs.push(`${row.level} 確率${row.rate}%`);
    if (typeof row.gold === "number" && row.gold !== (cr.gold || undefined)) diffs.push(`${row.level} ${row.gold}G`);
    const pq = (row.materials ?? []).filter((m) => qtyOk(m.qty) && !PROTECT.test(m.item)).map((m) => `${m.item}×${m.qty}`).sort();
    const cq = (nr.materials ?? []).map((m) => `${m.item}×${m.qty}`).sort();
    if (row.materials && pq.join() !== cq.join() && pq.some((x) => !cq.includes(x))) diffs.push(`${row.level} ${pq.join("+")}`);
    rows.push(nr);
    inc("enhance.row");
  }
  t.rows = rows;
  if (diffs.length && !overseas) {
    keepOld(t, "notes", `${from}では ${diffs.slice(0, 12).join("、")}${diffs.length > 12 ? ` ほか${diffs.length - 12}件` : ""}。`);
    conflicts.push(`${t.id}: ${diffs.length} 箇所が告知と違う`);
  }
  if (overseas) {
    // 海外版だけの表 → 日本版クライアントの表に置き換え (全段階)
    const all = ex.enchants[String(c.enchant_id)] ?? {};
    const off = c.level_offset;
    t.rows = Object.entries(all).map(([lv, cr]) => clientRow(off ? `[+${Number(lv) - off}]` : `+${lv}`, cr));
    t.name = t.name.replace(/\s*\((CN|KR)版\)$/, "").replace(/\s*\(海外版\)$/, "");
    t.notes = `日本版クライアントの値 (${ex.pak_date}時点)。以前は海外版の表 (${t.refs.map((r) => r.source).join(", ")}) を掲載していた。`;
    t.refs = [{ source: SRC }];
    log.push(`海外版の表を置き換え ${t.id}`);
    inc("enhance.overseas");
  } else addRef(t.refs, "確率・費用・素材");
  outTables.push(t);
}

// クライアントと対応の取れる強化表の無いアイテムに、強化 ID ごとの表を作る (告知の表が範囲だけ等で対応できない場合も)
const tableItems = new Set(outTables.filter((t) => ex.enhance[t.id]).flatMap((t) => t.applies_to));
const byEnchant = new Map<string, string[]>();
for (const [id, c] of Object.entries(ex.items)) {
  if (!c.enchant_id || !allIds.has(id) || tableItems.has(id) || coveredEnchants.has(String(c.enchant_id))) continue;
  byEnchant.set(String(c.enchant_id), [...(byEnchant.get(String(c.enchant_id)) ?? []), id]);
}
// 既に表がある強化 ID なら、その表の対象に足す
for (const t of outTables) {
  const eid = Object.entries(ex.enhance).find(([tid]) => tid === t.id)?.[1].enchant_id;
  if (eid === undefined) continue;
  const extra = byEnchant.get(String(eid));
  if (extra) {
    t.applies_to = [...new Set([...t.applies_to, ...extra])];
    byEnchant.delete(String(eid));
  }
}
for (const [eid, ids] of byEnchant) {
  const all = ex.enchants[eid];
  if (!all || !Object.keys(all).length) continue;
  const name = ids.length === 1 ? ids[0] : `${ids[0]} ほか${ids.length - 1}件`;
  const prev = outTables.findIndex((t) => t.id === `client-enh-${eid}`);
  if (prev >= 0) outTables.splice(prev, 1); // 再実行時は作り直す
  else inc("enhance.new");
  outTables.push({
    id: `client-enh-${eid}`,
    name: `${name} 強化`,
    kind: "enhance",
    applies_to: ids,
    rows: Object.entries(all).map(([lv, cr]) => clientRow(`+${lv}`, cr)),
    notes: `日本版クライアントの値 (${ex.pak_date}時点)。行の段階は強化後の段階。`,
    refs: [{ source: SRC }],
  });
}
// 海外版だけの表で、対象のアイテムがすべて日本版クライアントの強化表を持つものは削除する
const enchantCovered = new Set([...coveredEnchants, ...byEnchant.keys()]);
for (let i = outTables.length - 1; i >= 0; i--) {
  const t = outTables[i];
  if (ex.enhance[t.id] || !isOverseas(t.refs) || t.kind !== "enhance") continue;
  const eids = t.applies_to.map((a) => ex.items[a]?.enchant_id);
  if (eids.length && eids.every((e) => e !== undefined && enchantCovered.has(String(e)))) {
    log.push(`海外版の表を削除 (日本版クライアントの表あり) ${t.id}`);
    outTables.splice(i, 1);
    inc("enhance.overseas_removed");
  }
}
// 新しい表の素材で data に無いものはスタブを作る
for (const t of outTables)
  for (const r of t.rows)
    for (const m of r.materials ?? []) if (!allIds.has(m.item)) missingMats.set(m.item, { item: m.item, qty: 0 });

// ---- レシピ ----
const RATE_TYPES = new Set<Recipe["type"]>(["craft", "evolve", "upgrade", "refine"]);
const strip = (s: string) => s.replace(/\((マジック|レア|エピック|ユニーク|レジェンド)\)$/, "").normalize("NFKC").replace(/[\s　]+/g, "");
for (const r of recipes) {
  const c = ex.recipes[r.id];
  if (!c) continue;
  const from = srcLabel(r.refs);
  const diffs: string[] = [];
  if (r.gold !== undefined && r.gold !== c.gold) diffs.push(`${r.gold}G`);
  if (c.gold) r.gold = c.gold;
  else if (r.gold !== undefined && c.gold === 0) delete r.gold;
  if (RATE_TYPES.has(r.type)) {
    if (r.rate !== undefined && Math.abs(r.rate - c.rate) > 1e-6) diffs.push(`成功率${r.rate}%`);
    r.rate = c.rate;
  }
  for (const m of r.materials) {
    const cm = c.materials.find((x) => strip(x.item) === strip(m.item));
    if (!cm) continue;
    if (typeof m.qty === "number" && m.qty !== cm.qty) diffs.push(`${m.item}×${m.qty}`);
    else if (typeof m.qty !== "number") log.push(`個数補完 ${r.id}: ${m.item} ${m.qty} → ${cm.qty}`);
    m.qty = cm.qty;
  }
  if (diffs.length) {
    keepOld(r, "notes", `${from}では ${diffs.join("、")}。`);
    conflicts.push(`${r.id}: ${diffs.join("、")}`);
  }
  addRef(r.refs, "ゴールド・成功率・個数");
  inc("recipe");
}

// ---- 足りない素材のスタブ ----
for (const [name] of missingMats) {
  materials.push({ id: name, name, kind: "material", refs: [{ source: SRC, note: "強化素材" }] });
  allIds.add(name);
  inc("material.stub");
}

// ---- 参照されなくなった出典 ----
const used = new Set<string>();
for (const coll of [items, materials, outTables, recipes, sets, await readJson<any[]>("data/drops.json"), await readJson<any[]>("data/dungeons.json"), groups] as any[][])
  for (const rec of coll) for (const r of rec.refs ?? []) used.add(r.source);
const outSources = sources.filter((s) => used.has(s.id));
for (const s of sources) if (!used.has(s.id)) log.push(`参照されなくなった出典を削除 ${s.id}`);

console.log(Object.entries(count).map(([k, v]) => `${k}=${v}`).join(" ") || "変更なし");
if (matAlias.size) console.log(`素材名の対応 (クライアント → data): ${[...matAlias].map(([a, b]) => `${a}→${b}`).join(", ")}`);
for (const l of log) if (verbose || !l.startsWith("個数補完")) console.log("  " + l);
if (conflicts.length) {
  console.log(`\nクライアント値で上書きした食い違い ${conflicts.length} 件 (元の値は description/notes に残した):`);
  for (const c of verbose ? conflicts : conflicts.slice(0, 40)) console.log("  " + c);
  if (!verbose && conflicts.length > 40) console.log(`  ... ほか ${conflicts.length - 40} 件 (-v で全件)`);
}
if (!dry) {
  await writeJson("data/sources.json", outSources);
  await writeJson("data/items.json", items);
  await writeJson("data/materials.json", materials);
  await writeJson("data/enhance_tables.json", outTables);
  await writeJson("data/recipes.json", recipes);
  await writeJson("data/sets.json", sets);
  await writeJson("data/item_groups.json", groups);
}
