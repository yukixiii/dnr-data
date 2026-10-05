// データ型定義。data/*.json はこの形に従う (検証は data/schema/dnr.schema.json)。
// アイテム・ダンジョンの id は日本語の正式名称そのもの (例: "ベルスカードの責任")。
// 地域をまたいで同名が別物になる場合のみ "名称@KR" のように接尾辞を付ける。

export type Region = "JP" | "KR" | "CN";

/** 出典参照。region は sources.json の地域を上書きしたい場合のみ指定。 */
export interface Ref {
  source: string;
  note?: string;
}

export interface Source {
  id: string; // 例: "jp-notice-1440", "jp-vipwiki-status", "cn-dngamer-1091"
  url: string;
  region: Region;
  kind: "official" | "wiki" | "community";
  title: string;
  published_at?: string; // YYYY-MM-DD
  fetched_at: string; // YYYY-MM-DD
}

export interface Stat {
  name: string; // "物理/魔法攻撃力", "FD", "HP(%)" など表記は出典準拠
  value: string; // "260,000" / "17.00%" など出典の表記をそのまま
  note?: string;
}

/** 強化段階など条件別のステータス */
export interface StatSet {
  label: string; // "+0", "+10", "(L)", "基本" など
  stats: Stat[];
}

export type ItemKind =
  | "weapon"
  | "armor"
  | "accessory"
  | "special_armor" // 羽・尻尾・デカール等
  | "artifact"
  | "talisman"
  | "jade" // 竜珠
  | "heraldry" // 紋章
  | "material"
  | "currency"
  | "box" // 袋・箱 (中身は drops.json)
  | "consumable"
  | "other";

export interface Item {
  id: string;
  name: string;
  name_ko?: string;
  name_zh?: string;
  kind: ItemKind;
  slot?: string; // "ヘルム" "メイン武器" 等
  grade?: string; // "ノーマル" "マジック" "レア" "エピック" "ユニーク" "レジェンド" "ディヴァイン" 等
  level?: number;
  series?: string; // "金竜装備" "古竜装備" "ベルスカードアーティファクト" など系統
  max_enhance?: number;
  tradable?: string; // "取引不可" "1回取引可" 等
  set?: string; // ItemSet.id (data/sets.json)
  description?: string;
  stats?: StatSet[];
  obtain?: string[]; // 入手方法の要約 (ドロップは drops.json から逆引きされるので重複不要)
  members?: string[]; // 総称のアイテム (「月食のかけら」など) に含まれるアイテムの id
  refs: Ref[];
}

/** セット効果 (data/sets.json)。同じセットのアイテムを count 個以上装備すると bonuses が付く */
export interface SetBonus {
  count: number;
  stats?: Stat[];
  skill?: string; // スキル型の効果の説明
}

export interface ItemSet {
  id: string; // 例: "client-864027618"
  name: string; // "ヘイズフロストドラゴン防具" など
  description?: string;
  bonuses: SetBonus[];
  notes?: string;
  refs: Ref[];
}

export interface Qty {
  item: string; // Item.id
  qty: number | string; // 数値が不明/範囲なら文字列 ("1~3")
}

export interface Recipe {
  id: string;
  type: "craft" | "evolve" | "refine" | "exchange" | "upgrade" | "dismantle" | "other";
  result: string; // Item.id
  result_qty?: number;
  base?: string; // 消費される前段装備の Item.id
  materials: Qty[];
  gold?: number;
  where?: string; // NPC/商店/システム名
  rate?: number; // 成功率 %
  rate_text?: string;
  notes?: string;
  refs: Ref[];
}

export interface EnhanceRow {
  level: string; // "+1" / "0→1" / "1段階" 等
  rate?: number; // %
  rate_text?: string;
  gold?: number | string;
  materials?: Qty[];
  on_fail?: string; // "維持" "-1" "破壊" 等
  stats?: Stat[]; // その段階で上がる能力値があれば
  evolve?: string; // 強化ではなく進化の行 (+15 で進化してから続きを強化する装備など)。説明文
}

