// 装備・素材一覧 (フィルタ・検索)。段階違いの同一装備は1件にまとめる
import { allItems, defaultMember, ds, groupCountLabel, isIntra, listUnits, recipesByResult, tablesByItem, type ListUnit } from "../data.ts";
import type { Item } from "../types.ts";
import { SHOWN_KIND_LABEL, empty, esc, itemAnchor, itemLink, itemMeta, regionBadges, shownKind, type ShownKind } from "../components/ui.ts";

const EQUIP_KINDS: ShownKind[] = ["weapon", "armor", "accessory", "brooch", "special_armor", "artifact", "talisman", "jade", "heraldry"];
const MAT_KINDS: ShownKind[] = ["material", "currency", "box", "consumable", "other"];

export function matches(item: Item, q: string) {
  if (!q) return true;
  const hay = [item.name, item.name_ko, item.name_zh, item.series, item.slot, item.description].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

const unitName = (u: ListUnit) => u.group?.name ?? u.item.name;

/** グループは名前で、ステータスのある最終段階のページへ */
export const unitLink = (u: ListUnit) =>
  u.group ? itemAnchor(u.item, defaultMember(u.group), u.group.name) : itemLink(u.item.id);

function unitCard(u: ListUnit) {
  const { item, group, members } = u;
  const title = unitLink(u);
  const recipes = members.flatMap((m) => recipesByResult.get(m.id) ?? []);
  const tags = [
    recipes.some((r) => !isIntra(r)) ? `<span class="tag">作成ルート</span>` : "",
    recipes.some(isIntra) ? `<span class="tag">段階強化</span>` : "",
    members.some((m) => tablesByItem.has(m.id)) ? `<span class="tag">強化表</span>` : "",
  ].join("");
  return `<li class="card">
    <div class="card-title">${title}</div>
    <div class="card-meta">${itemMeta(item)}${group ? `<span class="chip stages">${groupCountLabel(group)}</span>` : ""}</div>
    <div class="card-foot">${regionBadges(members.flatMap((m) => m.refs))}${tags}</div>
  </li>`;
}

export function renderItemList(query: URLSearchParams, mode: "equipment" | "materials") {
  const q = query.get("q") ?? "";
  const kind = query.get("kind") ?? "";
  const series = query.get("series") ?? "";
  const kinds = mode === "equipment" ? EQUIP_KINDS : MAT_KINDS;
  const units = listUnits(mode);
  const pool = mode === "equipment" ? ds.items : ds.materials;

  const seriesList = [...new Set(pool.map((x) => x.series).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ja"));
  // グループはどれか1段階でも条件に合えば表示 (グループ名でも検索できる)
  const list = units.filter(
    (u) =>
      (!kind || u.members.some((m) => shownKind(m) === kind)) &&
      (!series || u.members.some((m) => m.series === series)) &&
      (u.members.some((m) => matches(m, q)) || (!!u.group && matches({ ...u.item, name: u.group.name }, q))),
  );

  // 系統ごとにまとめる (系統なしは種類名で)
  const groups = new Map<string, ListUnit[]>();
  for (const u of list) {
    const key = u.series || SHOWN_KIND_LABEL[shownKind(u.item)];
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"));
  const grouped = units.filter((u) => u.group).length;

  const title = mode === "equipment" ? "装備" : "素材・アイテム";
  return `
  <h1>${title}一覧</h1>
  <form class="filters" data-filter>
    <input type="search" name="q" value="${esc(q)}" placeholder="名前・系統で検索 (日/韓/中)" aria-label="検索">
    <select name="kind" aria-label="種類">
      <option value="">すべての種類</option>
      ${kinds.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${SHOWN_KIND_LABEL[k]}</option>`).join("")}
    </select>
    ${
      seriesList.length
        ? `<select name="series" aria-label="系統"><option value="">すべての系統</option>${seriesList
            .map((s) => `<option ${s === series ? "selected" : ""}>${esc(s)}</option>`)
            .join("")}</select>`
        : ""
    }
  </form>
  <p class="muted">${list.length} / ${units.length} 件${grouped ? ` (強化・段階・増幅などの違いは1件にまとめています)` : ""}</p>
  ${
    list.length
      ? sortedGroups
          .map(
            ([g, arr]) => `
    <section class="group">
      <h2>${esc(g)} <span class="count">${arr.length}</span></h2>
      <ul class="cards">${arr
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || unitName(a).localeCompare(unitName(b), "ja"))
        .map(unitCard)
        .join("")}</ul>
    </section>`,
          )
          .join("")
      : empty("該当するアイテムがありません")
  }`;
}

export const totalCounts = () => ({ equipment: ds.items.length, materials: ds.materials.length, all: allItems.length });
