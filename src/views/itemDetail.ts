// 装備/素材の詳細: ステータス・作成ルート・強化表・入手先・使用先・出典
// 段階違いの同一装備 (data/item_groups.json) は1ページにまとめ、段階を切り替えて見る。
import {
  dropsByItem,
  dropsByLocation,
  isIntra,
  itemById,
  memberIndex,
  memberLabel,
  newestFirst,
  recipeById,
  recipesByBase,
  recipesByMaterial,
  recipesByResult,
  groupCountLabel,
  groupOf,
  setById,
  setMembers,
  refDate,
  sortDate,
  resolveDetail,
  selfRecipes,
  tablesByItem,
  tablesByMaterial,
} from "../data.ts";
import { RECIPE_LABEL, recipeHeader, routeSection, stageTable } from "../components/routeView.ts";
import type { Transition } from "../route.ts";
import type { ItemGroup, ItemSet, Ref } from "../types.ts";
import { empty, esc, href, itemLink, itemMeta, locationLink, rateCell, refInline, refList, regionBadges, statGrid, statSets } from "../components/ui.ts";
import { dropTableHtml } from "./drops.ts";

// 説明文に推定・仮名称である旨が書かれているアイテム
const PROVISIONAL = /名称[^。]*(推定|類推)|便宜上|仮の名称/;
const NON_EQUIP = ["material", "currency", "box", "consumable"];

/** 段階の切り替え。phase (封印/マジック/…/次元) ごとに1行 */
function stageNav(g: ItemGroup, focus: string) {
  const rows: { phase?: string; chips: string[] }[] = [];
  for (const m of g.members) {
    const chip = `<a class="stage-chip" href="${href("item", m.item)}"${m.item === focus ? ` aria-current="page"` : ""} title="${esc(m.item)}">${esc(m.label)}</a>`;
    const last = rows[rows.length - 1];
    if (last && last.phase === m.phase) last.chips.push(chip);
    else rows.push({ phase: m.phase, chips: [chip] });
  }
  return `<nav class="stage-nav" aria-label="段階">${rows
    .map((r) => `<div class="stage-row">${r.phase ? `<span class="stage-phase">${esc(r.phase)}</span>` : ""}${r.chips.join("")}</div>`)
    .join("")}</nav>`;
}

function statsSection(ids: string[], focus: string, grouped: boolean) {
  const items = ids.map((x) => itemById.get(x)!);
  if (!grouped) return statSets(items[0].stats);
  const withStats = items.filter((it) => it.stats?.length);
  const missing = items.filter((it) => !it.stats?.length);
  const note = missing.length && withStats.length ? `<p class="muted">ステータス未登録: ${missing.map((it) => esc(memberLabel(it.id))).join("、")}</p>` : "";
  if (!withStats.length) return statSets(undefined);
  // 「段階 × 能力」の1つの表にまとめる (強化値別など複数組あれば 条件 列を足す)。行が多すぎるときだけ段階ごとに分ける
  const sets = withStats.flatMap((it) => it.stats!.map((s) => ({ it, s })));
  if (sets.length <= 40) {
    const showSet = sets.some(({ s }) => !["基本", ""].includes(s.label));
    return (
      statGrid(
        sets.map(({ it, s }) => ({
          head: showSet ? [memberLabel(it.id), s.label] : [memberLabel(it.id)],
          stats: s.stats,
          cls: it.id === focus ? "is-focus" : undefined,
        })),
        showSet ? ["段階", "条件"] : ["段階"],
      ) + note
    );
  }
  return (
    withStats
      .map((it) => `<details class="member-stats" ${it.id === focus ? "open" : ""}><summary>${esc(memberLabel(it.id))}</summary>${statSets(it.stats)}</details>`)
      .join("") + note
  );
}