export interface EnhanceTable {
  id: string;
  name: string;
  kind: "enhance" | "craft_stage" | "refine" | "evolve" | "other";
  applies_to: string[]; // Item.id (空なら applies_note を参照)
  applies_note?: string;
  rows: EnhanceRow[];
  notes?: string;
  refs: Ref[];
}

export interface DropEntry {
  item: string; // Item.id
  from?: string; // "一般魔物" "ボス" "金箱" "安息所" 等
  floors?: string; // "AS-05階層～" 等
  rate?: number; // %
  rate_text?: string; // "確定" "一定確率" "低確率" 等の定性表記
  qty?: number | string;
}

export interface DropTable {
  id: string;
  location: string; // Dungeon.id か Item.id(kind=box)
  location_kind: "dungeon" | "box" | "shop" | "quest" | "gather" | "other";
  label?: string; // "クリア報酬" "採集" 等
  entries: DropEntry[];
  // 表示の形。item_columns: 行 = 階層、列 = アイテム、セル = 個数 (全階層の行は表の上に書く)
  layout?: "item_columns";
  notes?: string;
  refs: Ref[];
}

export interface Dungeon {
  id: string;
  name: string;
  kind: "nest" | "stage" | "dungeon" | "raid" | "pvp" | "event" | "other";
  entry?: string; // 入場条件・場所
  level?: number;
  difficulty?: string;
  notes?: string;
  refs: Ref[];
}

/** 段階・等級・増幅などの違いだけの同一装備グループ (data/item_groups.json)。生成規則は ingest/groups-lib.ts */
export interface GroupMember {
  item: string; // Item.id
  label: string; // "3段階" "増幅" "通常" など
  phase?: string; // 段階の区切り (ブローチの "封印" "マジック" "次元" 等)
  from?: string; // レシピ未登録だが原文から前段と分かるメンバーの Item.id
  via?: string; // その段階を説明する総称レシピの Recipe.id
}

export interface ItemGroup {
  id: string; // 印を外した本体名 (メンバーの id と同じこともある)
  name: string;
  members: GroupMember[]; // 段階順
  notes?: string;
  refs?: Ref[];
}

/** ランダムオプション (潜在能力) の候補 1 つ */
export interface OptionEntry {
  text: string; // "物理/魔法防御力6000上昇" など効果の説明
  rate: number; // その行でこの候補が選ばれる確率 %
}

/** オプションの再付与 1 通り (箱舟の力など) */
export interface OptionReroll {
  kind: "random" | "select" | "lock"; // ランダム (取り消し不可) / 選択 (変更前に戻せる) / ロック (lock 行を固定)
  lines: number[]; // 再付与される行 (1 始まり)
  lock?: number; // 固定できる行の数
  gold?: number;
  materials: (Qty & { alt?: string[] })[]; // alt: 代わりに使えるアイテム (取引不可版など)
}

/** ランダムオプションの表 (data/option_tables.json)。行ごとに候補表から 1 つ選ばれる */
export interface OptionTable {
  id: string;
  name: string;
  applies_to: string[]; // Item.id
  applies_parts?: Record<string, string>; // 総称のアイテム → この表が当たる部位 ("ヘルム・アーマー")
  lines: string[]; // 行ごとの候補表 (pools の id)。行数 = 長さ
  pools: Record<string, OptionEntry[]>;
  rerolls: OptionReroll[];
  notes?: string;
  refs: Ref[];
}

export interface Dataset {
  sources: Source[];
  items: Item[];
  materials: Item[];
  recipes: Recipe[];
  enhance_tables: EnhanceTable[];
  drops: DropTable[];
  dungeons: Dungeon[];
  sets: ItemSet[];
  option_tables: OptionTable[];
}
