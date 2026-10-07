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
//    その後、中身が同じ強化 ID ごとに表を 1 つ (client-enh-<最小の強化ID>) にまとめる。告知の版違い・部位違い・海外版・
//    費用変更のお知らせは吸収し、日本版の出典は refs、各表の注記は notes に残す (旧 id は ingest/table_aliases.json で転送)。
//    クライアントの強化 ID と結び付かない表はそのまま残す。
//  - レシピ: 照合できたもの (itemcompoundtable) はゴールド・成功率・素材の個数をクライアント値にする。
//  - セット効果: data/sets.json をクライアント値で作る。
//  - 分解: 告知の分解レシピが無い装備に、クライアントの分解表からレシピ (client-dis-*) を作る。
//  - クリア報酬: ダンジョンのクリア報酬の箱 (金箱・銀箱) の表 (client-clear-*) を作る。
//  - エリア報酬: ネストの中間 (エリア) 報酬の表 (client-area-*)、マップのトリガーの報酬の表 (client-trig-*) を作る。
//  - ネストの最終報酬: ボスマップのトリガーの報酬を種類ごとに (client-final-<クリアID>-<種類>)。階層で変わるものは item_columns。
//  - 討伐報酬: 次元の狭間系のボス・ルートの魔物を倒したときの報酬 (client-kill-<クリアID>-<ドロップグループ>)。
//    ドロップ表の確率はクライアントで 0 にされているので、分解とクリア報酬は出る候補と個数だけ。
//  - ランダムオプション: 再付与できるランダムオプション (古竜・金竜・金糸装備、竜珠など) の行・候補・確率・再付与の費用の表
//    (data/option_tables.json、client-opt-<再付与グループ>-<最初の候補表>)。クライアントの値だけで毎回作り直す。
//    同じ内容の告知・海外版の表とレシピ (箱舟の力の費用) は吸収して消し (OPTION_ABSORB)、出典と食い違いを残す (旧 id は ingest/option_aliases.json)。
//  - 能力値の名前は表記ゆれを 1 つに揃える (STAT_NAMES)。
// export.json は非公開のツール (dnr-client) が書き出す。npm run merge / rename:ids の後は export.py → apply:client を再実行する。
import { readFile, writeFile } from "node:fs/promises";
import type { DropTable, EnhanceRow, EnhanceTable, Item, ItemGroup, ItemSet, OptionReroll, OptionTable, Qty, Recipe, Ref, Source, Stat, StatSet } from "../src/types.ts";
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
  client_id: number; name: string; kind: string; slot?: string; grade?: string; icon?: number; level?: number; tier?: string; label?: string;
  stats?: CStat[]; stats_note?: string; variants_note?: string; enchant_id?: number; max_enhance?: number;
  levels?: Record<string, CStat[]>; stages?: Record<string, CStat[]>; tradable?: string; description?: string; set?: string;
}
interface Export {
  source: string;
  pak_date: string;
  items: Record<string, CItem>;
  keep: Record<string, string>;
  // keep のうち中身の強化 ID が 1 つに決まるもの (総称 → 強化 ID)
  keep_enchant?: Record<string, number>;
  enhance: Record<string, { enchant_id: number; level_offset: number; rows: Record<string, CRow>; max_level: number }>;
  enchants: Record<string, Record<string, CRow>>;
  // 製作: compound_id / 交換: shop_row (+where, result_qty) / 進化: change_row (+accelerators)
  recipes: Record<string, { compound_id?: number; shop_row?: number; change_row?: number; rate?: number; gold?: number; materials?: { item: string; qty: number }[]; where?: string; result_qty?: number; accelerators?: string[]; from_level?: number }>;
  new_recipes: (Omit<Recipe, "refs"> & { accelerators?: string[]; note?: string })[];
  // レシピ id → 鍛冶屋の生産表の場所 (「鍛冶屋 → アイテム生産 → タブ → …」)
  recipe_where?: Record<string, string>;
  // all: 中身を全て獲得する袋 (_Type 112)
  boxes: Record<string, { client_id: number; select: boolean; all?: boolean; entries: { item: string; qty: number; rate?: number }[] }>;
  // 分解の結果 (確率はクライアントに無い)。levels は強化段階の範囲 [from, to]
  // plus0_only: 強化できる装備だが +0 の分解表しか無い
  dismantles?: Record<string, { client_id: number; gold?: number; plus0_only?: boolean; note?: string; rows: { levels: [number, number]; entries: { item: string; qty: number }[] }[] }>;
  // ダンジョンのクリア報酬の箱 (確率はクライアントに無い)。counts は箱の種類ごとの個数
  // ネストのエリア (関門) 報酬 (nestareadrop.lua)。times はパーティー員 1 人あたりの回数
  nest_areas?: Record<string, { map_id: number; area: number; mode?: string; rows: { floors?: string; times?: number; entries: { item: string; qty: number }[] }[] }[]>;
  // マップのトリガーが落とす報酬 (trigger.ini)。key はマップのファイル名 (表の id に使う)
  map_triggers?: Record<string, { key: string; rows: { trigger: string; floors?: string; entries: { item: string; qty: number }[] }[] }>;
  // 一般ネスト (12 ネスト) のクリア報酬。common = 共通、nests = ネスト固有 (ボスマップのトリガーが共通と同時に落とすグループ)
  general_nests?: { common: NestFloorRow[]; nests: { name: string; map_id: number; group: number; rows: NestFloorRow[] }[] };
  // ラビリンス (メイズモード) の報酬。stage = ステージクリア時のワープ、erosion = 侵蝕モードのクリア。groups は中身の同じドロップグループ
  labyrinth?: Partial<Record<"stage" | "erosion", { groups: number[]; rows: NestFloorRow[] }[]>>;
  // ネストの最終報酬 (ボスマップのトリガー)。kind = final / bless / double / welcome / key_box / sunset / risky。
  // party = 人数ごとのトリガーの中身が同じでまとめた、requires / rates = 条件のアイテムと、その人数ごとの確率 (%)
  nest_finals?: Record<
    string,
    {
      key: number;
      kind: string;
      groups: number[];
      party?: boolean;
      requires?: { item: string; qty: number[] }[];
      rates?: [number, number][];
      rows: { from?: string; floors?: string; entries: { item: string; qty: number | string }[] }[];
    }[]
  >;
  // 魔物の討伐報酬 (次元の狭間系)。kind = boss / heraldry / talisman / world / event、group = 魔物のドロップグループ
  kills?: Record<
    string,
    { key: number; kind: string; group: number; monsters: string[]; rows: { floors?: string; entries: { item: string; qty: number | string }[] }[] }[]
  >;
  // ランダムオプション (潜在能力)。lines = 行ごとの候補表、parts = 総称のアイテムに当たる部位
  options?: Record<
    string,
    {
      group: number;
      lines: string[];
      pools: Record<string, { text: string; rate: number }[]>;
      rerolls: OptionReroll[];
      items: string[];
      parts?: Record<string, string>;
    }
  >;
  clears?: Record<string, { clear_id: number; show: number; select: number; counts: Record<string, number>; boxes: { box: string; floors?: string; entries: { item: string; qty: number }[] }[] }[]>;
  materials: Record<string, { client_id: number; kind: string; grade?: string; description?: string }>;
  sets: Record<string, { name: string | null; text: string | null; bonuses: { count: number; stats?: CStat[]; skill?: string }[]; items: string[] }>;
  // 総称のアイテム → 中身 (説明文「次の N種のアイテムが登場する。」)
  members?: Record<string, string[]>;
  // data の id → アイコン番号 (_IconImageIndex)
  icons?: Record<string, number>;
  new_items: string[];
}

const ex = await readJson<Export>("ingest/client/export.json");
const sources = await readJson<Source[]>("data/sources.json");
const items = await readJson<Item[]>("data/items.json");
const materials = await readJson<Item[]>("data/materials.json");
const tables = await readJson<EnhanceTable[]>("data/enhance_tables.json");
const recipes = await readJson<Recipe[]>("data/recipes.json");
const groups = await readJson<ItemGroup[]>("data/item_groups.json");

