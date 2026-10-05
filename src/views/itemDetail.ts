// 装備/素材の詳細: ステータス・作成ルート・強化表・入手先・使用先・出典
// 段階違いの同一装備 (data/item_groups.json) は1ページにまとめ、段階を切り替えて見る。
import {
  aggregatesOf,
  dropsByItem,
  dropsByLocation,
  isIntra,
  optionTablesByItem,
  optionTablesByMaterial,
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
  type DropHit,
} from "../data.ts";
import { RECIPE_LABEL, recipeHeader, routeSection, stageTable } from "../components/routeView.ts";
import type { Transition } from "../route.ts";
import { cmpKey, compareFloors, parseFloors } from "../floors.ts";
import type { Item, ItemGroup, ItemSet, Ref, Stat, StatSet } from "../types.ts";
import { empty, esc, href, itemLink, itemMeta, locationLink, rateCell, refInline, refList, regionBadges, statCell, statGrid, statSets } from "../components/ui.ts";
import { dropTableHtml } from "./drops.ts";
import { stepRows } from "./enhance.ts";
import { REROLL_LABEL, optionSummary } from "./options.ts";

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

// ---------- [増幅]/[真] の差分 ----------
// [増幅]・[真] は通常の装備に強化値によらず一定の能力値を足したものなので、全強化値の表を繰り返さず差分だけ出す

/** [増幅]/[真] のメンバー → 基準にする「通常」のメンバー (無ければ undefined) */
function variantBase(g: ItemGroup, id: string) {
  const m = g.members.find((x) => x.item === id);
  if (!m) return undefined;
  // ヘイズフロストドラゴン装備: phase が 通常/真、label が等級
  if (m.phase === "真") return g.members.find((x) => x.phase === "通常" && x.label === m.label)?.item;
  if (m.label === "真" || m.label.includes("増幅")) return g.members.find((x) => x.label === "通常" && x.phase === m.phase)?.item;
  return undefined;
}

type Num = { vs: number[]; pct: boolean; dec: number };
function parseNum(v: string): Num | undefined {
  const parts = v.split(/~|～/).map((x) => x.replace(/[,\s]/g, ""));
  if (!parts.every((x) => /^[+-]?\d+(\.\d+)?%?$/.test(x))) return undefined;
  const pct = parts.some((x) => x.endsWith("%"));
  const dec = Math.max(...parts.map((x) => x.replace("%", "").split(".")[1]?.length ?? 0));
  return { vs: parts.map((x) => parseFloat(x)), pct, dec };
}
const fmtDelta = (d: number, n: Num) => {
  const abs = Math.abs(d);
  const body = n.pct ? `${abs.toFixed(n.dec)}%` : abs.toLocaleString("en-US", { maximumFractionDigits: n.dec });
  return `${d < 0 ? "-" : "+"}${body}`;
};

/** 全段階で能力ごとの差が一定ならその差 (0 の能力は除く)。一定でなければ undefined */
function constantDelta(variant: StatSet[] | undefined, base: StatSet[] | undefined): Stat[] | undefined {
  if (!variant?.length || !base?.length) return undefined;
  const baseBy = new Map(base.map((s) => [s.label, s]));
  if (variant.length !== base.length || variant.some((s) => !baseBy.has(s.label))) return undefined;
  const delta = new Map<string, { ds: number[]; n: Num }>();
  for (const vs of variant) {
    const bs = baseBy.get(vs.label)!;
    const names = [...new Set([...vs.stats, ...bs.stats].map((x) => x.name))];
    for (const name of names) {
      const v = vs.stats.find((x) => x.name === name);
      const b = bs.stats.find((x) => x.name === name);
      if (v && b && v.value === b.value && !parseNum(v.value)) continue; // 同じ文字の能力
      const pv = v ? parseNum(v.value) : undefined;
      const pb = b ? parseNum(b.value) : undefined;
      if ((v && !pv) || (b && !pb)) return undefined; // 文字の能力が違う
      const shape = (pv ?? pb)!;
      const a = pv?.vs ?? shape.vs.map(() => 0);
      const c = pb?.vs ?? shape.vs.map(() => 0);
      if (a.length !== c.length) return undefined;
      const ds = a.map((x, i) => Math.round((x - c[i]) * 1e6) / 1e6);
      const prev = delta.get(name);
      if (prev && (prev.ds.length !== ds.length || prev.ds.some((d, i) => d !== ds[i]))) return undefined;
      if (!prev) delta.set(name, { ds, n: shape });
    }
  }
  return [...delta.entries()]
    .filter(([, { ds }]) => ds.some((d) => d !== 0))
    .map(([name, { ds, n }]) => ({ name, value: ds.every((d) => d === ds[0]) ? fmtDelta(ds[0], n) : ds.map((d) => fmtDelta(d, n)).join("~") }));
}

