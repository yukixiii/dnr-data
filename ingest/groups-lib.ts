// 段階・等級・増幅などの違いだけで「同じ装備」とみなすアイテムのまとめ方 (data/item_groups.json の生成・検証で共用)。
// 規則: 名前から段階/等級/増幅/[真]/祝福 などの印を外した本体名が同じものを1装備にまとめる。
// 例外: ブローチはキャラクターごとに1系統 (封印された力 → 次元/異界/信念 を含む)。
import type { Item } from "../src/types.ts";

const EQUIP_KINDS = new Set(["weapon", "armor", "accessory", "special_armor", "artifact", "talisman", "jade", "heraldry"]);

/** 名前の規則に当てはまっても別物として扱うもの */
export const GROUP_EXCLUDE = new Set(["永遠のタリスマン", "永遠のタリスマン1段階", "[未完]王城の紋章"]);

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
const SUFFIXES = [/\(\d+段階\)$/, /\((マジック|レア|エピック|ユニーク|レジェンド|エンシェント|上級|ヒロイック)\)$/, /\[Ⅱ\]$/];
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
  const marks: [RegExp, number, string][] = [
    [/^下級/, 1, "下級"],
    [/^中級/, 2, "中級"],
    [/^上級|\(上級\)$/, 3, "上級"],
    [/\(ヒロイック\)$/, 4, "ヒロイック"],
    [/\(マジック\)$/, 1, "マジック"],
    [/\(レア\)$/, 2, "レア"],
    [/\(エピック\)$/, 3, "エピック"],
    [/\(ユニーク\)$/, 1, "ユニーク"],
    [/\(レジェンド\)$/, 2, "レジェンド"],
    [/\(エンシェント\)$/, 3, "エンシェント"],
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
