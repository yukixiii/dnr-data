// 装備・素材一覧 (フィルタ・検索)
import { allItems, ds, recipesByResult, tablesByItem } from "../data.ts";
import type { Item, ItemKind } from "../types.ts";
import { KIND_LABEL, empty, esc, itemLink, itemMeta, regionBadges } from "../components/ui.ts";

const EQUIP_KINDS: ItemKind[] = ["weapon", "armor", "accessory", "special_armor", "artifact", "talisman", "jade", "heraldry"];
const MAT_KINDS: ItemKind[] = ["material", "currency", "box", "consumable", "other"];

export function matches(item: Item, q: string) {
  if (!q) return true;
  const hay = [item.name, item.name_ko, item.name_zh, item.series, item.slot, item.description].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function renderItemList(query: URLSearchParams, mode: "equipment" | "materials") {
  const q = query.get("q") ?? "";
  const kind = query.get("kind") ?? "";
  const series = query.get("series") ?? "";
  const kinds = mode === "equipment" ? EQUIP_KINDS : MAT_KINDS;
  const pool = mode === "equipment" ? ds.items : ds.materials;

  const seriesList = [...new Set(pool.map((x) => x.series).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ja"));
  const list = pool.filter((x) => (!kind || x.kind === kind) && (!series || x.series === series) && matches(x, q));

  // 系統ごとにまとめる (系統なしは種類名で)
  const groups = new Map<string, Item[]>();
  for (const it of list) {
    const key = it.series || KIND_LABEL[it.kind];
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"));

  const title = mode === "equipment" ? "装備" : "素材・アイテム";
  return `
  <h1>${title}一覧</h1>
  <form class="filters" data-filter>
    <input type="search" name="q" value="${esc(q)}" placeholder="名前・系統で検索 (日/韓/中)" aria-label="検索">
    <select name="kind" aria-label="種類">
      <option value="">すべての種類</option>
      ${kinds.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${KIND_LABEL[k]}</option>`).join("")}
    </select>
    ${
      seriesList.length
        ? `<select name="series" aria-label="系統"><option value="">すべての系統</option>${seriesList
            .map((s) => `<option ${s === series ? "selected" : ""}>${esc(s)}</option>`)
            .join("")}</select>`
        : ""
    }
  </form>
  <p class="muted">${list.length} / ${pool.length} 件</p>
  ${
    list.length
      ? sortedGroups
          .map(
            ([g, arr]) => `
    <section class="group">
      <h2>${esc(g)} <span class="count">${arr.length}</span></h2>
      <ul class="cards">${arr
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, "ja"))
        .map(
          (it) => `<li class="card">
            <div class="card-title">${itemLink(it.id)}</div>
            <div class="card-meta">${itemMeta(it)}</div>
            <div class="card-foot">${regionBadges(it.refs)}${recipesByResult.has(it.id) ? `<span class="tag">作成ルート</span>` : ""}${
              tablesByItem.has(it.id) ? `<span class="tag">強化表</span>` : ""
            }</div>
          </li>`,
        )
        .join("")}</ul>
    </section>`,
          )
          .join("")
      : empty("該当するアイテムがありません")
  }`;
}

export const totalCounts = () => ({ equipment: ds.items.length, materials: ds.materials.length, all: allItems.length });
