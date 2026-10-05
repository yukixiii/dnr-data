// 強化・段階確率表と期待試行回数の計算
import { currentTableId, ds, newestFirst, refDate, tableById } from "../data.ts";
import type { EnhanceTable } from "../types.ts";
import {
  SPLIT_MAX_COLS,
  empty,
  esc,
  href,
  itemLink,
  noteCaption,
  rateCell,
  refList,
  regionBadges,
  statColCount,
  statGrid,
  statHeadCells,
  statLayout,
  statRowCells,
} from "../components/ui.ts";

const KIND_LABEL: Record<EnhanceTable["kind"], string> = {
  enhance: "強化",
  craft_stage: "製作段階",
  refine: "精製",
  evolve: "進化",
  other: "その他",
};

const num = (v: number | string | undefined) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,G\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** 強化の段階の行 (進化の行を除く) */
export const stepRows = (t: EnhanceTable) => t.rows.filter((r) => !r.evolve);

const fmt = (n: number, digits = 2) => n.toLocaleString("ja-JP", { maximumFractionDigits: digits });

export function renderEnhanceList(query: URLSearchParams) {
  const q = (query.get("q") ?? "").toLowerCase();
  const list = newestFirst(ds.enhance_tables).filter((t) => !q || [t.name, t.applies_note, ...t.applies_to].join(" ").toLowerCase().includes(q));
  return `<h1>強化・段階確率</h1>
  <form class="filters" data-filter><input type="search" name="q" value="${esc(query.get("q") ?? "")}" placeholder="表名・装備名で検索" aria-label="検索"></form>
  ${
    list.length
      ? `<ul class="cards">${list
          .map(
            (t) => `<li class="card"><div class="card-title"><a href="${href("enhance", t.id)}">${esc(t.name)}</a></div>
        <div class="card-meta"><span class="chip">${KIND_LABEL[t.kind]}</span><span class="chip">${stepRows(t).length}段階</span>${refDate(t.refs) ? `<span class="chip">${esc(refDate(t.refs))}</span>` : ""}</div>
        <div class="card-foot">${regionBadges(t.refs)}</div></li>`,
          )
          .join("")}</ul>`
      : empty("該当する確率表がありません")
  }`;
}

