// 装備/素材の詳細: ステータス・作成ルート・強化表・入手先・使用先・出典
import {
  dropsByItem,
  dropsByLocation,
  itemById,
  newestFirst,
  recipesByBase,
  recipesByMaterial,
  recipesByResult,
  refDate,
  selfRecipes,
  tablesByItem,
  tablesByMaterial,
} from "../data.ts";
import { recipeHeader, recipeTree, RECIPE_LABEL } from "../components/recipeTree.ts";
import { empty, esc, href, itemLink, itemMeta, locationLink, rateCell, refInline, refList, regionBadges, statSets } from "../components/ui.ts";
import { dropTableHtml } from "./drops.ts";

// 説明文に推定・仮名称である旨が書かれているアイテム
const PROVISIONAL = /名称[^。]*(推定|類推)|便宜上|仮の名称/;

export function renderItemDetail(id: string) {
  const item = itemById.get(id);
  if (!item) return `<h1>${esc(id)}</h1>${empty("このアイテムは登録されていません")}`;

  const produced = recipesByResult.get(id) ?? [];
  const nextTier = recipesByBase.get(id) ?? [];
  const usedIn = recipesByMaterial.get(id) ?? [];
  const tables = newestFirst(tablesByItem.get(id) ?? []);
  const tablesUsing = tablesByMaterial.get(id) ?? [];
  const drops = [...(dropsByItem.get(id) ?? [])].sort((a, b) => refDate(b.table.refs).localeCompare(refDate(a.table.refs)));
  const contents = item.kind === "box" ? (dropsByLocation.get(id) ?? []) : [];

  const sections: string[] = [];

  if (item.stats?.length || !["material", "currency", "box", "consumable"].includes(item.kind)) {
    sections.push(`<section><h2>ステータス</h2>${statSets(item.stats)}</section>`);
  }

  if (produced.length) {
    sections.push(`<section><h2>作成ルート</h2>
      <p class="muted">▶ をクリックで展開。各素材の入手先まで辿れます。</p>
      <div class="recipe-tree">${recipeTree(id)}</div></section>`);
  }

  const selfOps = selfRecipes.get(id) ?? [];
  if (selfOps.length) {
    sections.push(`<section><h2>加工 (進化・ロック等)</h2><ul class="plain">${selfOps
      .map((r) => `<li>${recipeHeader(r)}<div>${r.materials.map((m) => itemLink(m.item, m.qty)).join("、")}</div></li>`)
      .join("")}</ul></section>`);
  }

  if (nextTier.length) {
    sections.push(`<section><h2>次の段階 (この装備をベースに作成)</h2><ul class="plain">${nextTier
      .map((r) => `<li>${itemLink(r.result)} — ${recipeHeader(r)}</li>`)
      .join("")}</ul></section>`);
  }

  if (tables.length) {
    sections.push(`<section><h2>強化・段階確率</h2>${tables
      .map(
        (t) =>
          `<p><a href="${href("enhance", t.id)}">${esc(t.name)}</a> ${refInline(t.refs)} <span class="muted">${esc(refDate(t.refs))} 告知 / ${t.rows.length}段階${
            t.rows.at(-1)?.rate !== undefined ? ` / 最終段階 ${t.rows.at(-1)!.rate}%` : ""
          }</span></p>`,
      )
      .join("")}</section>`);
  }

  if (drops.length) {
    sections.push(`<section><h2>入手先・ドロップ率</h2>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>入手先</th><th>区分</th><th>獲得元</th><th>階層/条件</th><th>確率</th><th>個数</th><th>告知日</th></tr></thead>
        <tbody>${drops
          .map(
            ({ table, entry }) => `<tr>
              <td>${locationLink(table.location, table.location_kind)}</td>
              <td>${esc(table.label ?? "")}</td>
              <td>${esc(entry.from ?? "")}</td>
              <td>${esc(entry.floors ?? "")}</td>
              <td>${rateCell(entry.rate, entry.rate_text)}</td>
              <td>${esc(entry.qty ?? "")}</td>
              <td class="num">${esc(refDate(table.refs))}${refInline(table.refs)}</td></tr>`,
          )
          .join("")}</tbody></table></div></section>`);
  }

  if (contents.length) {
    sections.push(`<section><h2>中身・提供割合</h2>${contents.map(dropTableHtml).join("")}</section>`);
  }

  if (item.obtain?.length) {
    sections.push(`<section><h2>入手方法メモ</h2><ul class="plain">${item.obtain.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></section>`);
  }

  if (usedIn.length || tablesUsing.length) {
    sections.push(`<section><h2>使用先</h2><ul class="plain">${usedIn
      .map((r) => {
        const q = r.materials.find((m) => m.item === id)?.qty;
        return `<li>${itemLink(r.result)} の${RECIPE_LABEL[r.type]} <span class="qty">×${esc(q)}</span> ${refInline(r.refs)}</li>`;
      })
      .concat(tablesUsing.map((t) => `<li><a href="${href("enhance", t.id)}">${esc(t.name)}</a> の強化素材</li>`))
      .join("")}</ul></section>`);
  }

  sections.push(`<section><h2>出典</h2>${refList(item.refs)}</section>`);

  return `
  <nav class="crumbs"><a href="${href(["material", "currency", "box", "consumable", "other"].includes(item.kind) ? "materials" : "items")}">一覧</a>${
    item.series ? ` › <a href="#/items?series=${encodeURIComponent(item.series)}">${esc(item.series)}</a>` : ""
  }</nav>
  <header class="detail-head">
    <h1>${esc(item.name)}</h1>
    <div class="names">${[item.name_ko, item.name_zh].filter(Boolean).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
    <div class="meta">${itemMeta(item)}${
      PROVISIONAL.test(item.description ?? "") ? `<span class="chip warn" title="公式に部位別の正式名称が無く、推定した名称です">名称推定</span>` : ""
    }${item.tradable ? `<span class="chip">${esc(item.tradable)}</span>` : ""} ${regionBadges(item.refs)}</div>
    ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ""}
  </header>
  ${sections.join("")}`;
}

