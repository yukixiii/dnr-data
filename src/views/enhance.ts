// 強化・段階確率表と期待試行回数の計算
import { ds, newestFirst, refDate, tableById } from "../data.ts";
import type { EnhanceTable } from "../types.ts";
import { empty, esc, href, itemLink, rateCell, refList, regionBadges } from "../components/ui.ts";

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
        <div class="card-meta"><span class="chip">${KIND_LABEL[t.kind]}</span><span class="chip">${t.rows.length}段階</span>${refDate(t.refs) ? `<span class="chip">${esc(refDate(t.refs))}</span>` : ""}</div>
        <div class="card-foot">${regionBadges(t.refs)}</div></li>`,
          )
          .join("")}</ul>`
      : empty("該当する確率表がありません")
  }`;
}

export function renderEnhanceTable(id: string) {
  const t = tableById.get(id);
  if (!t) return `<h1>${esc(id)}</h1>${empty("確率表が見つかりません")}`;

  // 期待試行回数 = 100 / 成功率。失敗時に段階が下がる/壊れる場合は過小評価になる。
  let cumTries = 0;
  let cumGold = 0;
  let goldKnown = true;
  const hasFail = t.rows.some((r) => r.on_fail);
  const hasGold = t.rows.some((r) => r.gold !== undefined);
  const hasMat = t.rows.some((r) => r.materials?.length);
  const hasStats = t.rows.some((r) => r.stats?.length);
  const canCalc = t.rows.every((r) => r.rate !== undefined && r.rate > 0);

  const rows = t.rows.map((r) => {
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
      <td>${rateCell(r.rate, r.rate_text)}</td>
      ${hasGold ? `<td class="num">${esc(typeof r.gold === "number" ? r.gold.toLocaleString("ja-JP") : (r.gold ?? ""))}</td>` : ""}
      ${hasMat ? `<td>${(r.materials ?? []).map((m) => itemLink(m.item, m.qty)).join("<br>")}</td>` : ""}
      ${hasFail ? `<td>${esc(r.on_fail ?? "")}</td>` : ""}
      ${hasStats ? `<td>${(r.stats ?? []).map((s) => `${esc(s.name)} ${esc(s.value)}`).join("<br>")}</td>` : ""}
      ${calc}
    </tr>`;
  });

  return `<nav class="crumbs"><a href="${href("enhance")}">確率表一覧</a></nav>
  <header class="detail-head">
    <h1>${esc(t.name)}</h1>
    <div class="meta"><span class="chip">${KIND_LABEL[t.kind]}</span> ${regionBadges(t.refs)}</div>
    ${t.applies_to.length ? `<p>対象: ${t.applies_to.map((x) => itemLink(x)).join("、")}</p>` : ""}
    ${t.applies_note ? `<p class="desc">${esc(t.applies_note)}</p>` : ""}
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}
  </header>
  <div class="table-wrap"><table class="data enhance">
    <thead><tr><th>段階</th><th>成功率</th>${hasGold ? "<th>費用</th>" : ""}${hasMat ? "<th>素材</th>" : ""}${hasFail ? "<th>失敗時</th>" : ""}${
      hasStats ? "<th>能力値</th>" : ""
    }${canCalc ? `<th>期待回数</th><th>累計期待回数</th>${hasGold ? "<th>累計期待費用</th>" : ""}` : ""}</tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table></div>
  ${
    canCalc
      ? `<p class="muted">期待回数 = 100 ÷ 成功率。失敗しても段階が維持される前提の単純計算です${
          hasFail ? "。失敗時に段階低下・破壊がある段階では実際の期待値はこれより大きくなります" : ""
        }。</p>`
      : ""
  }
  <section><h2>出典</h2>${refList(t.refs)}</section>`;
}