/** セット効果: 必要数ごとの効果と、同じセットの装備 (グループは 1 件にまとめる) */
function setSection(set: ItemSet, focus: string) {
  const members = setMembers.get(set.id) ?? [];
  const units = [...new Set(members.map((id) => groupOf(id)?.id ?? id))];
  const bonus = set.bonuses
    .map((b) => `<tr><th>${b.count}セット</th><td>${[...(b.stats ?? []).map((s) => `${esc(s.name)} ${esc(s.value)}`), ...(b.skill ? [esc(b.skill)] : [])].join("、")}</td></tr>`)
    .join("");
  return `<p><strong>${esc(set.name)}</strong>${set.description ? ` <span class="muted">${esc(set.description)}</span>` : ""}</p>
    <table class="stats"><tbody>${bonus}</tbody></table>
    <p class="muted">対象: ${units.map((u) => (u === (groupOf(focus)?.id ?? focus) ? `<strong>${esc(u)}</strong>` : `<a href="${href("item", u)}">${esc(u)}</a>`)).join("、")}</p>`;
}

/** グループ内の段階上げ (レシピ + 原文から前段だけ分かるもの) を段階順に */
function stageTransitions(g: ItemGroup): Transition[] {
  const ts: Transition[] = [];
  for (const m of g.members) {
    for (const r of recipesByResult.get(m.item) ?? []) if (isIntra(r)) ts.push({ from: r.base!, to: m.item, recipe: r });
    if (m.from) {
      const via = m.via ? recipeById.get(m.via) : undefined;
      ts.push({ from: m.from, to: m.item, recipe: via, generic: !!via });
    }
  }
  return ts.sort((a, b) => memberIndex(g, a.to) - memberIndex(g, b.to) || memberIndex(g, a.from) - memberIndex(g, b.from));
}

/** 段階が一本道 (前の行の結果が次の行のベース) のときだけ累計を出す */
const isLinear = (ts: Transition[]) => ts.every((t, i) => i === 0 || ts[i - 1].to === t.from);

