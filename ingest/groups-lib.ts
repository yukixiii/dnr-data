// 段階・等級・増幅などの違いだけで「同じ装備」とみなすアイテムのまとめ方 (data/item_groups.json の生成・検証で共用)。
// 規則: 名前から段階/等級/増幅/[真]/祝福 などの印を外した本体名が同じものを1装備にまとめる。
// 例外: ブローチはキャラクターごとに1系統 (封印された力 → 次元/異界/信念 を含む)。
import type { Item, ItemGroup } from "../src/types.ts";

const EQUIP_KINDS = new Set(["weapon", "armor", "accessory", "special_armor", "artifact", "talisman", "jade", "heraldry"]);

/** 名前の規則に当てはまっても別物として扱うもの */
export const GROUP_EXCLUDE = new Set([
  "永遠のタリスマン",
  "永遠のタリスマン1段階",
  "[未完]王城の紋章",
  // 崩壊の竜珠のエピックは新規・復帰向けの別ルートで、ユニーク (月食の竜珠の系列の最後) へは進化しない
  "崩壊の攻撃竜珠(エピック)",
  "崩壊の防御竜珠(エピック)",
]);

/**
 * まとめる対象。装備系 kind に加え、段階付きで能力値を持つ「その他」(超越の箱舟の 過去の化石 等) と、
 * 素材扱いで登録されているセイヴィア紋章(上級)。素材・消耗品 (上級月食のかけら、エヴォハンマー(N段階) 等) は対象外。
 */
export function isGroupable(it: Item): boolean {
  if (GROUP_EXCLUDE.has(it.id)) return false;
  if (EQUIP_KINDS.has(it.kind)) return true;
  if (it.kind === "other" && it.stats?.length && /\(\d+段階\)$/.test(it.id)) return true;
  return /のセイヴィア紋章\(上級\)$/.test(it.id);
}

const PREFIXES = [/^\+\d+\s*\d+細工/, /^\[\d+段階(：[^\]]+)?\]/, /^\[祝福：[^\]]+\]/, /^\[増幅\]/, /^\[真\]/, /^祝福された/, /^(下級|中級|上級)/];
const SUFFIXES = [
  /\(\d+段階\)$/,
  /\((ノーマル|マジック|レア|エピック|ユニーク|レジェンド|エンシェント|下級|中級|上級|ヒロイック)\)$/,
  /\((物理|魔法|混合|火|氷|雷|闇)\)$/,
  /\[Ⅱ\]$/,
];
const BROOCH = /(ベルスカード|ネルウィン|テラマイ|カーラ|バルナック)ブローチ$/;

/** 段階などの印を外した本体名 = グループ id */
export function baseNameOf(id: string): string {
  let cur = id;
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of [...PREFIXES, ...SUFFIXES]) {
      const next = cur.replace(re, "").trim();
      if (next !== cur && next) {
        cur = next;
        changed = true;
      }
    }
  }
  const brooch = cur.match(BROOCH);
  if (brooch) return `${brooch[1]}ブローチ`;
  // 祝福された[増幅]古竜のメインウェポン だけ「の」入りの表記
  return cur.replace(/^古竜の(メイン|サブ)ウェポン$/, "古竜$1ウェポン");
}

