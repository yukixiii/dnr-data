// 画面共通の小さな部品。すべて HTML 文字列を返す (値は必ず esc を通す)。
import { dungeonById, itemById, regionsOf, sourceById } from "../data.ts";
import type { Item, ItemKind, Qty, Ref, StatSet } from "../types.ts";

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join("/")}`;

export const KIND_LABEL: Record<ItemKind, string> = {
  weapon: "武器",
  armor: "防具",
  accessory: "アクセサリー",
  special_armor: "特殊防具",
  artifact: "アーティファクト",
  talisman: "タリスマン",
  jade: "竜珠",
  heraldry: "紋章",
  material: "素材",
  currency: "通貨",
  box: "箱・袋",
  consumable: "消耗品",
  other: "その他",
};

export function itemLink(id: string, qty?: Qty["qty"]) {
  const item = itemById.get(id);
  const q = qty !== undefined && qty !== "" ? ` <span class="qty">×${esc(qty)}</span>` : "";
  if (!item) return `<span class="missing" title="未登録">${esc(id)}</span>${q}`;
  return `<a class="item-link kind-${item.kind}" href="${href("item", id)}">${esc(item.name)}</a>${q}`;
}

export function locationLink(id: string, kind: string) {
  if (kind === "dungeon" && dungeonById.has(id)) return `<a href="${href("dungeon", id)}">${esc(id)}</a>`;
  if (itemById.has(id)) return itemLink(id);
  return esc(id);
}

/** 出典の地域バッジ。JP 以外の値しかない場合は「海外版の値」と明示する。 */
export function regionBadges(refs: Ref[]) {
  const regions = regionsOf(refs);
  const badges = regions.map((r) => `<span class="badge region-${r}">${r}</span>`).join("");
  const overseas = regions.length > 0 && !regions.includes("JP");
  return badges + (overseas ? `<span class="overseas">海外版の値</span>` : "");
}

export function refList(refs: Ref[]) {
  return `<ul class="refs">${refs
    .map((r) => {
      const s = sourceById.get(r.source);
      if (!s) return `<li>${esc(r.source)}</li>`;
      return `<li><span class="badge region-${s.region}">${s.region}</span> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${
        s.published_at ? ` <span class="muted">${esc(s.published_at)}</span>` : ""
      }${r.note ? ` <span class="muted">— ${esc(r.note)}</span>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

/** 出典を小さく添える (表の行末など) */
export function refInline(refs: Ref[]) {
  return refs
    .map((r) => {
      const s = sourceById.get(r.source);
      return s ? `<a class="ref-inline region-${s.region}" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${s.region}</a>` : "";
    })
    .join("");
}

export function statSets(sets: StatSet[] | undefined) {
  if (!sets?.length) return `<p class="muted">ステータス情報なし</p>`;
  // 強化段階別など多数の StatSet は「段階 × 能力値」の1つの表にまとめる
  if (sets.length > 4) {
    const cols = [...new Set(sets.flatMap((s) => s.stats.map((st) => st.name)))];
    return `<div class="table-wrap"><table class="data statgrid">
      <thead><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${sets
        .map(
          (s) =>
            `<tr><th>${esc(s.label)}</th>${cols
              .map((c) => {
                const st = s.stats.find((x) => x.name === c);
                return `<td class="num">${st ? esc(st.value) : ""}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
  }
  return `<div class="statsets">${sets
    .map(
      (s) => `<div class="statset"><h4>${esc(s.label)}</h4><table class="stats">${s.stats
        .map((st) => `<tr><th>${esc(st.name)}</th><td>${esc(st.value)}${st.note ? ` <span class="muted">${esc(st.note)}</span>` : ""}</td></tr>`)
        .join("")}</table></div>`,
    )
    .join("")}</div>`;
}

export function rateCell(rate?: number, text?: string) {
  if (rate !== undefined) {
    const cls = rate >= 100 ? "rate-full" : rate >= 50 ? "rate-high" : rate >= 10 ? "rate-mid" : "rate-low";
    return `<span class="rate ${cls}">${rate.toLocaleString("ja-JP", { maximumFractionDigits: 4 })}%</span>${text ? ` <span class="muted">${esc(text)}</span>` : ""}`;
  }
  return text ? `<span class="rate-text">${esc(text)}</span>` : `<span class="muted">—</span>`;
}

export function itemMeta(item: Item) {
  const parts = [
    KIND_LABEL[item.kind],
    item.slot,
    item.grade,
    item.level ? `Lv${item.level}` : undefined,
    item.max_enhance ? `最大+${item.max_enhance}` : undefined,
  ].filter(Boolean);
  return parts.map((p) => `<span class="chip">${esc(p)}</span>`).join("");
}

export const empty = (msg: string) => `<p class="empty">${esc(msg)}</p>`;