type NestFloorRow = { floors: string; entries: { item: string; qty: number | string }[] };
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
// 出典の注記 (注記自体に「・」を含むので、区切りで分ける前にまとめて取り出す)
const REF_NOTES = ["ゲームクライアントの値", "確率・費用・素材", "進化の組み合わせ", "交換の費用", "ゴールド・成功率・個数", "レシピ・強化・箱の素材"];
const addRef = (refs: Ref[], note?: string) => {
  const cur = refs.find((r) => r.source === SRC);
  if (!cur) refs.push(note ? { source: SRC, note } : { source: SRC });
  else {
    let rest = cur.note ?? "";
    const known = REF_NOTES.filter((k) => rest.includes(k));
    for (const k of known) rest = rest.split(k).join("");
    const parts = [...rest.split("・").filter((x) => x && x !== LEGACY_NOTE), ...known];
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
// 同じ段階に同じ名前の能力が 2 つあり片方が割合の値なら、割合の方は「…%」の能力 (ファンWiki の「攻撃力 38.00％」= 物魔攻撃% など)
const PCT_NAME: Record<string, string> = { 攻撃力: "物魔攻撃%", 物魔防御: "物魔防御%" };
const normStats = (ss: Stat[] = []) => {
  const out = ss.map((s) => {
    const v = typeof s.value === "string" ? s.value.replace(/％/g, "%") : s.value;
    return { ...s, value: v, name: statName.get(s.name) ?? s.name };
  });
  return out.map((s) => {
    if (typeof s.value !== "string" || !/%$/.test(s.value) || s.name.endsWith("%")) return s;
    if (out.filter((x) => x.name === s.name && (x.note ?? "") === (s.note ?? "")).length < 2) return s;
    return { ...s, name: PCT_NAME[s.name] ?? `${s.name}%` };
  });
};
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
  [/ブラックドラゴンの.*タリスマン|^(祝福された)?(オーガダパ|ウンブラ|メルカ|ティタニオン)のタリスマン/, "ブラックドラゴンタリスマン"],
  [/^(祝福された)?(イベール|クアノス|シャリカ)のタリスマン/, "パラドックスタリスマン"],
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
/** 文 (括弧の外の「。」まで) と、統合時に足した「旧「…」: …」の区切りで分ける */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (depth === 0 && cur && /\s/.test(ch) && text.startsWith("旧「", i + 1)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
    if ("(（「".includes(ch)) depth++;
    else if (")）」".includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === "。" && depth === 0) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}
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
    const kept = splitSentences(it.description)
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
    // スキル竜珠: クライアントにはスキル攻撃力しか無いので、告知にだけある能力 (再使用時間短縮・属性) は名前で分けて残す
    const freshNames = new Set(fresh.flatMap((s) => s.stats.map((x) => x.name)));
    const ownOnly = (o: StatSet) => (it.series === "スキル竜珠" ? o.stats.filter((s) => !freshNames.has(s.name) && !textStats([s]).length) : []);
    const keep: StatSet[] = [];
    const diffs: string[] = [];
    const noEnhance: string[] = [];
    for (const o of old) {
      // ユニーク等級の項目にあったレジェンド (L) の能力値: レジェンドの項目にクライアントの値があれば外す
      const legend = it.id.replace(/\(ユニーク\)$/, "(レジェンド)");
      if (o.label === "(L)" && legend !== it.id && ex.items[legend]?.stats?.length) {
        keepOld(it, "description", `(L) の能力値は「${legend}」にクライアントの値で掲載。`);
        continue;
      }
      const lbl = ["基本", "+0", "通常"].includes(o.label) ? "基本" : o.label;
      const f = freshBy.get(lbl);
      if (f) {
        const extra = ownOnly(o);
        const nums = o.stats.filter((s) => !textStats([s]).length && !extra.includes(s));
        if (nums.length && !sameValues(nums, f.stats)) diffs.push(`${o.label}: ${fmtStats(nums)}`);
        for (const t of [...extra, ...textStats(o.stats)]) if (!f.stats.some((x) => x.name === t.name)) f.stats.push(t);
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

const replacedOverseas = new Set<string>();
const appliesClient = (t: EnhanceTable) => t.applies_to.some((a) => ex.items[a]);
const outTables: EnhanceTable[] = [];
for (const r of [...tables, ...recipes]) dropLegacy(r);
// 告知の表で対象が書かれていない・総称のままのもの → 対象のアイテム (ドラフトは告知の記載どおりに残し、ここで補う)。
// data/ に反映済みなら export.py が段階の対応を取れる (npm run merge の直後の 1 回目は注記・出典だけ統合先に載る)
const ANCIENT_ARMOR = ["生命の古代ヘルム", "東方の古代アーマー", "黎明の古代ボトム", "密林の古代グローブ", "深淵の古代ブーツ"];
const APPLIES_FILL: Record<string, string[]> = {
  "n1332-iona-ring-enhance": ["[リング]アイオナの誓い"],
  "n1332-iona-necklace-enhance": ["[ネックレス]アイオナの覚悟"],
  "n1332-iona-earring-enhance": ["[イヤリング]アイオナの聲"],
  "n1376-legend-cloning-armor": ["ヘルム", "アーマー", "ボトム", "グローブ", "ブーツ"].map((s) => `クローニング${s}(レジェンド)`),
  "n1376-legend-cloning-weapon": ["メインウェポン", "サブウェポン"].map((s) => `クローニング${s}(レジェンド)`),
  // 原文は「古代人防具」で [Ⅰ]/[Ⅱ] の区別なし
  "n1276-ancient-armor-enhance-cost": [...ANCIENT_ARMOR, ...ANCIENT_ARMOR.map((a) => `${a}[Ⅱ]`)],
};
for (const t of tables) {
  const fill = APPLIES_FILL[t.id];
  if (fill && fill.some((a) => !t.applies_to.includes(a))) t.applies_to = [...new Set([...t.applies_to.filter((a) => !/^\[[ⅠⅡ]\]古代防具$/.test(a)), ...fill])];
}
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
  const overseas = isOverseas(t.refs);
  if (overseas) replacedOverseas.add(t.id);
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
  // 能力値をアイテム側に移すのは、クライアントに強化段階の能力値がある表だけ (無ければ表の stats を残す)
  const statsMoved = t.applies_to.some((a) => ex.items[a]?.levels);
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

// ---- 強化表の統合 ----
// クライアントの強化 ID の中身 (全段階の確率・ゴールド・素材・保護・破壊・下降) が同じものを 1 グループにし、
// グループごとに表を 1 つにする (部位違い・告知の版違い・海外版・費用変更のお知らせなどをまとめる)。
//  - id は client-enh-<グループの最小の強化 ID>。吸収した表の id は ingest/table_aliases.json で転送する。
//  - 行はクライアントの全段階 (+n = 強化後の段階)。失敗時・確率の補足・能力値は、段階の対応が取れた表から新しい日本版の告知を優先して引き継ぐ。
//  - 日本版の出典は refs に残し、各表の注記は notes に 1 行ずつ残す。海外版は「以前は海外版の表を掲載していた」とだけ残す。
//  - 複数のグループにまたがる表 (全スキル竜珠の +16～+20 など) は、各グループの出典と注記に載せる。
//  - 総称のまま残すアイテム (ex.keep) も、中身の強化 ID が決まるもの (ex.keep_enchant) は同じように扱う。
const CLIENT_NOTE = /^日本版クライアントの値 \([^)]*時点\)。(行の段階は強化後の段階。)?/;
const HEADER = `日本版クライアントの値 (${ex.pak_date}時点)。行の段階は強化後の段階。`;
const OVERSEAS_NOTE = /以前は海外版の表 \(([^)]*)\) を掲載していた。/;
// 名前を導出すると不自然になるグループ (id → 名前)
const NAME_OVERRIDE: Record<string, string> = {
  "client-enh-847258479": "アクセサリー共通 (アルゼンタの冷徹・ジェレイントの守護・ゴールド/シルバードラゴンほか) 強化",
  "client-enh-847258592": "クローニング武器(ユニーク) 強化",
  "client-enh-847258616": "クローニング装備(ユニーク) 強化",
  "client-enh-847258658": "クローニング防具(レジェンド) 強化",
  "client-enh-847258770": "ヘイズフロストドラゴン武器(レジェンド) 強化",
  "client-enh-847258771": "ヘイズフロストドラゴン防具(レジェンド) 強化",
  "client-enh-847258776": "ヘイズフロストドラゴンアクセサリー(レジェンド) 強化",
  "client-enh-847258796": "古代の変異型防御竜珠(エンシェント) 強化",
  "client-enh-847258837": "クローニング ウィング・テール・デカール(レジェンド) 強化",
  "client-enh-847258840": "クローニングアクセサリー(レジェンド) 強化",
  "client-enh-847258843": "クローニング武器(レジェンド) 強化",
  "client-enh-847258847": "アイオナ・白竜アクセサリー 強化",
  "client-enh-847258853": "古竜武器 強化",
  "client-enh-847258855": "古竜防具・古代人防具[Ⅱ] 強化",
  "client-enh-847258874": "金糸防具 強化",
  "client-enh-847258879": "金糸武器 強化",
  "client-enh-847258881": "金糸アクセサリー 強化",
  "client-enh-847258811": "ヘイズフロストドラゴンの月食防御竜珠(エンシェント) 強化",
  "client-enh-847258812": "ヘイズフロストドラゴンの月食攻撃竜珠(エンシェント) 強化",
  "client-enh-847258892": "崩壊の竜珠(エピック) 強化",
  "client-enh-847258912": "金糸防具[Ⅱ] 強化",
  "client-enh-847258917": "金糸武器[Ⅱ] 強化",
};
// 対象アイテム名に共通部分が無くても統合してよいグループ (別系統が同じ強化 ID を共有しているもの)
const MERGE_ALLOW = new Set<string>([
  "client-enh-847258855", // 古竜の古代防具と古代人防具[Ⅱ] (同じ強化 ID)
]);
// 進化で強化値を引き継ぐ装備: 進化前の強化 ID の at 段階までの後に「進化」の行を挟み、進化後の強化 ID の at+1 段階以降を続けて 1 つの表にする
const CHAINS: { before: string; after: string; at: number; text: string }[] = [
  {
    before: "847258847", // アイオナアクセサリー
    after: "847258925", // 白竜アクセサリー
    at: 15,
    text: "+15 のアイオナアクセサリーは、そのままでは +16 に強化できない。白竜の氷片で白竜アクセサリーに進化させる (強化値は +15 のまま引き継ぐ) と、+16 以降に強化できる。",
  },
];

const eidOf = (a: string) => {
  const e = ex.items[a]?.enchant_id ?? ex.keep_enchant?.[a];
  return e && Object.keys(ex.enchants[String(e)] ?? {}).length ? String(e) : undefined;
};
const contentKey = (rows: Record<string, CRow>) =>
  JSON.stringify(
    Object.entries(rows)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([lv, r]) => [lv, r.rate, r.gold, r.materials.map((m) => `${m.item}×${m.qty}`).sort(), r.protect_qty, r.break_rate ?? 0, r.down ?? [0, 0]]),
  );
const keyOfEid = new Map(Object.entries(ex.enchants).map(([eid, rows]) => [eid, contentKey(rows)]));
const eidsOfKey = new Map<string, string[]>();
for (const [eid, k] of keyOfEid) eidsOfKey.set(k, [...(eidsOfKey.get(k) ?? []), eid].sort((a, b) => Number(a) - Number(b)));
const itemsOfKey = new Map<string, string[]>();
for (const a of [...Object.keys(ex.items), ...Object.keys(ex.keep_enchant ?? {})]) {
  const e = eidOf(a);
  if (!e || !allIds.has(a)) continue;
  const k = keyOfEid.get(e)!;
  if (!itemsOfKey.get(k)?.includes(a)) itemsOfKey.set(k, [...(itemsOfKey.get(k) ?? []), a]);
}
const chainOfKey = new Map(CHAINS.map((c) => [keyOfEid.get(c.before)!, c]));
const chainedKey = new Map(CHAINS.map((c) => [keyOfEid.get(c.after)!, keyOfEid.get(c.before)!]));
const groupKey = (k: string) => chainedKey.get(k) ?? k;
for (const [after, before] of chainedKey) {
  itemsOfKey.set(before, [...(itemsOfKey.get(before) ?? []), ...(itemsOfKey.get(after) ?? [])]);
  itemsOfKey.delete(after);
}
const keysOfTable = (t: EnhanceTable) => {
  const ks = new Set<string>();
  for (const a of t.applies_to) {
    const e = eidOf(a);
    if (e) ks.add(groupKey(keyOfEid.get(e)!));
  }
  const m = /^client-enh-(\d+)$/.exec(t.id);
  if (m && keyOfEid.has(m[1])) ks.add(groupKey(keyOfEid.get(m[1])!));
  return [...ks];
};
// 行の段階 → クライアントの段階 (対応の取れない表は undefined)
const levelOf = (s: string) => {
  if (/[～~〜]/.test(s)) return undefined;
  const m = /→\s*\+?\s*(\d+)/.exec(s) ?? /\+\s*(\d+)/.exec(s) ?? /^\[?\+?(\d+)\]?(?:段階)?$/.exec(s.trim());
  return m ? Number(m[1]) : undefined;
};
const levelMap = (t: EnhanceTable): Map<number, EnhanceRow> | undefined => {
  const off = t.id.startsWith("client-enh-") ? 0 : ex.enhance[t.id]?.level_offset;
  if (off === undefined) return undefined;
  const m = new Map<number, EnhanceRow>();
  for (const r of t.rows) {
    const lv = r.evolve ? undefined : levelOf(r.level);
    if (lv !== undefined) m.set(lv + off, r);
  }
  return m;
};
const isJpOfficial = (t: EnhanceTable) => t.refs.some((r) => sourceById.get(r.source)?.region === "JP" && sourceById.get(r.source)?.kind === "official" && r.source !== SRC);
const tableDate = (t: EnhanceTable) =>
  t.refs.map((r) => (r.source === SRC ? "" : (sourceById.get(r.source)?.published_at ?? ""))).sort().at(-1) ?? "";
// 海外版の表 (前回までに日本版クライアントの値へ置き換えた表は注記で分かる)
const wasOverseas = (t: EnhanceTable) => replacedOverseas.has(t.id) || isOverseas(t.refs) || OVERSEAS_NOTE.test(t.notes ?? "");
// 引き継ぐ順: 日本版の告知 (新しい順) → 日本版のその他 → 統合済みの表 → 海外版
const priority = (t: EnhanceTable) => [t.id.startsWith("client-enh-") ? 1 : wasOverseas(t) ? 0 : isJpOfficial(t) ? 3 : 2, tableDate(t)] as const;
const byPriority = (a: EnhanceTable, b: EnhanceTable) => {
  const [pa, da] = priority(a);
  const [pb, db] = priority(b);
  return pb - pa || db.localeCompare(da) || a.id.localeCompare(b.id);
};
const tidyName = (n: string) => {
  let s = n.trim();
  for (let i = 0; i < 3; i++)
    s = s
      .replace(/\s*\((CN|KR|海外)版\)$/, "")
      .replace(/\s*\(\d+年\d+月\)$/, "")
      .replace(/\s*\(?\+\d+[～~]\+\d+\)?$/, "")
      .replace(/\s*(強化費用変更|強化確率|強化段階別情報|段階別強化材料|強化詳細.*|成長|強化)$/, "")
      .replace(/の$/, "")
      .trim();
  return `${s} 強化`;
};
const commonName = (ids: string[]) => {
  if (ids.length === 1) return ids[0];
  let best = "";
  const [a, ...rest] = ids;
  for (let i = 0; i < a.length; i++)
    for (let j = a.length; j > i + best.length; j--) {
      const sub = a.slice(i, j);
      if (rest.every((x) => x.includes(sub))) {
        best = sub;
        break;
      }
    }
  return best.replace(/^[\s\]\)】・の]+|[\s\[\(【・の]+$/g, "");
};

const tableAliases = await readJson<Record<string, string>>("ingest/table_aliases.json").catch(() => ({}) as Record<string, string>);
{
  // 表 → 属するグループ。1 グループなら吸収、複数なら出典・注記だけ各グループへ
  const full = new Map<string, EnhanceTable[]>();
  const partial = new Map<string, EnhanceTable[]>();
  for (const t of outTables) {
    if (t.kind !== "enhance") continue;
    const ks = keysOfTable(t);
    for (const k of ks) (ks.length === 1 ? full : partial).set(k, [...((ks.length === 1 ? full : partial).get(k) ?? []), t]);
  }
  const removed = new Map<string, string>(); // 表 id → 統合先の id
  const created = new Map<string, EnhanceTable>(); // 統合先の id → 表 (最初の吸収元の位置に置く)
  for (const [k, eids] of eidsOfKey) {
    if (chainedKey.has(k)) continue; // 進化後の強化 ID は進化前のグループで扱う
    const chain = chainOfKey.get(k);
    const members = (full.get(k) ?? []).slice().sort(byPriority);
    const extras = (partial.get(k) ?? []).slice().sort(byPriority);
    const ownItems = itemsOfKey.get(k) ?? [];
    if (!members.length && !ownItems.length) continue;
    const id = `client-enh-${eids[0]}`;
    const applies = [...new Set([...members.flatMap((t) => t.applies_to), ...ownItems])];
    if (commonName(applies).length < 2 && !MERGE_ALLOW.has(id) && !chain && members.length > 1) {
      log.push(`要確認: 対象アイテム名に共通部分が無いので統合しない ${members.map((t) => t.id).join(", ")}`);
      continue;
    }
    // 行: クライアントの全段階
    const all: Record<string, CRow> = chain
      ? Object.fromEntries([
          ...Object.entries(ex.enchants[chain.before]).filter(([lv]) => Number(lv) <= chain.at),
          ...Object.entries(ex.enchants[chain.after]).filter(([lv]) => Number(lv) > chain.at),
        ])
      : ex.enchants[eids[0]];
    const maps = members.map((t) => [t, levelMap(t)] as const);
    // 能力値は、対象のアイテムに強化段階ごとの能力値 (クライアント、または告知の +n 表) があればアイテム側だけに載せる
    const itemOf = (a: string) => items.find((i) => i.id === a) ?? materials.find((i) => i.id === a);
    const hasLevelStats = (a: string) => (itemOf(a)?.stats ?? []).filter((x) => /^\[?\+\d+\]?$/.test(x.label)).length >= 2;
    const statsMoved = applies.some((a) => ex.items[a]?.levels) || applies.every(hasLevelStats);
    // 能力値: 段階の対応が取れた表から。対象の一部だけの表 (攻撃竜珠だけ等) は、能力値の note に対象を書いて並べる
    const statsFrom: { map: Map<number, EnhanceRow>; note?: string }[] = [];
    if (!statsMoved) {
      const covered = new Set<string>();
      for (const [t, m] of maps) {
        if (!m || ![...m.values()].some((r) => r.stats?.length) || t.applies_to.every((a) => covered.has(a))) continue;
        const whole = applies.every((a) => t.applies_to.includes(a));
        statsFrom.push({ map: m, note: whole && !covered.size ? undefined : t.applies_to.join("・") });
        t.applies_to.forEach((a) => covered.add(a));
        if (whole) break;
      }
    }
    const rows = Object.entries(all)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([lv, cr]) => {
        const prevs = maps.map(([, m]) => m?.get(Number(lv))).filter((r): r is EnhanceRow => !!r);
        const prev: EnhanceRow = { level: `+${lv}` };
        const onFail = prevs.find((r) => r.on_fail)?.on_fail;
        if (onFail) prev.on_fail = onFail;
        const rateText = prevs.find((r) => r.rate_text && !/[\d.]+%|記載なし|不明/.test(r.rate_text))?.rate_text;
        if (rateText) prev.rate_text = rateText;
        const row = clientRow(`+${lv}`, cr, prev);
        const st = statsFrom.flatMap(({ map, note }) =>
          (map.get(Number(lv))?.stats ?? []).map((x) => (note && !x.note ? { ...x, note } : note ? { ...x, note: `${note} ${x.note}` } : x)),
        );
        if (st.length) row.stats = st;
        return row;
      });
    if (chain) {
      // 進化の行: 素材は data の進化レシピ (進化前 → 進化後) から
      const before = new Set(applies.filter((a) => eidOf(a) && keyOfEid.get(eidOf(a)!) === k));
      const evolves = recipes.filter((r) => r.type === "evolve" && r.base && before.has(r.base) && applies.includes(r.result) && !before.has(r.result));
      const mats = new Map<string, Qty>();
      for (const r of evolves) for (const m of r.materials) if (!mats.has(m.item)) mats.set(m.item, { ...m });
      const row: EnhanceRow = { level: `+${chain.at} で進化`, evolve: chain.text };
      if (mats.size) row.materials = [...mats.values()];
      const at = rows.findIndex((r) => (levelOf(r.level) ?? 0) > chain.at);
      rows.splice(at < 0 ? rows.length : at, 0, row);
    }
    // 出典: 日本版の出典 (古い順) + クライアント
    const refs: Ref[] = [];
    for (const t of [...members, ...extras])
      for (const r of t.refs)
        if (r.source !== SRC && sourceById.get(r.source)?.region === "JP" && !refs.some((x) => x.source === r.source)) refs.push({ ...r });
    refs.sort((a, b) => (sourceById.get(a.source)?.published_at ?? "").localeCompare(sourceById.get(b.source)?.published_at ?? ""));
    refs.push(refs.length ? { source: SRC, note: "確率・費用・素材" } : { source: SRC });
    // 注記: 統合済みの表の行はそのまま、吸収した表は「出典「表名」: 注記」(同じ出典・同じ注記はまとめる)
    const lines: string[] = [];
    const overseas = new Set<string>();
    const byNote = new Map<string, { label: string; names: string[]; note: string }>();
    for (const t of [...members, ...extras].sort((a, b) => tableDate(a).localeCompare(tableDate(b)) || a.id.localeCompare(b.id))) {
      const note = (t.notes ?? "").replace(CLIENT_NOTE, "").trim();
      if (t.id.startsWith("client-enh-")) {
        for (const l of note.split("\n").map((x) => x.trim()).filter(Boolean)) {
          const m = OVERSEAS_NOTE.exec(l);
          if (m) m[1].split(", ").forEach((s) => overseas.add(s));
          else if (!lines.includes(l)) lines.push(l);
        }
        continue;
      }
      if (wasOverseas(t)) {
        const m = OVERSEAS_NOTE.exec(note);
        (m ? m[1].split(", ") : t.refs.map((r) => r.source).filter((s) => s !== SRC)).forEach((s) => overseas.add(s));
        continue;
      }
      // クライアントに無い段階の行
      const lm = levelMap(t);
      const outside = lm ? [...lm].filter(([lv]) => lv > 0 && !all[String(lv)]).map(([, r]) => r.level) : []; // +0 は未強化の段階
      // 段階の対応が取れない行 (+1～+5 のような区間) の能力値は注記に残す
      const statText = t.rows
        .filter((r) => !statsMoved && r.stats?.length && (!lm || levelOf(r.level) === undefined))
        .map((r) => `${r.level}: ${r.stats!.map((x) => `${x.name} ${x.value}${x.note ? ` (${x.note})` : ""}`).join(", ")}`);
      const body = [
        note,
        outside.length ? `${outside.join("・")} の行はクライアントに無い。` : "",
        statText.length ? `能力値 ${statText.join(" / ")}。` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const label = srcLabel(t.refs);
      const key = `${label}\t${body}`;
      const cur = byNote.get(key);
      if (cur) cur.names.push(t.name);
      else {
        byNote.set(key, { label, names: [t.name], note: body });
        lines.push(key);
      }
    }
    const noteLines = lines.map((l) => {
      const b = byNote.get(l);
      return b ? `${b.label}${b.names.map((n) => `「${n}」`).join("")}${b.note ? `: ${b.note}` : ""}` : l;
    });
    if (overseas.size) noteLines.push(`以前は海外版の表 (${[...overseas].sort().join(", ")}) を掲載していた。`);
    // 名前: 上書き → 新しい日本版の告知の表 → 前回統合した表 (対象が同じとき。再実行で名前が変わらないように) → 対象アイテム名の共通部分
    const prevTable = members.find((t) => t.id === id);
    const samePrev = prevTable && prevTable.applies_to.length === applies.length && applies.every((a) => prevTable.applies_to.includes(a));
    const notice = members.find((t) => !t.id.startsWith("client-enh-") && !wasOverseas(t) && isJpOfficial(t));
    const common = commonName(applies);
    const name =
      NAME_OVERRIDE[id] ??
      (notice ? tidyName(notice.name) : undefined) ??
      (samePrev && !/ほか\d+件 強化$/.test(prevTable.name) ? prevTable.name : undefined) ??
      (common.length >= 2 ? `${common} 強化` : `${applies[0]} ほか${applies.length - 1}件 強化`);
    const t: EnhanceTable = { id, name, kind: "enhance", applies_to: applies, rows, notes: [HEADER, ...noteLines].join("\n"), refs };
    if (!prevTable) inc("enhance.new");
    for (const m of [...members, ...extras]) if (m.id !== id && !removed.has(m.id)) removed.set(m.id, id);
    if (members.length > 1 || (members[0] && members[0].id !== id)) log.push(`強化表を統合 ${id} ← ${members.map((m) => m.id).join(", ")}`);
    created.set(id, t);
  }
  // 置き換え: 統合先は吸収元のうち最初の位置に置く
  const next: EnhanceTable[] = [];
  const placed = new Set<string>();
  for (const t of outTables) {
    const to = created.has(t.id) ? t.id : removed.get(t.id);
    if (!to) {
      next.push(t);
      continue;
    }
    if (to !== t.id) inc("enhance.absorbed");
    if (created.has(to) && !placed.has(to)) {
      next.push(created.get(to)!);
      placed.add(to);
    }
  }
  for (const [id, t] of created) if (!placed.has(id)) next.push(t);
  outTables.splice(0, outTables.length, ...next);
  // 転送: 吸収した表の旧 id → 統合先 (連鎖は最終の id に、今ある表の id は転送しない)
  for (const [from, to] of removed) tableAliases[from] = to;
  const live = new Set(outTables.map((t) => t.id));
  for (const k of Object.keys(tableAliases)) {
    let to = tableAliases[k];
    for (let i = 0; i < 10 && tableAliases[to]; i++) to = tableAliases[to];
    if (live.has(k) || !live.has(to)) delete tableAliases[k];
    else tableAliases[k] = to;
  }
}
// 新しい表の素材で data に無いものはスタブを作る
for (const t of outTables)
  for (const r of t.rows)
    for (const m of r.materials ?? []) if (!allIds.has(m.item)) missingMats.set(m.item, { item: m.item, qty: 0 });

// ---- レシピ ----
const RATE_TYPES = new Set<Recipe["type"]>(["craft", "evolve", "upgrade", "refine"]);
const strip = (s: string) => s.replace(/\((マジック|レア|エピック|ユニーク|レジェンド)\)$/, "").normalize("NFKC").replace(/[\s　]+/g, "");
const SPLIT_NOTE = /\s*原文の総称「[^」]*」を分割した各アイテムのレシピ。/;
const removedRecipes: string[] = [];
// 改名時に総称を分割して複製したレシピ (id 末尾 -N): クライアントで確認できたものだけ残す。
// 1 つも確認できない組は、最初の 1 件を代表として元の id で残す (告知のレシピ自体は正しいので)
{
  const fams = new Map<string, Recipe[]>();
  for (const r of recipes) if (r.notes && SPLIT_NOTE.test(r.notes)) fams.set(r.id.replace(/-\d+$/, ""), [...(fams.get(r.id.replace(/-\d+$/, "")) ?? []), r]);
  const drop = new Set<Recipe>();
  for (const [fam, rs] of fams) {
    const ok = rs.filter((r) => ex.recipes[r.id]);
    if (ok.length) {
      for (const r of rs) if (!ex.recipes[r.id]) drop.add(r);
      for (const r of ok) {
        r.notes = r.notes!.replace(SPLIT_NOTE, "").trim() || undefined;
        if (!r.notes) delete r.notes;
      }
    } else {
      const [keep, ...rest] = rs;
      rest.forEach((r) => drop.add(r));
      const src = keep.notes!.match(/原文の総称「([^」]*)」/)?.[1] ?? "";
      keep.notes = keep.notes!.replace(SPLIT_NOTE, ` 原文は分割前の「${src}」での記載で、分割後のどれが対象かは区別されていない (ここでは代表として1件だけ掲載)。`).trim();
      if (!recipes.some((x) => x.id === fam)) keep.id = fam;
    }
  }
  for (let i = recipes.length - 1; i >= 0; i--)
    if (drop.has(recipes[i])) {
      removedRecipes.push(recipes[i].id);
      recipes.splice(i, 1);
    }
}
for (const r of recipes) {
  const c = ex.recipes[r.id];
  if (!c) continue;
  const from = srcLabel(r.refs);
  const diffs: string[] = [];
  const what: string[] = [];
  if (c.gold !== undefined) {
    if (r.gold !== undefined && r.gold !== c.gold && !(c.gold === 0)) diffs.push(`${r.gold}G`);
    if (c.gold) r.gold = c.gold;
    else if (r.gold !== undefined && c.compound_id !== undefined) delete r.gold;
    what.push("ゴールド");
  }
  if (c.rate !== undefined && RATE_TYPES.has(r.type)) {
    if (r.rate !== undefined && Math.abs(r.rate - c.rate) > 1e-6) diffs.push(`成功率${r.rate}%`);
    r.rate = c.rate;
    what.push("成功率");
  }
  for (const m of r.materials) {
    const cm = c.materials?.find((x) => strip(x.item) === strip(m.item));
    if (!cm) continue;
    if (typeof m.qty === "number" && m.qty !== cm.qty) diffs.push(`${m.item}×${m.qty}`);
    else if (typeof m.qty !== "number") log.push(`個数補完 ${r.id}: ${m.item} ${m.qty} → ${cm.qty}`);
    m.qty = cm.qty;
    if (!what.includes("個数")) what.push("個数");
  }
  if (c.from_level && !r.notes?.includes(`+${c.from_level}`)) keepOld(r, "notes", `ベースは +${c.from_level} が条件 (クライアントの進化表)。`);
  if (c.where && !r.where) r.where = c.where;
  if (c.result_qty && c.result_qty > 1 && r.result_qty === undefined) r.result_qty = c.result_qty;
  if (diffs.length) {
    keepOld(r, "notes", `${from}では ${diffs.join("、")}。`);
    conflicts.push(`${r.id}: ${diffs.join("、")}`);
  }
  addRef(r.refs, c.change_row !== undefined ? "進化の組み合わせ" : c.shop_row !== undefined ? "交換の費用" : "ゴールド・成功率・個数");
  inc("recipe");
}
// 鍛冶屋の生産表の場所 (告知の場所の記載があればそのまま)
for (const r of recipes) {
  const w = ex.recipe_where?.[r.id];
  if (w && !r.where) {
    r.where = w;
    inc("recipe.where");
  }
}
if (removedRecipes.length) log.push(`クライアントで確認できない分割レシピを削除 ${removedRecipes.length} 件: ${removedRecipes.slice(0, 8).join(", ")}${removedRecipes.length > 8 ? " ほか" : ""}`);

// クライアントにだけあるレシピ (ショップ交換・進化・製作)
const recipeIds = new Set(recipes.map((r) => r.id));
const KIND_NOTE: Record<string, string> = { shop: "クライアントのショップ表の交換", chg: "クライアントの進化表 (加速器などで変換)", cmp: "クライアントの製作表" };
for (const nr of ex.new_recipes ?? []) {
  if (recipeIds.has(nr.id)) continue;
  const { accelerators, note, ...rest } = nr;
  const kind = nr.id.split("-")[1];
  const rec: Recipe = { ...rest, refs: [{ source: SRC }] };
  const notes = [KIND_NOTE[kind]];
  if (note) notes.push(note);
  if (accelerators && accelerators.length > 1) notes.push(`使える加速器: ${accelerators.join("・")}。`);
  rec.notes = notes.filter(Boolean).join("。").replace(/。。/g, "。");
  if (!rec.notes.endsWith("。")) rec.notes += "。";
  recipes.push(rec);
  recipeIds.add(nr.id);
  inc("recipe.new");
}

// ---- 箱の中身 ----
const drops = await readJson<DropTable[]>("data/drops.json");
{
  const boxTables = new Set(drops.filter((d) => d.location_kind === "box").map((d) => d.location));
  for (const [name, b] of Object.entries(ex.boxes ?? {})) {
    const id = `client-box-${b.client_id}`;
    const prev = drops.findIndex((d) => d.id === id);
    if (prev < 0 && boxTables.has(name)) {
      log.push(`箱 ${name}: 告知の表があるのでクライアントの表は追加しない`);
      continue;
    }
    const anyRate = b.entries.some((e) => e.rate !== undefined);
    const table: DropTable = {
      id,
      location: name,
      location_kind: "box",
      label: b.select ? "選択" : b.all ? "中身 (全て獲得)" : "中身",
      entries: b.entries.map((e) => ({
        item: e.item,
        ...(e.rate !== undefined ? { rate: e.rate } : b.select ? { rate_text: "選択" } : b.all ? { rate_text: "確定" } : {}),
        ...(e.qty !== 1 ? { qty: e.qty } : {}),
      })),
      notes: b.select
        ? "中身から1つを選んで獲得 (クライアントのデータ)。"
        : b.all
          ? "中身を全て獲得する袋 (クライアントのデータ)。"
          : anyRate
            ? "確率はクライアントのデータの重みから計算した値。"
            : "クライアントのデータに確率の値が無い (均等かどうかは不明)。",
      refs: [{ source: SRC }],
    };
    if (prev >= 0) drops[prev] = table;
    else {
      drops.push(table);
      inc("box.new");
    }
  }
}

// ---- 分解 ----
// 告知の分解レシピがある装備は告知のまま。クライアントの分解表は段階の範囲ごとに、出る候補 1 件につき 1 レシピ
{
  for (let i = recipes.length - 1; i >= 0; i--) if (recipes[i].id.startsWith("client-dis-")) recipes.splice(i, 1);
  const noticeBases = new Set(recipes.filter((r) => r.type === "dismantle" && r.base).map((r) => r.base!));
  for (const [base, d] of Object.entries(ex.dismantles ?? {})) {
    if (!allIds.has(base)) continue;
    if (noticeBases.has(base)) {
      if (verbose) log.push(`分解 ${base}: 告知のレシピがあるのでクライアントの分解表は使わない`);
      continue;
    }
    const whole = d.rows.length === 1;
    d.rows.forEach((row, ri) => {
      const [a, b] = row.levels;
      const lv = d.plus0_only ? "クライアントには +0 の分解表だけがある (強化段階ごとの表は無い)。" : whole ? "" : a === b ? `強化 +${a} のとき。` : `強化 +${a}～+${b} のとき。`;
      const cand = row.entries.length > 1
        ? `この${whole ? "" : "段階の"}分解表には ${row.entries.length} 件の候補 (${row.entries.map((e) => `${e.item}×${e.qty}`).join("・")}) があり、確率と出方 (1つだけか、それぞれ判定か) はクライアントのデータに無い。`
        : "";
      row.entries.forEach((e, ei) => {
        recipes.push({
          id: `client-dis-${d.client_id}-${ri}-${ei}`,
          type: "dismantle",
          result: e.item,
          ...(e.qty > 1 ? { result_qty: e.qty } : {}),
          base,
          materials: [],
          ...(d.gold ? { gold: d.gold } : {}),
          notes: [d.note, lv, cand, "クライアントの分解表。"].filter(Boolean).join(""),
          refs: [{ source: SRC }],
        });
        inc("dismantle");
      });
    });
  }
}

// ---- クリア報酬の箱 ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id.startsWith("client-clear-")) drops.splice(i, 1);
  for (const [dungeon, ts] of Object.entries(ex.clears ?? {})) {
    for (const t of ts) {
      const counts = Object.entries(t.counts).map(([k, v]) => `${k}${v}`).join("・");
      const head = t.show ? `クリア時に箱が${t.show}個並び${t.select ? `、${t.select}個を選ぶ` : ""}${counts ? ` (${counts})` : ""}。` : "";
      let id = `client-clear-${t.clear_id}`;
      if (drops.some((x) => x.id === id)) id += `-${drops.filter((x) => x.id.startsWith(id)).length}`;
      drops.push({
        id,
        location: dungeon,
        location_kind: "dungeon",
        label: "クリア報酬の箱 (候補)",
        entries: t.boxes.flatMap((b) => b.entries.map((e) => ({ item: e.item, from: b.box, ...(b.floors ? { floors: b.floors } : {}), qty: e.qty }))),
        notes: `${head}クライアントのデータには確率が無い (0 で配布されている) ため、出る候補と個数だけを載せている。同じ箱・階層に同じアイテムが個数違いで並ぶものは、どの個数が出るかの確率が不明。`,
        refs: [{ source: SRC }],
      });
      inc("clear");
    }
  }
}

