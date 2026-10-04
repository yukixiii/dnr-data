// 画面共通の小さな部品。すべて HTML 文字列を返す (値は必ず esc を通す)。
import { dungeonById, itemById, regionsOf, sourceById } from "../data.ts";
import type { Item, ItemKind, Qty, Ref, Stat, StatSet } from "../types.ts";

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

// ---------- 能力値の表 (能力ごとに1列) ----------

/** 確率などの列と能力値の列を合わせてこの列数を超えたら、確率表とステータス表を分ける */
export const SPLIT_MAX_COLS = 9;

export interface GridRow {
  head: string[]; // 行見出し (段階名など)。複数なら複数列
  stats: Stat[];
  cls?: string;
}

/**
 * 能力値の並べ方。
 * - wide: 能力ごとに1列 (基本形)
 * - long: 各行の能力が1つだけで名前がばらばら → 「能力 | 値」の2列
 * - transpose: 能力の種類が行数より多い → 能力を行、段階を列にする
 * - bynote: 同じ行に同名の能力が並ぶ (部位別など) → note ごとに表を分ける
 * note: すべての値に同じ注記が付いているときはセルではなく表の見出しに1回だけ出す
 */
export type StatLayout =
  | { kind: "wide" | "transpose"; cols: string[]; note?: string }
  | { kind: "long"; note?: string }
  | { kind: "bynote"; notes: string[] };

export const statColumns = (rows: Stat[][]) => [...new Set(rows.flat().map((s) => s.name))];

export function statLayout(rows: Stat[][]): StatLayout {
  const all = rows.flat();
  if (rows.some((st) => new Set(st.map((s) => s.name)).size < st.length)) {
    return { kind: "bynote", notes: [...new Set(all.map((s) => s.note ?? ""))] };
  }
  const notes = new Set(all.map((s) => s.note ?? ""));
  const note = notes.size === 1 && !notes.has("") ? [...notes][0] : undefined;
  const cols = statColumns(rows);
  if (cols.length > 1 && rows.every((st) => st.length <= 1)) return { kind: "long", note };
  if (cols.length >= 8 && cols.length > rows.length && rows.length <= 8) return { kind: "transpose", cols, note };
  return { kind: "wide", cols, note };
}

/** 能力値の列数 (表を分けるかの判定用)。bynote/transpose は常に別表 */
export const statColCount = (l: StatLayout) => (l.kind === "wide" ? l.cols.length : l.kind === "long" ? 2 : Infinity);

export function statCell(st: Stat | undefined, hideNote = false) {
  if (!st) return `<td class="num empty">—</td>`;
  return `<td class="num">${esc(st.value)}${st.note && !hideNote ? `<small class="cell-note">${esc(st.note)}</small>` : ""}</td>`;
}

/** wide / long の能力値セル (見出し・行) を返す。確率表と1つの表にまとめるときに使う */
export function statHeadCells(l: StatLayout) {
  if (l.kind === "long") return `<th>能力</th><th>値</th>`;
  if (l.kind === "wide") return l.cols.map((c) => `<th>${esc(c)}</th>`).join("");
  return "";
}
export function statRowCells(l: StatLayout, stats: Stat[]) {
  const hide = "note" in l && !!l.note;
  if (l.kind === "long") return stats.length ? `<td>${esc(stats[0].name)}</td>${statCell(stats[0], hide)}` : `<td></td>${statCell(undefined)}`;
  if (l.kind === "wide") return l.cols.map((c) => statCell(stats.find((s) => s.name === c), hide)).join("");
  return "";
}
export const noteCaption = (l: StatLayout) => ("note" in l && l.note ? `値は「${esc(l.note)}」` : "");

export function statGrid(rows: GridRow[], headLabels: string[], opts: { caption?: string } = {}): string {
  const l = statLayout(rows.map((r) => r.stats));
  if (l.kind === "bynote") {
    return l.notes
      .map((n) =>
        statGrid(
          // 見出しにした note はセルから外す
          rows
            .map((r) => ({ ...r, stats: r.stats.filter((s) => (s.note ?? "") === n).map(({ note: _, ...s }) => s) }))
            .filter((r) => r.stats.length),
          headLabels,
          { caption: [opts.caption, n].filter(Boolean).join(" / ") },
        ),
      )
      .join("");
  }
  const caption = [opts.caption ? esc(opts.caption) : "", noteCaption(l)].filter(Boolean).join(" — ");
  const cap = caption ? `<caption>${caption}</caption>` : "";
  if (l.kind === "transpose") {
    const hide = !!l.note;
    return `<div class="table-wrap"><table class="data statgrid">${cap}
      <thead><tr><th>能力</th>${rows.map((r) => `<th class="${r.cls ?? ""}">${r.head.map(esc).join(" ")}</th>`).join("")}</tr></thead>
      <tbody>${l.cols
        .map((c) => `<tr><th>${esc(c)}</th>${rows.map((r) => statCell(r.stats.find((s) => s.name === c), hide)).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
  }
  return `<div class="table-wrap"><table class="data statgrid">${cap}
    <thead><tr>${headLabels.map((h) => `<th>${esc(h)}</th>`).join("")}${statHeadCells(l)}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ""}>${r.head.map((h) => `<th>${esc(h)}</th>`).join("")}${statRowCells(l, r.stats)}</tr>`)
      .join("")}</tbody></table></div>`;
}

export function statSets(sets: StatSet[] | undefined) {
  if (!sets?.length) return `<p class="muted">ステータス情報なし</p>`;
  // 強化段階別など多数の StatSet は「段階 × 能力値」の1つの表にまとめる
  if (sets.length > 4) return statGrid(sets.map((s) => ({ head: [s.label], stats: s.stats })), ["段階"]);
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