export function renderItemDetail(id: string) {
  const res = resolveDetail(id);
  if (!res) return `<h1>${esc(id)}</h1>${empty("このアイテムは登録されていません")}`;
  const { group, focus } = res;
  const item = itemById.get(focus)!;
  const ids = group ? group.members.map((m) => m.item) : [focus];
  // グループ内のどの段階の情報かを示す札
  const tag = (x: string) => (group ? `<span class="chip member" title="${esc(x)}">${esc(memberLabel(x))}</span> ` : "");
  const uniq = <T>(arr: T[]) => [...new Set(arr)];

  const nextTier = uniq(ids.flatMap((x) => recipesByBase.get(x) ?? [])).filter((r) => !isIntra(r));
  const usedIn = uniq(ids.flatMap((x) => recipesByMaterial.get(x) ?? []));
  const tables = newestFirst(uniq(ids.flatMap((x) => tablesByItem.get(x) ?? [])));
  const tablesUsing = uniq(ids.flatMap((x) => tablesByMaterial.get(x) ?? []));
  const drops = ids.flatMap((x) => dropsByItem.get(x) ?? []).sort((a, b) => sortDate(b.table.refs).localeCompare(sortDate(a.table.refs)));
  const contents = !group && item.kind === "box" ? (dropsByLocation.get(focus) ?? []) : [];
  const selfOps = ids.flatMap((x) => selfRecipes.get(x) ?? []);
  const obtains = ids.flatMap((x) => (itemById.get(x)!.obtain ?? []).map((o) => ({ id: x, text: o })));

  const sections: string[] = [];

  if (ids.some((x) => itemById.get(x)!.stats?.length) || !NON_EQUIP.includes(item.kind)) {
    sections.push(`<section><h2>ステータス</h2>${statsSection(ids, focus, !!group)}</section>`);
  }

  const set = item.set ? setById.get(item.set) : undefined;
  if (set) sections.push(`<section><h2>セット効果</h2>${setSection(set, focus)}</section>`);

  const route = routeSection(focus);
  if (route) {
    sections.push(`<section><h2>作成ルート${group ? ` <span class="count">${esc(memberLabel(focus))}</span>` : ""}</h2>${route}</section>`);
  }

  if (group) {
    const ts = stageTransitions(group);
    if (ts.length) {
      sections.push(`<section><h2>段階強化</h2><p class="muted">この装備の段階を上げるときの素材です。</p>${stageTable(ts, { cumulative: isLinear(ts) })}</section>`);
    }
  }

  if (selfOps.length) {
    sections.push(`<section><h2>加工 (進化・ロック等)</h2><ul class="plain">${selfOps
      .map((r) => `<li>${tag(r.result)}${recipeHeader(r)}<div>${r.materials.map((m) => itemLink(m.item, m.qty)).join("、")}</div></li>`)
      .join("")}</ul></section>`);
  }

  if (nextTier.length) {
    sections.push(`<section><h2>${group ? "進化先・交換先" : "次の段階"} (この装備をベースに作成)</h2><ul class="plain">${nextTier
      .map((r) => `<li>${tag(r.base!)}${itemLink(r.result)} — ${recipeHeader(r)}</li>`)
      .join("")}</ul></section>`);
  }

  if (tables.length) {
    sections.push(`<section><h2>強化・段階確率</h2>${tables
      .map((t) => {
        const target = group ? t.applies_to.filter((x) => ids.includes(x)).map(tag).join("") : "";
        return `<p>${target}<a href="${href("enhance", t.id)}">${esc(t.name)}</a> ${refInline(t.refs)} <span class="muted">${refDate(t.refs) ? `${esc(refDate(t.refs))} 告知 / ` : ""}${t.rows.length}段階${
          t.rows.at(-1)?.rate !== undefined ? ` / 最終段階 ${t.rows.at(-1)!.rate}%` : ""
        }</span></p>`;
      })
      .join("")}</section>`);
  }

  if (drops.length) {
    sections.push(`<section><h2>入手先・ドロップ率</h2>
      <div class="table-wrap"><table class="data">
        <thead><tr>${group ? "<th>対象</th>" : ""}<th>入手先</th><th>区分</th><th>獲得元</th><th>階層/条件</th><th>確率</th><th>個数</th><th>告知日</th></tr></thead>
        <tbody>${drops
          .map(
            ({ table, entry }) => `<tr>${group ? `<td>${tag(entry.item)}</td>` : ""}
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

  if (obtains.length) {
    sections.push(`<section><h2>入手方法メモ</h2><ul class="plain">${obtains.map((o) => `<li>${tag(o.id)}${esc(o.text)}</li>`).join("")}</ul></section>`);
  }

  if (usedIn.length || tablesUsing.length) {
    sections.push(`<section><h2>使用先</h2><ul class="plain">${usedIn
      .map((r) => {
        const used = r.materials.filter((m) => ids.includes(m.item));
        return used
          .map((m) => `<li>${tag(m.item)}${itemLink(r.result)} の${RECIPE_LABEL[r.type]} <span class="qty">×${esc(m.qty)}</span> ${refInline(r.refs)}</li>`)
          .join("");
      })
      .concat(tablesUsing.map((t) => `<li><a href="${href("enhance", t.id)}">${esc(t.name)}</a> の強化素材</li>`))
      .join("")}</ul></section>`);
  }

  const refs = ids.flatMap((x) => itemById.get(x)!.refs).filter((r, i, arr) => arr.findIndex((y: Ref) => y.source === r.source && y.note === r.note) === i);
  sections.push(`<section><h2>出典</h2>${refList([...refs, ...(group?.refs ?? [])])}</section>`);

  return `
  <nav class="crumbs"><a href="${href(["material", "currency", "box", "consumable", "other"].includes(item.kind) ? "materials" : "items")}">一覧</a>${
    item.series ? ` › <a href="#/items?series=${encodeURIComponent(item.series)}">${esc(item.series)}</a>` : ""
  }</nav>
  <header class="detail-head">
    <h1>${esc(group ? group.name : item.name)}</h1>
    <div class="names">${[item.name_ko, item.name_zh].filter(Boolean).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
    ${group ? `<p class="focus-line">選択中: <strong>${esc(item.name)}</strong> <span class="muted">(${groupCountLabel(group)})</span></p>${stageNav(group, focus)}` : ""}
    <div class="meta">${itemMeta(item)}${
      PROVISIONAL.test(item.description ?? "") ? `<span class="chip warn" title="公式に部位別の正式名称が無く、推定した名称です">名称推定</span>` : ""
    }${item.tradable ? `<span class="chip">${esc(item.tradable)}</span>` : ""} ${regionBadges(item.refs)}</div>
    ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ""}
  </header>
  ${sections.join("")}`;
}