// ---- エリア報酬・マップのトリガーの報酬 ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (/^client-(area|trig)-/.test(drops[i].id)) drops.splice(i, 1);
  const NO_RATE = "クライアントのデータには確率が無い (0 で配布されている) ため、出る候補と個数だけを載せている。同じアイテムが個数違いで並ぶものは、どの個数が出るかの確率が不明。";
  for (const [dungeon, areas] of Object.entries(ex.nest_areas ?? {})) {
    drops.push({
      id: `client-area-${Math.min(...areas.map((a) => a.map_id))}`,
      location: dungeon,
      location_kind: "dungeon",
      label: "エリア報酬 (候補)",
      entries: [...areas].sort((a, b) => a.map_id - b.map_id).flatMap((a) =>
        a.rows.flatMap((r) =>
          r.entries.map((e) => ({
            item: e.item,
            from: `${a.mode ? `${a.mode} ` : ""}第${a.area}エリア${r.times ? ` (${r.times}回)` : ""}`,
            ...(r.floors && r.floors !== a.mode ? { floors: r.floors } : {}),
            qty: e.qty,
          })),
        ),
      ),
      notes: `各エリアのボスを倒したときの中間報酬 (クライアントのネストのエリア報酬スクリプト)。報酬を受け取れるパーティー員 1 人ごとに出る。${
        areas.some((a) => a.mode) ? `クライアントではモード (${[...new Set(areas.map((a) => a.mode).filter(Boolean))].join("・")}) ごとに別のマップで、ボスのエリアの報酬がクリア報酬を兼ねる。` : ""
      }${NO_RATE}`,
      refs: [{ source: SRC }],
    });
    inc("area");
  }
  for (const [dungeon, t] of Object.entries(ex.map_triggers ?? {})) {
    drops.push({
      id: `client-trig-${t.key}`,
      location: dungeon,
      location_kind: "dungeon",
      label: "マップのトリガーの報酬 (候補)",
      entries: t.rows.flatMap((r) => r.entries.map((e) => ({ item: e.item, from: r.trigger, ...(r.floors ? { floors: r.floors } : {}), qty: e.qty }))),
      notes: `マップのトリガー (クリア時の報酬の箱・特別報酬など) が落とすアイテム。獲得元はトリガーの名前 (開発用の名前のまま) で、同じ中身のトリガーはまとめている (8 人分の「Reward_Click_1～8」など)。1 つのトリガーに複数の行があるものは、行ごとに 1 回ずつ落ちる。${NO_RATE}`,
      refs: [{ source: SRC }],
    });
    inc("trigger");
  }
}