const DELTA_LABEL = "通常との差 (全強化値共通)";

function statsSection(ids: string[], focus: string, group?: ItemGroup) {
  const items = ids.map((x) => itemById.get(x)!);
  if (!group) return statSets(items[0].stats);
  // 差分で出すメンバー: id → 差分 (空なら通常と同じ)
  const deltas = new Map<string, Stat[]>();
  for (const it of items) {
    const base = variantBase(group, it.id);
    const d = base ? constantDelta(it.stats, itemById.get(base)?.stats) : undefined;
    if (d) deltas.set(it.id, d);
  }
  const shownSets = (it: Item): StatSet[] =>
    deltas.has(it.id) ? [{ label: deltas.get(it.id)!.length ? DELTA_LABEL : "通常と同じ (全強化値)", stats: deltas.get(it.id)! }] : it.stats!;
  const deltaNote = deltas.size
    ? `<p class="muted">${[...deltas.keys()].map((x) => esc(memberLabel(x))).join("、")} は通常の能力値に強化値によらず一定の値が足されるため、通常との差だけを載せています。</p>`
    : "";
  const withStats = items.filter((it) => it.stats?.length);
  const missing = items.filter((it) => !it.stats?.length);
  const note = missing.length && withStats.length ? `<p class="muted">ステータス未登録: ${missing.map((it) => esc(memberLabel(it.id))).join("、")}</p>` : "";
  if (!withStats.length) return statSets(undefined);
  // 「段階 × 能力」の1つの表にまとめる (強化値別など複数組あれば 条件 列を足す)。行が多すぎるときだけ段階ごとに分ける
  const sets = withStats.flatMap((it) => shownSets(it).map((s) => ({ it, s })));
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
      ) +
      deltaNote +
      note
    );
  }
  return (
    withStats
      .map((it) => `<details class="member-stats" ${it.id === focus ? "open" : ""}><summary>${esc(memberLabel(it.id))}</summary>${statSets(shownSets(it))}</details>`)
      .join("") +
    deltaNote +
    note
  );
}

/** 能力値の表記 ("500,000" / "10.00%") → 数値と書式。読めなければ undefined */
function parseStatValue(v: string) {
  const m = v.replace(/,/g, "").match(/^\+?(\d+(?:\.(\d+))?)(%?)$/);
  return m ? { n: Number(m[1]), dec: m[2]?.length ?? 0, pct: m[3] === "%" } : undefined;
}

/** 同じ能力の値の合計 (書式は最初の値に合わせる)。読めない値があれば undefined */
function sumStatValues(vs: string[]) {
  const ps = vs.map(parseStatValue);
  if (!ps.length || ps.some((p) => !p || p.pct !== ps[0]!.pct)) return undefined;
  const dec = Math.max(...ps.map((p) => p!.dec));
  const n = ps.reduce((a, p) => a + p!.n, 0);
  const body = dec ? n.toFixed(dec).replace(/^(\d+)/, (d) => Number(d).toLocaleString("en-US")) : Math.round(n).toLocaleString("en-US");
  return body + (ps[0]!.pct ? "%" : "");
}

/**
 * セット効果: 必要数ごとの効果 (能力名ごとの列) と、その必要数までの累計。スキル型の効果は行の下に出す。
 * 同じセットの装備 (グループは 1 件にまとめる) も並べる。
 */