/** 並び順と表示ラベル。phase はブローチの「封印/マジック/…/次元」のような段階の区切り */
export function stageInfo(id: string): { rank: number; n: number; phase?: string; label: string } {
  const n = Number(id.match(/(\d+)段階/)?.[1] ?? 0);
  // 等級は 1 未満の小数で順序だけ付ける (段階・増幅などの印より前)
  const marks: [RegExp, number, string][] = [
    [/^下級|\(下級\)$/, 1, "下級"],
    [/^中級|\(中級\)$/, 2, "中級"],
    [/^上級|\(上級\)$/, 3, "上級"],
    [/\(ヒロイック\)$/, 4, "ヒロイック"],
    [/\(ノーマル\)$/, 0.1, "ノーマル"],
    [/\(マジック\)$/, 0.2, "マジック"],
    [/\(レア\)$/, 0.3, "レア"],
    [/\(エピック\)$/, 0.4, "エピック"],
    [/\(ユニーク\)$/, 0.5, "ユニーク"],
    [/\(レジェンド\)$/, 0.6, "レジェンド"],
    [/\(エンシェント\)$/, 0.7, "エンシェント"],
    [/\(物理\)$/, 0, "物理"],
    [/\(魔法\)$/, 0, "魔法"],
    [/\(混合\)$/, 0, "混合"],
    [/\(火\)$/, 0, "火"],
    [/\(氷\)$/, 0, "氷"],
    [/\(雷\)$/, 0, "雷"],
    [/\(闇\)$/, 0, "闇"],
    [/\[Ⅱ\]$/, 5, "Ⅱ"],
    [/^\[真\]/, 6, "真"],
    [/^祝福された/, 8, "祝福"],
    [/^\[増幅\]|^祝福された\[増幅\]/, 7, "増幅"],
    [/^\[\d+段階\](次元|異界)/, 10, ""],
    [/^\[\d+段階：/, 10, ""],
    [/^\[祝福：/, 11, "祝福"],
    [/^\+\d+/, 12, id.match(/^\+\d+\s*\d+細工/)?.[0] ?? ""],
  ];
  let rank = 0;
  const words: string[] = [];
  for (const [re, r, w] of marks) {
    if (!re.test(id)) continue;
    rank = Math.max(rank, r);
    if (w && !words.includes(w)) words.push(w);
  }
  const stage = n ? `${n}段階` : "";

  if (/(ベルスカード|ネルウィン|テラマイ|カーラ|バルナック)ブローチ/.test(id)) {
    const phase = /^\[\d+段階\]次元/.test(id)
      ? "次元"
      : /^\[\d+段階\]異界/.test(id)
        ? "異界"
        : /^\[(\d+段階|祝福)：異界\]信念/.test(id)
          ? "信念(異界)"
          : (id.match(/\((マジック|レア|エピック)\)$/)?.[1] ?? "封印");
    const label = /^\[祝福：/.test(id) ? "祝福" : stage || "基本";
    return { rank, n, phase, label };
  }
  return { rank, n, label: [...words, stage].filter(Boolean).join(" ") || "通常" };
}

/**
 * まとめ規則に当てはまるのにどのグループにも入っていないアイテムをグループに足す (既存のグループに追加 / 新しいグループ)。
 * 戻り値は追加したメンバーの [グループ id, アイテム id]。groups は書き換える。
 */
export function completeGroups(groups: ItemGroup[], items: Item[]): [string, string][] {
  const added: [string, string][] = [];
  const inGroup = new Set(groups.flatMap((g) => g.members.map((m) => m.item)));
  const byBase = new Map<string, string[]>();
  for (const it of items) if (isGroupable(it)) byBase.set(baseNameOf(it.id), [...(byBase.get(baseNameOf(it.id)) ?? []), it.id]);
  for (const [b, ids] of byBase) {
    const missing = ids.filter((id) => !inGroup.has(id));
    if (ids.length < 2 || !missing.length) continue;
    let g = groups.find((x) => x.id === b) ?? groups.find((x) => x.members.some((m) => ids.includes(m.item)));
    if (!g) groups.push((g = { id: b, name: b, members: [] }));
    for (const id of missing) {
      const st = stageInfo(id);
      g.members.push({ item: id, label: st.label, ...(st.phase ? { phase: st.phase } : {}) });
      added.push([g.id, id]);
    }
    if (!g.members.some((m) => m.phase))
      g.members.sort((a, c) => {
        const x = stageInfo(a.item), y = stageInfo(c.item);
        return x.rank - y.rank || x.n - y.n;
      });
  }
  return added;
}