// ---- 一般ネスト (12 ネスト) のクリア報酬 ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id.startsWith("client-nest-")) drops.splice(i, 1);
  const g = ex.general_nests;
  const NEST = "一般ネスト(12ネスト)";
  const NO_RATE = "クライアントのデータには確率が無い (0 で配布されている) ため、出る候補と個数だけを載せている。同じアイテムが個数違いで並ぶもの (×N と ×3N など) は、どの個数が出るかの確率が不明。";
  const HEAD = "ボスを倒したときの最終報酬 (クライアントのマップのトリガー)。共通の表とネスト固有の表が、階層ごとの行がそれぞれ 1 回ずつ落ちる。疲労度ブースト使用時は同じ表が追加で落ちる。";
  if (g?.common.length) {
    drops.push({
      id: "client-nest-common",
      location: NEST,
      location_kind: "dungeon",
      label: "クリア報酬 (共通・候補)",
      entries: g.common.flatMap((r) => r.entries.map((e) => ({ item: e.item, floors: r.floors, qty: e.qty }))),
      layout: "item_columns",
      notes: `12 ネスト共通。${HEAD}${NO_RATE}`,
      refs: [{ source: SRC }],
    });
    inc("nest");
  }
  if (g?.nests.length) {
    const ALL = "全階層";
    // ネストごとの月食のかけら (階層のある行) の個数が、どのネスト・どのかけらでも同じなら、
    // 「ネストごとに何が出るか」と「階層ごとの個数」(総称の上級月食のかけら) の 2 つの表に分ける
    const counts = new Map<string, Map<string, (number | string)[]>>(); // ネスト名・アイテム → 階層 → 個数
    for (const n of g.nests)
      for (const r of n.rows) {
        if (r.floors === ALL) continue;
        for (const e of r.entries) {
          const key = `${n.name}\t${e.item}`;
          const byFloor = counts.get(key) ?? counts.set(key, new Map()).get(key)!;
          byFloor.set(r.floors, [...(byFloor.get(r.floors) ?? []), e.qty]);
        }
      }
    const sigs = new Set([...counts.values()].map((m) => JSON.stringify([...m])));
    const SHARD = "上級月食のかけら";
    const shared = sigs.size === 1 && [...counts.keys()].every((k) => /\t上級.+月食のかけら$/.test(k));
    if (shared) {
      drops.push({
        id: "client-nest-specific",
        location: NEST,
        location_kind: "dungeon",
        label: "クリア報酬 (ネスト固有・候補)",
        entries: g.nests.flatMap((n) => {
          const fixed = n.rows.filter((r) => r.floors === ALL).flatMap((r) => r.entries.map((e) => ({ item: e.item, from: n.name, qty: e.qty })));
          const shards = [...new Set(n.rows.filter((r) => r.floors !== ALL).flatMap((r) => r.entries.map((e) => e.item)))].map((item) => ({ item, from: n.name }));
          return [...fixed, ...shards];
        }),
        notes: `共通の報酬に加えて、ネストごとに落ちるもの。月食のかけらの個数は階層で変わり、どのネスト・どのかけらも同じ (下の「ネスト固有の月食のかけらの個数」の表)。${HEAD}${NO_RATE}`,
        refs: [{ source: SRC }],
      });
      const [one] = counts.values();
      drops.push({
        id: "client-nest-specific-qty",
        location: NEST,
        location_kind: "dungeon",
        label: "ネスト固有の月食のかけらの個数 (候補)",
        entries: [...one].flatMap(([floors, qs]) => qs.map((qty) => ({ item: SHARD, floors, qty }))),
        layout: "item_columns",
        notes: `ネスト固有の表のかけら (2 種類) それぞれの、階層ごとの個数。${NO_RATE}`,
        refs: [{ source: SRC }],
      });
      inc("nest", 2);
    } else {
      console.warn("一般ネストの固有のかけらの個数がネストごとに違うので、階層表 (獲得元 = ネスト名) のまま出す");
      drops.push({
        id: "client-nest-specific",
        location: NEST,
        location_kind: "dungeon",
        label: "クリア報酬 (ネスト固有・候補)",
        entries: g.nests.flatMap((n) => n.rows.flatMap((r) => r.entries.map((e) => ({ item: e.item, from: n.name, floors: r.floors, qty: e.qty })))),
        notes: `共通の報酬に加えて、ネストごとに落ちるもの。${HEAD}${NO_RATE}`,
        refs: [{ source: SRC }],
      });
      inc("nest");
    }
  }
}

