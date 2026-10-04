// 作成ルートツリー: 装備 → (レシピ) → 前段装備・素材 → … → 入手先 まで再帰的に展開する。
import { dropsByItem, itemById, recipesByResult } from "../data.ts";
import type { Recipe } from "../types.ts";
import { esc, itemLink, locationLink, rateCell, refInline } from "./ui.ts";

export const RECIPE_LABEL: Record<Recipe["type"], string> = {
  craft: "製作",
  evolve: "進化",
  refine: "精製",
  exchange: "交換",
  upgrade: "強化/増幅",
  dismantle: "分解",
  other: "その他",
};

const MAX_DEPTH = 8;

export function recipeHeader(r: Recipe) {
  const bits = [
    `<span class="recipe-type type-${r.type}">${RECIPE_LABEL[r.type]}</span>`,
    r.where ? esc(r.where) : "",
    r.gold !== undefined ? `<span class="gold">${r.gold.toLocaleString("ja-JP")}G</span>` : "",
    r.rate !== undefined || r.rate_text ? `成功率 ${rateCell(r.rate, r.rate_text)}` : "",
    r.result_qty && r.result_qty > 1 ? `${r.result_qty}個生成` : "",
    refInline(r.refs),
  ].filter(Boolean);
  return `<span class="recipe-head">${bits.join(" ")}</span>${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ""}`;
}

function obtainHint(id: string) {
  const item = itemById.get(id);
  const drops = dropsByItem.get(id) ?? [];
  const locs = [...new Set(drops.map((d) => d.table.location))];
  const parts: string[] = [];
  if (locs.length) {
    const shown = locs.slice(0, 3).map((loc) => locationLink(loc, drops.find((d) => d.table.location === loc)!.table.location_kind));
    parts.push(`入手: ${shown.join("、")}${locs.length > 3 ? ` 他${locs.length - 3}件` : ""}`);
  }
  if (item?.obtain?.length) parts.push(esc(item.obtain.slice(0, 2).join(" / ")));
  return parts.length ? `<span class="obtain-hint">${parts.join(" ・ ")}</span>` : "";
}

function node(id: string, qty: string | number | undefined, depth: number, seen: Set<string>): string {
  const recipes = recipesByResult.get(id) ?? [];
  const label = `${itemLink(id, qty)} ${obtainHint(id)}`;
  if (!recipes.length || depth >= MAX_DEPTH || seen.has(id)) {
    return `<li class="leaf">${label}${seen.has(id) ? ` <span class="muted">(循環)</span>` : ""}</li>`;
  }
  const next = new Set(seen).add(id);
  const body = recipes.map((r) => recipeBlock(r, depth, next)).join("");
  // 浅い階層は開いた状態、深い階層は畳む
  return `<li><details ${depth < 2 ? "open" : ""}><summary>${label}</summary>${body}</details></li>`;
}

function recipeBlock(r: Recipe, depth: number, seen: Set<string>) {
  const children = [
    ...(r.base ? [node(r.base, "ベース", depth + 1, seen)] : []),
    ...r.materials.map((m) => node(m.item, m.qty, depth + 1, seen)),
  ];
  return `<div class="recipe">${recipeHeader(r)}<ul class="tree">${children.join("")}</ul></div>`;
}

export function recipeTree(id: string) {
  const recipes = recipesByResult.get(id) ?? [];
  if (!recipes.length) return "";
  return recipes.map((r) => recipeBlock(r, 0, new Set([id]))).join("");
}