export function renderEnhanceTable(id: string) {
  const t = tableById.get(id) ?? tableById.get(currentTableId(id)); // 統合された旧 id のリンク
  if (!t) return `<h1>${esc(id)}</h1>${empty("確率表が見つかりません")}`;

  // 「その他」(ランダムオプション獲得率など) の rate は成功率ではないので期待回数は出さない
  const isSuccessRate = t.kind !== "other";
  const hasFail = t.rows.some((r) => r.on_fail);
  const hasGold = t.rows.some((r) => r.gold !== undefined);
  const hasMat = t.rows.some((r) => r.materials?.length);
  const hasStats = t.rows.some((r) => r.stats?.length);
  // 全行が同じ定性表記 (「以下からランダムに1種」等) だけなら列にせず表の見出しに出す
  const uniformText =
    t.rows.every((r) => r.rate === undefined) && new Set(t.rows.map((r) => r.rate_text ?? "")).size === 1 ? t.rows[0]?.rate_text : undefined;
  const hasRate = !uniformText && t.rows.some((r) => r.rate !== undefined || r.rate_text);
  const canCalc = isSuccessRate && stepRows(t).every((r) => r.rate !== undefined && r.rate > 0);

  const layout = hasStats ? statLayout(stepRows(t).map((r) => r.stats ?? [])) : undefined;
  const baseCols = 1 + [hasRate, hasGold, hasMat, hasFail].filter(Boolean).length + (canCalc ? 2 + (hasGold ? 1 : 0) : 0);
  // 能力値の列を足しても見やすい幅なら1つの表、多すぎるなら確率表とステータス表に分ける
  const combined = !!layout && baseCols + statColCount(layout) <= SPLIT_MAX_COLS;
  const showProb = baseCols > 1 || !layout;

  // 期待試行回数 = 100 / 成功率。失敗時に段階が下がる/壊れる場合は過小評価になる。
  let cumTries = 0;
  let cumGold = 0;
  let goldKnown = true;
  const colCount = baseCols + (combined ? statColCount(layout!) : 0);
  const rows = t.rows.map((r) => {
    // 進化の行: 表を区切って説明と素材を出す (期待回数の計算には入れない)
    if (r.evolve)
      return `<tr class="evolve-row"><th>${esc(r.level)}</th><td colspan="${colCount - 1}"><strong>進化</strong> ${esc(r.evolve)}${
        r.materials?.length ? `<br>素材: ${r.materials.map((m) => itemLink(m.item, m.qty)).join("、")}` : ""
      }</td></tr>`;
    let calc = "";
    if (canCalc) {
      const tries = 100 / r.rate!;
      cumTries += tries;
      const g = num(r.gold);
      if (g === undefined) goldKnown = false;
      else cumGold += g * tries;
      calc = `<td class="num">${fmt(tries)}</td><td class="num">${fmt(cumTries)}</td>${
        hasGold ? `<td class="num">${goldKnown ? fmt(cumGold, 0) : "—"}</td>` : ""
      }`;
    }
    return `<tr>
      <th>${esc(r.level)}</th>
      ${hasRate ? `<td>${rateCell(r.rate, r.rate_text)}</td>` : ""}
      ${hasGold ? `<td class="num">${esc(typeof r.gold === "number" ? r.gold.toLocaleString("ja-JP") : (r.gold ?? ""))}</td>` : ""}
      ${hasMat ? `<td>${(r.materials ?? []).map((m) => itemLink(m.item, m.qty)).join("<br>")}</td>` : ""}
      ${hasFail ? `<td>${esc(r.on_fail ?? "")}</td>` : ""}
      ${combined ? statRowCells(layout!, r.stats ?? []) : ""}
      ${calc}
    </tr>`;
  });

  const caption = [uniformText ? esc(uniformText) : "", combined ? noteCaption(layout!) : ""].filter(Boolean).join(" — ");
  const probTable = `<div class="table-wrap"><table class="data enhance">${caption ? `<caption>${caption}</caption>` : ""}
    <thead><tr><th>段階</th>${hasRate ? `<th>${isSuccessRate ? "成功率" : "確率"}</th>` : ""}${hasGold ? "<th>費用</th>" : ""}${
      hasMat ? "<th>素材</th>" : ""
    }${hasFail ? "<th>失敗時</th>" : ""}${combined ? statHeadCells(layout!) : ""}${
      canCalc ? `<th>期待回数</th><th>累計期待回数</th>${hasGold ? "<th>累計期待費用</th>" : ""}` : ""
    }</tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table></div>`;
  const statTable =
    layout && !combined
      ? statGrid(
          stepRows(t).map((r) => ({ head: [r.level], stats: r.stats ?? [] })),
          ["段階"],
          { caption: !showProb ? uniformText : undefined },
        )
      : "";

  return `<nav class="crumbs"><a href="${href("enhance")}">確率表一覧</a></nav>
  <header class="detail-head">
    <h1>${esc(t.name)}</h1>
    <div class="meta"><span class="chip">${KIND_LABEL[t.kind]}</span> ${regionBadges(t.refs)}</div>
    ${t.applies_to.length ? `<p>対象: ${t.applies_to.map((x) => itemLink(x)).join("、")}</p>` : ""}
    ${t.applies_note ? `<p class="desc">${esc(t.applies_note)}</p>` : ""}
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}
  </header>
  ${
    statTable
      ? `${showProb ? `<section><h2>確率表</h2>${probTable}</section>` : ""}<section><h2>ステータス表</h2>${statTable}</section>`
      : probTable
  }
  ${
    canCalc
      ? `<p class="muted">期待回数 = 100 ÷ 成功率。失敗しても段階が維持される前提の単純計算です${
          hasFail ? "。失敗時に段階低下・破壊がある段階では実際の期待値はこれより大きくなります" : ""
        }。</p>`
      : ""
  }
  <section><h2>出典</h2>${refList(t.refs)}</section>`;
}