// 階層ごとの報酬表 (ラビリンス・ネストの最終報酬) の共通
const NO_RATE_QTY = "クライアントのデータには確率が無い (0 で配布されている) ため、出る候補と個数だけを載せている。同じアイテムが個数違いで並ぶもの (×N と ×3N など) は、どの個数が出るかの確率が不明。";
// 総称 (members) の中身がすべて同じ個数で並ぶ階層は、総称 1 つにまとめる (上級月食のかけら 6 種など)
const generics = [...items, ...materials].filter((i) => i.members?.length);
const collapseGenerics = <R extends { entries: { item: string; qty: number | string }[] }>(r: R): R => {
  let es = r.entries;
  for (const g of generics) {
    const qs = g.members!.map((m) => JSON.stringify(es.filter((e) => e.item === m).map((e) => e.qty)));
    if (qs[0] === "[]" || new Set(qs).size !== 1) continue;
    const at = es.findIndex((e) => g.members!.includes(e.item));
    const mine = es.filter((e) => e.item === g.members![0]).map((e) => ({ item: g.id, qty: e.qty }));
    es = es.filter((e) => !g.members!.includes(e.item));
    es.splice(at, 0, ...mine);
  }
  return { ...r, entries: es };
};

// ---- ラビリンス (メイズモード) の報酬 ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id.startsWith("client-maze-")) drops.splice(i, 1);
  const MAZE = "ラビリンス(メイズモード)";
  const KINDS = {
    stage: {
      label: "ステージクリア報酬 (候補)",
      notes: "各ステージ (ゾーン) をクリアしてワープが開くときに、パーティー全員に落ちる (アセンション1階層以上。それ未満は空の表)。メイズのマップは一般ネストのマップを使い回していて、元のネストごとに表が分かれているが中身は同じ。上級月食のかけらは 6 種類それぞれの行が同じ個数で並んでいるのでまとめている。",
    },
    erosion: { label: "侵蝕モードのクリア報酬 (候補)", notes: "侵蝕を適用してクリアしたとき、最終ステージで落ちる (侵蝕報酬箱)。" },
  } as const;
  for (const [k, def] of Object.entries(KINDS) as [keyof typeof KINDS, (typeof KINDS)[keyof typeof KINDS]][]) {
    for (const [i, t] of (ex.labyrinth?.[k] ?? []).entries()) {
      drops.push({
        id: `client-maze-${k}${i ? `-${i}` : ""}`,
        location: MAZE,
        location_kind: "dungeon",
        label: def.label,
        entries: t.rows.map(collapseGenerics).flatMap((r) => r.entries.map((e) => ({ item: e.item, floors: r.floors, qty: e.qty }))),
        layout: "item_columns",
        notes: `${def.notes}${NO_RATE_QTY}`,
        refs: [{ source: SRC }],
      });
      inc("maze");
    }
  }
}