function setSection(set: ItemSet, focus: string) {
  const members = setMembers.get(set.id) ?? [];
  const units = [...new Set(members.map((id) => groupOf(id)?.id ?? id))];
  const bonuses = [...set.bonuses].sort((a, b) => a.count - b.count);
  const cols = [...new Set(bonuses.flatMap((b) => (b.stats ?? []).map((st) => st.name)))];
  const cumulative = cols.length > 0 && bonuses.length > 1;
  const span = cols.length * (cumulative ? 2 : 1) || 1;
  const head = !cols.length
    ? `<tr><th>必要数</th><th>効果</th></tr>`
    : cumulative
      ? `<tr><th rowspan="2">必要数</th><th colspan="${cols.length}" class="group">段階の効果</th><th colspan="${cols.length}" class="group cum-start">累計</th></tr>
        <tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}${cols.map((c, j) => `<th class="cum${j ? "" : " cum-start"}">${esc(c)}</th>`).join("")}</tr>`
      : `<tr><th>必要数</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = bonuses
    .map((b, i) => {
      const label = `${b.count}セット`;
      if (!cols.length) return `<tr><th>${label}</th><td class="skill">${esc(b.skill ?? "")}</td></tr>`;
      const own = cols.map((c) => statCell((b.stats ?? []).find((st) => st.name === c))).join("");
      const cum = !cumulative
        ? ""
        : cols
            .map((c, j) => {
              const cls = `num cum${j ? "" : " cum-start"}`;
              const vs = bonuses.slice(0, i + 1).flatMap((x) => (x.stats ?? []).filter((st) => st.name === c).map((st) => st.value));
              const v = vs.length ? (vs.length === 1 ? vs[0] : sumStatValues(vs)) : undefined;
              return v === undefined ? `<td class="${cls} empty">—</td>` : `<td class="${cls}">${esc(v)}</td>`;
            })
            .join("");
      const skill = b.skill ? `<tr class="set-skill"><td colspan="${span}">${esc(b.skill)}</td></tr>` : "";
      return `<tr><th${b.skill ? ` rowspan="2"` : ""}>${label}</th>${own}${cum}</tr>${skill}`;
    })
    .join("");
  // 「◯◯間でセット効果がある。」だけの説明は名前の繰り返しなので出さない
  const desc = set.description && set.description !== `${set.name}間でセット効果がある。` ? set.description : "";
  return `<p><strong>${esc(set.name)}</strong>${desc ? ` <span class="muted">${esc(desc)}</span>` : ""}</p>
    <div class="table-wrap"><table class="data set-bonus"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${cumulative ? `<p class="muted">各段階の効果は重ねて適用される。累計はその必要数までの各段階の合計。</p>` : ""}
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

/** 複数の階層表記 (階層順) をまとめた表記: 最初の開始～最も後ろの終了。解析できない表記を含むなら「最初 ほか」 */
function floorSpanLabel(fl: string[]) {
  const spans = fl.map((f) => parseFloors(f));
  if (spans.some((x) => !x)) return `${fl[0] || "全階層"} ほか`;
  const piece = (f: string, last: boolean) => {
    const ps = f.split(/\s*[~～〜]\s*/);
    return last ? ps.at(-1)! : ps[0];
  };
  const endIdx = spans.reduce((best, x, i) => (cmpKey(x!.end, spans[best]!.end) > 0 ? i : best), 0);
  const end = spans[endIdx]!.end[1] === Infinity ? "" : piece(fl[endIdx], true);
  return `${piece(fl[0], false)}～${end}`;
}

/**
 * 入手先の行を 1 表 1 行にまとめる (同じ表・獲得元・対象段階・経由した袋ごと)。
 * 階層は「最初～最後 (N区分)」、確率・個数は同じなら 1 つ、違えば最初～最後 (階層順) で表す。階層ごとの値はダンジョンのページで見る。
 */
function mergeDrops(drops: DropHit[]) {
  const by = new Map<string, DropHit[]>();
  for (const d of drops) {
    const k = JSON.stringify([d.table.id, d.entry.from ?? "", d.entry.item, d.entry.via ?? "", d.entry.as ?? ""]);
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  const range = (vs: string[]) => {
    const u = [...new Set(vs.filter(Boolean))];
    return u.length <= 1 ? (u[0] ?? "") : `${vs.filter(Boolean)[0]}～${vs.filter(Boolean).at(-1)}`;
  };
  return [...by.values()].map((hs) => {
    const sorted = [...hs].sort((a, b) => compareFloors(a.entry.floors, b.entry.floors));
    const es = sorted.map((h) => h.entry);
    const fl = [...new Set(es.map((e) => e.floors ?? ""))];
    const floors = fl.length <= 1 ? esc(fl[0] ?? "") : `<span title="${esc(fl.join(" / "))}">${esc(floorSpanLabel(fl))} <span class="muted">(${fl.length}区分)</span></span>`;
    const rates = es.filter((e) => e.rate !== undefined).map((e) => e.rate!);
    const texts = [...new Set(es.map((e) => e.rate_text).filter(Boolean))].join("、");
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    const rate = !rates.length
      ? rateCell(undefined, texts)
      : lo === hi
        ? rateCell(lo, texts)
        : `${rateCell(lo)}～${rateCell(hi, texts)}`;
    return { table: hs[0].table, entry: es[0], floors, rate, qty: range(es.map((e) => String(e.qty ?? ""))) };
  });
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

  const fromBase = uniq(ids.flatMap((x) => recipesByBase.get(x) ?? []));
  const nextTier = fromBase.filter((r) => !isIntra(r) && r.type !== "dismantle");
  const dismantles = fromBase.filter((r) => r.type === "dismantle");
  const dismantledFrom = uniq(ids.flatMap((x) => recipesByResult.get(x) ?? [])).filter((r) => r.type === "dismantle");
  const usedIn = uniq(ids.flatMap((x) => recipesByMaterial.get(x) ?? []));
  const tables = newestFirst(uniq(ids.flatMap((x) => tablesByItem.get(x) ?? [])));
  const tablesUsing = uniq(ids.flatMap((x) => tablesByMaterial.get(x) ?? []));
  const options = uniq(ids.flatMap((x) => optionTablesByItem.get(x) ?? []));
  const optionsUsing = uniq(ids.flatMap((x) => optionTablesByMaterial.get(x) ?? []));
  const drops = ids.flatMap((x) => dropsByItem.get(x) ?? []).sort((a, b) => sortDate(b.table.refs).localeCompare(sortDate(a.table.refs)));
  // 箱の中身の表が複数 (提供割合の改定) なら新しい表を先に
  const contents = !group && item.kind === "box" ? newestFirst(dropsByLocation.get(focus) ?? []) : [];
  const aggregates = aggregatesOf.get(focus) ?? [];
  const selfOps = ids.flatMap((x) => selfRecipes.get(x) ?? []);
  const obtains = ids.flatMap((x) => (itemById.get(x)!.obtain ?? []).map((o) => ({ id: x, text: o })));

  const sections: string[] = [];

  if (ids.some((x) => itemById.get(x)!.stats?.length) || !NON_EQUIP.includes(item.kind)) {
    sections.push(`<section><h2>ステータス</h2>${statsSection(ids, focus, group)}</section>`);
  }

  const set = item.set ? setById.get(item.set) : undefined;
  if (set) sections.push(`<section><h2>セット効果</h2>${setSection(set, focus)}</section>`);

  if (item.members?.length || aggregates.length) {
    const link = (x: string) => `<a href="${href("item", x)}">${esc(itemById.get(x)?.name ?? x)}</a>`;
    sections.push(`<section><h2>総称</h2>${
      item.members?.length ? `<p>次の${item.members.length}種のアイテムをまとめた名前です: ${item.members.map(link).join("、")}</p>` : ""
    }${
      aggregates.length ? `<p>${aggregates.map(link).join("、")} (総称) の1つです。ドロップ表で総称の名前で載っている入手先も、下の入手先に含めています。</p>` : ""
    }</section>`);
  }

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

  if (dismantles.length) {
    // 同じ装備・同じ段階の候補 (注記が同じレシピ) は 1 行にまとめる
    const rows = new Map<string, typeof dismantles>();
    for (const r of dismantles) {
      const k = `${r.base} ${r.notes ?? ""} ${r.gold ?? ""}`;
      rows.set(k, [...(rows.get(k) ?? []), r]);
    }
    sections.push(`<section><h2>分解</h2><ul class="plain">${[...rows.values()]
      .map((rs) => `<li>${tag(rs[0].base!)}${rs.map((r) => itemLink(r.result, r.result_qty)).join(" / ")} — ${recipeHeader({ ...rs[0], result_qty: undefined })}</li>`)
      .join("")}</ul></section>`);
  }

  if (tables.length) {
    sections.push(`<section><h2>強化・段階確率</h2>${tables
      .map((t) => {
        const target = group ? t.applies_to.filter((x) => ids.includes(x)).map(tag).join("") : "";
        return `<p>${target}<a href="${href("enhance", t.id)}">${esc(t.name)}</a> ${refInline(t.refs)} <span class="muted">${refDate(t.refs) ? `${esc(refDate(t.refs))} 告知 / ` : ""}${stepRows(t).length}段階${t.rows.some((r) => r.evolve) ? " (途中で進化)" : ""}${
          t.rows.at(-1)?.rate !== undefined ? ` / 最終段階 ${t.rows.at(-1)!.rate}%` : ""
        }</span></p>`;
      })
      .join("")}</section>`);
  }

  if (options.length) {
    sections.push(`<section><h2>ランダムオプション</h2>${options
      .map((t) => {
        const target = group ? t.applies_to.filter((x) => ids.includes(x)).map(tag).join("") : "";
        const part = ids.map((x) => t.applies_parts?.[x]).find(Boolean);
        return `<p>${target}<a href="${href("option", t.id)}">${esc(t.name)}</a> <span class="muted">${esc(optionSummary(t))}${part ? ` / ${esc(part)}の物` : ""}</span></p>`;
      })
      .join("")}</section>`);
  }

  if (drops.length) {
    sections.push(`<section><h2>入手先・ドロップ率</h2>
      <div class="table-wrap"><table class="data">
        <thead><tr>${group ? "<th>対象</th>" : ""}<th>入手先</th><th>区分</th><th>獲得元</th><th>階層/条件</th><th>確率</th><th>個数</th><th>告知日</th></tr></thead>
        <tbody>${mergeDrops(drops)
          .map(
            ({ table, entry, floors, rate, qty }) => `<tr>${group ? `<td>${tag(entry.item)}</td>` : ""}
              <td>${locationLink(table.location, table.location_kind)}${
                entry.via ? ` <a class="via muted" href="${href("item", entry.via)}" title="この袋から出る">(${esc(itemById.get(entry.via)?.name ?? entry.via)})</a>` : ""
              }${
                entry.as ? ` <a class="via muted" href="${href("item", entry.as)}" title="表では総称で記載">(${esc(itemById.get(entry.as)?.name ?? entry.as)}として)</a>` : ""
              }</td>
              <td>${esc(table.label ?? "")}</td>
              <td>${esc(entry.from ?? "")}</td>
              <td>${floors}</td>
              <td>${rate}</td>
              <td>${esc(qty)}</td>
              <td class="num">${esc(refDate(table.refs))}${refInline(table.refs)}</td></tr>`,
          )
          .join("")}</tbody></table></div></section>`);
  }

  if (dismantledFrom.length) {
    // 段階の範囲 (「強化 +0～+14 のとき。」) と候補が複数あることだけを短く添える
    const brief = (r: (typeof dismantledFrom)[number]) =>
      [r.notes?.match(/^強化 [^。]+のとき/)?.[0], r.notes?.includes("件の候補") ? "候補の1つ" : ""].filter(Boolean).join("、");
    sections.push(`<section><h2>分解で入手</h2><ul class="plain">${dismantledFrom
      .map((r) => `<li>${tag(r.result)}${itemLink(r.base!)} を分解 <span class="qty">×${esc(r.result_qty ?? 1)}</span>${brief(r) ? ` <span class="muted">(${esc(brief(r))})</span>` : ""} ${refInline(r.refs)}</li>`)
      .join("")}</ul></section>`);
  }

  if (contents.length) {
    sections.push(`<section><h2>中身・提供割合</h2>${contents.map(dropTableHtml).join("")}</section>`);
  }

  if (obtains.length) {
    sections.push(`<section><h2>入手方法メモ</h2><ul class="plain">${obtains.map((o) => `<li>${tag(o.id)}${esc(o.text)}</li>`).join("")}</ul></section>`);
  }

  if (usedIn.length || tablesUsing.length || optionsUsing.length) {
    sections.push(`<section><h2>使用先</h2><ul class="plain">${usedIn
      .map((r) => {
        const used = r.materials.filter((m) => ids.includes(m.item));
        return used
          .map((m) => `<li>${tag(m.item)}${itemLink(r.result)} の${RECIPE_LABEL[r.type]} <span class="qty">×${esc(m.qty)}</span> ${refInline(r.refs)}</li>`)
          .join("");
      })
      .concat(tablesUsing.map((t) => `<li><a href="${href("enhance", t.id)}">${esc(t.name)}</a> の強化素材</li>`))
      .concat(
        optionsUsing.map((t) => {
          const kinds = [...new Set(t.rerolls.filter((r) => r.materials.some((m) => [m.item, ...(m.alt ?? [])].some((x) => ids.includes(x)))).map((r) => REROLL_LABEL[r.kind]))];
          return `<li><a href="${href("option", t.id)}">${esc(t.name)}</a> の再付与 <span class="muted">(${esc(kinds.join("・"))})</span></li>`;
        }),
      )
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