// ---- ネストの最終報酬 (ボスマップのトリガー) ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id.startsWith("client-final-")) drops.splice(i, 1);
  const KINDS: Record<string, { label: string; notes: string }> = {
    final: { label: "クリア報酬 (候補)", notes: "ボスを倒したあとの報酬 (クライアントのボスマップのトリガー)。" },
    bless: { label: "祝福の箱 (候補)", notes: "クリア後に確率で出現する祝福の箱から落ちる (出現する確率はクライアントからは分からない)。" },
    double: { label: "追加報酬 (候補)", notes: "クリア報酬とは別に、確率で落ちる。" },
    welcome: { label: "ウェルカム魔物モードの報酬 (候補)", notes: "1 人で入場したとき (ウェルカム魔物モード) に、エリアの報酬とは別に落ちる。" },
    key_box: { label: "鍵で開ける箱 (候補)", notes: "クリア後に鍵で開ける箱 (トリガーの名前は DimensionBox / BoxKeyCheck。告知 1311 の「混沌の中の秩序の鍵」の報酬と思われる)。" },
    sunset: { label: "洛陽の報酬箱 (候補)", notes: "トリガーの名前が SunSet_Key (洛陽の鍵) の報酬。告知 1246 の「報酬箱 (洛陽/闇夜)」の洛陽の方と思われる。" },
    risky: { label: "リスキーポータルの箱 (候補)", notes: "リスキーミッション達成後の箱。" },
  };
  const EXTRA: Record<string, string> = {
    解放のプロフェッサーKネスト:
      "疲労度ブースト使用時は、一般ネスト(12ネスト) の共通の表とプロフェッサーKネストの固有の表が追加で落ちる (一般ネストの表を参照)。同じマップのファイルにある依頼・ラビリンス用の報酬は除いている。",
  };
  for (const [dungeon, ts] of Object.entries(ex.nest_finals ?? {})) {
    for (const t of ts) {
      const def = KINDS[t.kind] ?? { label: `${t.kind} (候補)`, notes: "" };
      const rows = t.rows.map(collapseGenerics);
      const floors = new Set(rows.map((r) => r.floors).filter(Boolean));
      const req = t.requires?.[0];
      const notes = [
        def.notes,
        t.party ? "パーティーの人数 (1～8 人) ごとにトリガーが分かれているが、中身は同じ (人数で変わるのは確率と思われる)。" : "",
        rows.some((r) => r.from?.startsWith("クリア等級")) ? "クリア等級 (R/SR/SSR) ごとに表が分かれる。" : "",
        req && t.rates
          ? `パーティーで「${req.item}」を持っている人数に応じた確率で落ちる (${t.rates.map(([n, r]) => `${n}人 ${r}%`).join("・")}。トリガーの条件の値)。`
          : req
            ? `開けるのに「${req.item}」×${req.qty.join("/")} が要る (トリガーの条件)。`
            : "",
        EXTRA[dungeon] && t.kind === "final" ? EXTRA[dungeon] : "",
        floors.size >= 2 ? "階層によって中身が変わる。" : "",
        NO_RATE_QTY,
      ].join("");
      drops.push({
        id: `client-final-${t.key}-${t.kind}`,
        location: dungeon,
        location_kind: "dungeon",
        label: t.kind === "double" && req ? `「${req.item}」の追加報酬 (候補)` : def.label,
        entries: rows.flatMap((r) => r.entries.map((e) => ({ item: e.item, ...(r.from ? { from: r.from } : {}), ...(r.floors ? { floors: r.floors } : {}), qty: e.qty }))),
        ...(floors.size >= 2 ? { layout: "item_columns" as const } : {}),
        notes,
        refs: [{ source: SRC }],
      });
      inc("final");
    }
  }
}

// ---- 魔物の討伐報酬 (次元の狭間系のボス・ルートの魔物) ----
{
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id.startsWith("client-kill-")) drops.splice(i, 1);
  const KINDS: Record<string, { label: string; notes: string }> = {
    boss: { label: "ボスの討伐報酬 (候補)", notes: "ボス (次元管理者) を倒したときの報酬。" },
    heraldry: { label: "紋章ルートの討伐報酬 (候補)", notes: "ボスのあとの紋章ルートで出る魔物 (どれか 1 体) を倒したときの報酬。" },
    talisman: { label: "タリスマンルートの討伐報酬 (候補)", notes: "ボスのあとのタリスマンルートで出る魔物 (どれか 1 体) を倒したときの報酬。" },
    world: { label: "世界ルートの討伐報酬 (候補)", notes: "ボスのあとの世界ルートで出る魔物 (どれか 1 体) を倒したときの報酬。" },
    event: { label: "イベントの魔物の討伐報酬 (候補)", notes: "ルート中に確率で起きるイベントで出る魔物を倒したときの報酬。" },
  };
  const EXTRA: Record<string, string> = {
    崩壊した次元の狭間:
      "ボス (変異したSC-31) と、そのあとのルート (次元ルート、ダブルボスのときはもう 1 体) で出る変異した魔物 (どれか 1 体) が同じ表を落とす。",
  };
  for (const [dungeon, ts] of Object.entries(ex.kills ?? {})) {
    for (const t of ts) {
      const def = KINDS[t.kind] ?? { label: `${t.kind} (候補)`, notes: "" };
      const rows = t.rows.map(collapseGenerics);
      const floors = new Set(rows.map((r) => r.floors).filter(Boolean));
      drops.push({
        id: `client-kill-${t.key}-${t.group}`,
        location: dungeon,
        location_kind: "dungeon",
        label: t.kind === "boss" && EXTRA[dungeon] ? "ボス・変異した魔物の討伐報酬 (候補)" : t.kind === "event" ? `イベント (${t.monsters.join("・")}) の討伐報酬 (候補)` : def.label,
        entries: rows.flatMap((r) => r.entries.map((e) => ({ item: e.item, ...(r.floors ? { floors: r.floors } : {}), qty: e.qty }))),
        ...(floors.size >= 2 ? { layout: "item_columns" as const } : {}),
        notes: [
          t.kind === "boss" && EXTRA[dungeon] ? EXTRA[dungeon] : def.notes,
          `魔物: ${t.monsters.join("・")} (クライアントの魔物の表のドロップグループ ${t.group})。`,
          floors.size >= 2 ? "階層によって中身が変わる。" : "",
          NO_RATE_QTY,
        ].join(""),
        refs: [{ source: SRC }],
      });
      inc("kill");
    }
  }
}

// ---- ランダムオプション ----
// 表の名前 (クライアントの再付与グループ → 装備の系統)。無いグループは対象のアイテム名を並べる
const OPTION_NAMES: Record<number, string> = {
  2: "古竜防具",
  3: "古竜武器",
  4: "古竜武器",
  11: "古代の変異型防御竜珠",
  22: "永遠の次元の変異型竜珠",
  25: "崩壊の竜珠(エピック)",
  26: "金糸防具",
  27: "金糸武器",
  28: "金糸武器",
  31: "邪根の変異型竜珠",
  34: "ナイトメアジェレイントの紋章",
  35: "金竜防具",
  36: "金竜武器",
  37: "永劫の異界の変異型竜珠",
};
const PART_SHORT: Record<string, string> = {
  "ヘルム・アーマー・ボトム・グローブ・ブーツ": "防具",
  "メインウェポン・サブウェポン": "武器",
  "イヤリング・ネックレス・リング": "アクセサリー",
};
/** 対象のアイテム名を並べる。等級だけ違うものは「名前(レジェンド/エンシェント)」にまとめる */
function gradeJoin(ids: string[]): string {
  const ORDER = ["ノーマル", "マジック", "レア", "エピック", "ユニーク", "レジェンド", "エンシェント"];
  const ms = ids.map((id) => id.match(/^(.*)\((ノーマル|マジック|レア|エピック|ユニーク|レジェンド|エンシェント)\)$/));
  if (ids.length > 1 && ms.every((m) => m && m[1] === ms[0]![1]))
    return `${ms[0]![1]}(${ms.map((m) => m![2]).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("/")})`;
  return ids.join("・");
}
const optionTables: OptionTable[] = [];
for (const [id, o] of Object.entries(ex.options ?? {})) {
  const parts = [...new Set(Object.values(o.parts ?? {}))];
  const base = OPTION_NAMES[o.group] ?? gradeJoin(o.items);
  const part = parts.length === 1 ? ` (${PART_SHORT[parts[0]] ?? parts[0]})` : "";
  const kinds = new Set(o.rerolls.map((r) => r.kind));
  const multi = new Set(o.lines).size < o.lines.length;
  optionTables.push({
    id,
    name: `${base}のランダムオプション${part}`,
    applies_to: o.items,
    ...(o.parts ? { applies_parts: o.parts } : {}),
    lines: o.lines,
    pools: o.pools,
    rerolls: o.rerolls,
    notes: [
      "日本版クライアントの値。行ごとに、その行の候補表から確率 (クライアントの重み) で 1 つ選ばれる。",
      multi ? "同じ候補表の行で同じオプションが重なって付くかどうかは、クライアントからは分からない。" : "",
      kinds.has("select") ? "ランダムオプションは変更を取り消せず、選択オプションは変更前のオプションを選んで取り消せる (選んでも材料は消費される)。" : "",
      kinds.has("lock") ? "ロックオプションは指定した数の行を固定したまま、残りの行を再付与する。" : "",
    ].join(""),
    refs: [
      { source: SRC },
      ...(kinds.has("select") ? [{ source: "jp-notice-1151", note: "ランダム/選択オプションの説明" }] : []),
      ...(kinds.has("lock") ? [{ source: "jp-notice-1287", note: "ロックオプションの説明" }] : []),
    ],
  });
  for (const r of o.rerolls) for (const m of r.materials) for (const x of [m.item, ...(m.alt ?? [])]) if (!allIds.has(x)) missingMats.set(x, { item: x, qty: 0 });
  inc("option");
}
optionTables.sort((a, b) => a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));

// 告知・海外版の表 (強化表の kind other 等) とレシピ (箱舟の力の再付与の費用) のうち、クライアントのランダムオプション表と
// 同じ内容のものは、クライアントの表に吸収する: 元の表・レシピは消し、出典は refs (note に元の表の名前)、
// 食い違いは notes に「告知では …」で残す。消した強化表の旧 id は ingest/option_aliases.json で転送する。
// merge (ドラフト) をやり直すと元の表が戻るので、ここで毎回消す (内容は確認済みなので、ここに書いた refs・notes を使う)。
const OPTION_ABSORB: { id: string; kind: "table" | "recipe"; into: string[]; ref: Ref; diff?: string }[] = [
  // 古竜・金竜
  {
    id: "n1151-ancient-dragon-armor-randomopt",
    kind: "table",
    into: ["client-opt-2-838965129"],
    ref: { source: "jp-notice-1151", note: "古竜装備ランダムオプション - 防具オプション (値)" },
    diff: "スキル攻撃力のオプションは現在のクラスのスキルにだけ効く (告知)。",
  },
  { id: "n1246-elder-opt-armor", kind: "table", into: ["client-opt-2-838965129"], ref: { source: "jp-notice-1246", note: "古竜装備 ランダムオプション(防具) (値)" } },
  { id: "cn3909-randopt-armor", kind: "table", into: ["client-opt-2-838965129", "client-opt-35-838965129"], ref: { source: "cn-dngamer-3909", note: "古竜・金竜防具 ランダムオプション出現確率 (CN版。値・確率とも同じ)" } },
  {
    id: "n1151-ancient-dragon-weapon-randomopt",
    kind: "table",
    into: ["client-opt-4-838965131"],
    ref: { source: "jp-notice-1151", note: "古竜装備ランダムオプション - 武器オプション (値)" },
    diff: "スキル攻撃力のオプションは現在のクラスのスキルにだけ効く (告知)。告知では古代の力のスキル攻撃力を「古代の竜珠」の列で記載している。",
  },
  { id: "n1246-elder-opt-weapon", kind: "table", into: ["client-opt-4-838965131"], ref: { source: "jp-notice-1246", note: "古竜装備 ランダムオプション(武器) (値)" } },
  { id: "cn3909-randopt-weapon", kind: "table", into: ["client-opt-4-838965131", "client-opt-36-838965131"], ref: { source: "cn-dngamer-3909", note: "古竜・金竜武器 ランダムオプション出現確率 (CN版。値・確率とも同じ)" } },
  { id: "cn8615-elder-armor-ark-random", kind: "recipe", into: ["client-opt-2-838965129"], ref: { source: "cn-dngamer-8615", note: "箱舟の力 - 通常 (選択不可) の費用 (CN版。同じ)" } },
  { id: "cn8615-elder-armor-ark-select", kind: "recipe", into: ["client-opt-2-838965129"], ref: { source: "cn-dngamer-8615", note: "箱舟の力 - 通常 (選択可) の費用 (CN版。同じ)" } },
  { id: "n1287-ark-lock-elder", kind: "recipe", into: ["client-opt-2-838965129"], ref: { source: "jp-notice-1287", note: "箱舟の力 - ロックオプション (1個固定) の費用" } },
  // 金糸
  { id: "n1287-goldthread-opt-armor", kind: "table", into: ["client-opt-26-838965129"], ref: { source: "jp-notice-1287", note: "金糸防具 ランダムオプション (値)" }, diff: "スキル攻撃力のオプションは現在のクラスのスキルにだけ効く (告知)。" },
  { id: "n1287-goldthread-opt-weapon", kind: "table", into: ["client-opt-28-838965131"], ref: { source: "jp-notice-1287", note: "金糸武器 ランダムオプション (値)" }, diff: "スキル攻撃力のオプションは現在のクラスのスキルにだけ効く (告知)。" },
  {
    id: "n1387-goldthread-armor-randopt",
    kind: "table",
    into: ["client-opt-26-838965129"],
    ref: { source: "jp-notice-1387", note: "金糸装備 防具ランダムオプション (値)" },
    diff: "告知 1387 の表は行の見出しが [+1]～[+5] (強化段階のような書き方) だが、値は 1～5 段階の候補の値と同じで、クライアントの候補は強化段階では変わらない。",
  },
  {
    id: "n1387-goldthread-weapon-randopt",
    kind: "table",
    into: ["client-opt-28-838965131"],
    ref: { source: "jp-notice-1387", note: "金糸装備 武器ランダムオプション (値)" },
    diff: "告知 1387 の表は行の見出しが [+1]～[+5] (強化段階のような書き方) だが、値は 1～5 段階の候補の値と同じで、クライアントの候補は強化段階では変わらない。告知では古代の力のスキル攻撃力を「古代の竜珠」の列で記載している。",
  },
  { id: "n1287-ark-lock-goldthread", kind: "recipe", into: ["client-opt-26-838965129"], ref: { source: "jp-notice-1287", note: "箱舟の力 - ロックオプション (1個固定) の費用" } },
  // 崩壊の竜珠
  {
    id: "n1287-collapse-opt-armor",
    kind: "table",
    into: ["client-opt-25-838966541"],
    ref: { source: "jp-notice-1287", note: "崩壊の竜珠 ランダムオプション(防具) (値)" },
    diff: "告知では防具の候補をクラスマスタリーⅢ・マスター・2次転職Lv.50・メインの 4 種とし、「その他共通: 古代の力40%」と書いているが、クライアントの候補は補助スキルを含む 5 種で、古代の力は無い。",
  },
  { id: "n1287-collapse-opt-weapon", kind: "table", into: ["client-opt-25-838966547"], ref: { source: "jp-notice-1287", note: "崩壊の竜珠 ランダムオプション(武器) (値)" } },
  { id: "n1287-collapse-opt-acc", kind: "table", into: ["client-opt-25-838966544"], ref: { source: "jp-notice-1287", note: "崩壊の竜珠 ランダムオプション(アクセ) (値)" } },
  { id: "n1287-collapse-ark-random", kind: "recipe", into: ["client-opt-25-838966541", "client-opt-25-838966547", "client-opt-25-838966544"], ref: { source: "jp-notice-1287", note: "箱舟の力 - ランダムオプションの費用" } },
  { id: "n1287-collapse-ark-select", kind: "recipe", into: ["client-opt-25-838966541", "client-opt-25-838966547", "client-opt-25-838966544"], ref: { source: "jp-notice-1287", note: "箱舟の力 - 選択オプションの費用" } },
  // 変異型竜珠
  {
    id: "cn1090-eternal-mutant-option",
    kind: "table",
    into: ["client-opt-22-838966397", "client-opt-37-838971354"],
    ref: { source: "cn-dngamer-1090", note: "永遠の次元/永劫の異界の変異型竜珠 ランダムオプション出現確率 (CN版。値・確率とも同じ)" },
  },
  { id: "n1311-jakon-ark-1000", kind: "recipe", into: ["client-opt-31-838966560"], ref: { source: "jp-notice-1311", note: "箱舟の力 - ランダムオプションの費用" } },
  { id: "n1311-jakon-ark-2000", kind: "recipe", into: ["client-opt-31-838966560"], ref: { source: "jp-notice-1311", note: "箱舟の力 - ロックオプション1行の費用" } },
  { id: "n1311-jakon-ark-4000", kind: "recipe", into: ["client-opt-31-838966560"], ref: { source: "jp-notice-1311", note: "箱舟の力 - ロックオプション2行の費用" } },
  {
    id: "n1193-mutant-jade-reroll-guard",
    kind: "recipe",
    into: ["client-opt-11-838964814"],
    ref: { source: "jp-notice-1193", note: "箱舟の力 - 選択式の再付与の費用" },
    diff: "告知では選択式の再付与の材料を「変異型竜珠進化石ver.3」1個 + パキハの機械部品 2個と書いているが、クライアントでは変異型竜珠改良槌Ver.3。",
  },
  {
    id: "n1193-mutant-jade-reroll-threat",
    kind: "recipe",
    into: ["client-opt-11-838964814"],
    ref: { source: "jp-notice-1193", note: "箱舟の力 - 選択式の再付与の費用" },
    diff: "告知では選択式の再付与の材料を「変異型竜珠進化石ver.3」1個 + パキハの機械部品 2個と書いているが、クライアントでは変異型竜珠改良槌Ver.3。",
  },
  // 月食の竜珠 (ノーマル～エンシェント。等級ごと・部位ごとの表すべて)
  {
    id: "n1193-eclipse-jade-reroll",
    kind: "recipe",
    into: [12, 13, 14, 15, 16, 18].flatMap((g) =>
      (g <= 13 ? ["838962516", "838962096"] : ["838962516", "838962768", "838962810", "838962096", "838962348", "838962390"]).map((p) => `client-opt-${g}-${p}`),
    ),
    ref: { source: "jp-notice-1193", note: "箱舟の力 - 選択式の再付与の費用" },
  },
  // ナイトメアバルナック紋章 (レジェンド・エンシェントで候補の値が違う。CN 版は 1 つの表に両方の値)
  {
    id: "cn564-nm-barnac-option",
    kind: "table",
    into: ["client-opt-32-838966667", "client-opt-32-838966668"],
    ref: { source: "cn-dngamer-564", note: "ナイトメアバルナック紋章 ランダムオプション分布 (CN版。値・確率とも同じ)" },
  },
  { id: "cn8615-nm-barnac-ark-random", kind: "recipe", into: ["client-opt-32-838966667", "client-opt-32-838966668"], ref: { source: "cn-dngamer-8615", note: "箱舟の力 - 通常 (選択不可) の費用 (CN版。同じ)" } },
  { id: "cn8615-nm-barnac-ark-select", kind: "recipe", into: ["client-opt-32-838966667", "client-opt-32-838966668"], ref: { source: "cn-dngamer-8615", note: "箱舟の力 - 通常 (選択可) の費用 (CN版。同じ)" } },
  // ナイトメアジェレイントの紋章
  { id: "n1362-nightmare-geraint-random-option", kind: "table", into: ["client-opt-34-838967732"], ref: { source: "jp-notice-1362", note: "ランダムオプション獲得率 (値・確率とも同じ)" } },
  { id: "n1362-nightmare-geraint-lock", kind: "table", into: ["client-opt-34-838967732"], ref: { source: "jp-notice-1362", note: "箱舟の力 (ランダムオプション再設定/ロックオプション) の材料" } },
];
const optionById = new Map(optionTables.map((t) => [t.id, t]));
const optionAliases: Record<string, string> = {};
// 表の id (再付与グループ) が変わったもの: 旧 id から転送する
const OPTION_RENAMED: Record<string, string> = {
  // 月食の竜珠をレジェンドまで載せたので、エンシェントと同じ表が先にレジェンドのグループ (18) で作られる
  ...Object.fromEntries(["838962516", "838962768", "838962810", "838962096", "838962348", "838962390"].map((p) => [`client-opt-17-${p}`, `client-opt-18-${p}`])),
  // 月食のメイン/サブウェポン防御竜珠を月食の防御竜珠に統合 (候補表は全部位で同じ)
  "client-opt-12-838962348": "client-opt-12-838962096",
  "client-opt-13-838962348": "client-opt-13-838962096",
};
for (const [from, to] of Object.entries(OPTION_RENAMED)) if (optionById.has(to) && !optionById.has(from)) optionAliases[from] = to;
for (const a of OPTION_ABSORB) {
  const targets = a.into.map((id) => optionById.get(id));
  if (targets.some((t) => !t)) {
    log.push(`ランダムオプション: ${a.id} の吸収先 ${a.into.join(", ")} が無いので残す`);
    continue;
  }
  const list: { id: string }[] = a.kind === "table" ? outTables : recipes;
  const i = list.findIndex((r) => r.id === a.id);
  if (i >= 0) {
    list.splice(i, 1);
    inc("option.absorbed");
  }
  if (a.kind === "table") optionAliases[a.id] = a.into[0];
  for (const t of targets as OptionTable[]) {
    if (!t.refs.some((r) => r.source === a.ref.source && r.note === a.ref.note)) t.refs.push(a.ref);
    if (a.diff && !t.notes?.includes(a.diff)) t.notes = `${t.notes ?? ""}${a.diff}`;
  }
}
// 吸収した表の出典は「値」の出典なので、説明用に付けた告知 (1151/1287) と重なれば 1 つにする
for (const t of optionTables) t.refs = t.refs.filter((r, i, rs) => !r.note?.endsWith("の説明") || !rs.some((x, j) => j !== i && x.source === r.source && !x.note?.endsWith("の説明")));

// ---- 総称の中身 ----
for (const [id, ms] of Object.entries(ex.members ?? {})) {
  const rec = materials.find((m) => m.id === id) ?? itemById.get(id);
  if (!rec) continue;
  if (JSON.stringify(rec.members) !== JSON.stringify(ms)) {
    rec.members = ms;
    if (!rec.refs.some((r) => r.source === SRC)) rec.refs.push({ source: SRC });
    inc("members");
  }
  for (const m of ms) if (!allIds.has(m)) missingMats.set(m, { item: m, qty: 0 });
}

// レシピ・箱が参照する素材・袋で data に無いものはスタブを作る
for (const r of recipes) for (const id of [r.result, r.base, ...r.materials.map((m) => m.item)]) if (id && !allIds.has(id)) missingMats.set(id, { item: id, qty: 0 });
for (const d of drops) {
  if (d.location_kind === "box" && !allIds.has(d.location)) missingMats.set(d.location, { item: d.location, qty: 0 });
  for (const e of d.entries) if (!allIds.has(e.item)) missingMats.set(e.item, { item: e.item, qty: 0 });
}

// ---- 足りない素材のスタブ ----
for (const [name] of missingMats) {
  const info = ex.materials?.[name];
  const kind = (info?.kind === "box" ? "box" : "material") as Item["kind"];
  materials.push({
    id: name,
    name,
    kind,
    ...(info?.grade ? { grade: info.grade } : {}),
    ...(info?.description ? { description: info.description } : {}),
    refs: [{ source: SRC, note: "レシピ・強化・箱の素材" }],
  });
  allIds.add(name);
  inc("material.stub");
}

// ---- アイコン (クライアントの _IconImageIndex。画像は dnr-client の icons.py が public/icons/ に書き出す) ----
for (const it of [...items, ...materials]) {
  const icon = ex.icons?.[it.id];
  if (icon === undefined || it.icon === icon) continue;
  it.icon = icon;
  inc("icon");
}

// ---- 参照されなくなった出典 ----
const used = new Set<string>();
for (const coll of [items, materials, outTables, recipes, sets, drops, optionTables, await readJson<any[]>("data/dungeons.json"), groups] as any[][])
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
  await writeJson("ingest/table_aliases.json", Object.fromEntries(Object.entries(tableAliases).sort(([a], [b]) => a.localeCompare(b))));
  await writeJson("data/recipes.json", recipes);
  await writeJson("data/drops.json", drops);
  await writeJson("data/sets.json", sets);
  await writeJson("data/option_tables.json", optionTables);
  await writeJson("ingest/option_aliases.json", optionAliases);
  await writeJson("data/item_groups.json", groups);
}
