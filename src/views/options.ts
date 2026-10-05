// ランダムオプション (潜在能力) の表: 行ごとの候補と確率、再付与の方法と費用
import { ds, optionTableById } from "../data.ts";
import type { OptionEntry, OptionReroll, OptionTable } from "../types.ts";
import { empty, esc, href, itemLink, refList, regionBadges } from "../components/ui.ts";

export const REROLL_LABEL: Record<OptionReroll["kind"], string> = { random: "ランダムオプション", select: "選択オプション", lock: "ロックオプション" };
const REROLL_NOTE: Record<OptionReroll["kind"], string> = {
  random: "取り消し不可",
  select: "変更前のオプションを選んで取り消せる",
  lock: "",
};

const pct = (n: number) => `${n.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}%`;
const letter = (i: number) => String.fromCharCode(65 + i);
/** 候補表の名前 (A, B, …) と、その表を使う行 */
const poolNames = (t: OptionTable) => {
  const ids = [...new Set(t.lines)];
  return new Map(ids.map((p, i) => [p, { name: ids.length > 1 ? `候補表 ${letter(i)}` : "候補表", lines: t.lines.flatMap((x, j) => (x === p ? [j + 1] : [])) }]));
};
const lineRange = (ls: number[]) => (ls.length === 1 ? `${ls[0]}行目` : ls.every((x, i) => i === 0 || x === ls[i - 1] + 1) ? `${ls[0]}～${ls.at(-1)}行目` : `${ls.join("・")}行目`);

/** 総称のアイテムには当たる部位を添えたリンク */
const appliesLinks = (t: OptionTable) =>
  t.applies_to.map((x) => `${itemLink(x)}${t.applies_parts?.[x] ? ` <span class="muted">(${esc(t.applies_parts[x])})</span>` : ""}`).join("、");

/** 1 行の要約 (アイテムのページ・一覧用) */
export function optionSummary(t: OptionTable) {
  const kinds = [...new Set(t.rerolls.map((r) => REROLL_LABEL[r.kind].replace("オプション", "")))];
  return `${t.lines.length}行${kinds.length ? ` / 再付与: ${kinds.join("・")}` : ""}`;
}

/**
 * 数字だけが違う候補 (「物理/魔法防御力6000上昇」「…9000上昇」) を 1 行にまとめる。
 * 候補の並び順のまま、数字を ◯ にした形が同じものを集め、候補ごとに違う数字を値とする。
 */
function groupEntries(es: OptionEntry[]) {
  const NUM = /\d[\d,.]*/g;
  const groups = new Map<string, OptionEntry[]>();
  for (const e of es) {
    const k = e.text.replace(NUM, "◯");
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].map((g) => {
    const nums = g.map((e) => e.text.match(NUM) ?? []);
    const varying = nums[0].map((_, i) => new Set(nums.map((n) => n[i])).size > 1);
    let i = 0;
    const label = g.length > 1 ? g[0].text.replace(NUM, (m) => (varying[i++] ? "◯" : m)) : g[0].text;
    const values = g.map((e, j) => {
      const vs = [...new Set(nums[j].filter((_, k) => varying[k]))];
      return { value: vs.join(" / "), rate: e.rate };
    });
    return { label, total: g.reduce((s, e) => s + e.rate, 0), values };
  });
}

function poolTable(es: OptionEntry[]) {
  const gs = groupEntries(es);
  const grouped = gs.some((g) => g.values.length > 1);
  const body = grouped
    ? `<thead><tr><th>オプション</th><th>合計</th><th>値と確率</th></tr></thead><tbody>${gs
        .map(
          (g) => `<tr><th>${esc(g.label)}</th><td class="num">${pct(g.total)}</td><td>${
            g.values.length > 1 ? g.values.map((v) => `<span class="opt-val">${esc(v.value)} <span class="muted">${pct(v.rate)}</span></span>`).join("") : ""
          }</td></tr>`,
        )
        .join("")}</tbody>`
    : `<thead><tr><th>オプション</th><th>確率</th></tr></thead><tbody>${es.map((e) => `<tr><th>${esc(e.text)}</th><td class="num">${pct(e.rate)}</td></tr>`).join("")}</tbody>`;
  const table = `<div class="table-wrap"><table class="data options">${body}</table></div>`;
  // 職業ごとのスキルが並ぶ大きな表は畳んでおく
  return gs.length > 60 ? `<details class="howto"><summary>${gs.length} 種類の候補を表示</summary>${table}</details>` : table;
}

function rerollTable(t: OptionTable) {
  if (!t.rerolls.length) return "";
  const all = t.lines.length;
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>方法</th><th>再付与される行</th><th>ゴールド</th><th>材料</th></tr></thead>
    <tbody>${t.rerolls
      .map((r) => {
        const kind = `${REROLL_LABEL[r.kind]}${r.lock ? ` (${r.lock}行固定)` : ""}`;
        const lines = r.lines.length === all ? `全${all}行${r.lock ? ` のうち固定しない行` : ""}` : lineRange(r.lines);
        const mats = r.materials
          .map((m) => `${itemLink(m.item, m.qty)}${m.alt?.length ? ` <span class="muted">(${m.alt.map((a) => itemLink(a)).join("、")} でも可)</span>` : ""}`)
          .join("<br>");
        return `<tr><th>${esc(kind)}${REROLL_NOTE[r.kind] ? `<div class="muted">${esc(REROLL_NOTE[r.kind])}</div>` : ""}</th><td>${esc(lines)}</td><td class="num">${
          r.gold ? r.gold.toLocaleString("ja-JP") : ""
        }</td><td>${mats}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}

export function renderOptionList(query: URLSearchParams) {
  const q = (query.get("q") ?? "").toLowerCase();
  const list = ds.option_tables.filter((t) => !q || [t.name, ...t.applies_to].join(" ").toLowerCase().includes(q));
  return `<h1>ランダムオプション</h1>
  <p class="muted">再付与できるランダムオプション (潜在能力) が付く装備・竜珠の、オプションの行数・候補と確率・再付与の費用です (日本版クライアントの値)。</p>
  <form class="filters" data-filter><input type="search" name="q" value="${esc(query.get("q") ?? "")}" placeholder="表名・装備名で検索" aria-label="検索"></form>
  ${
    list.length
      ? `<ul class="cards">${list
          .map(
            (t) => `<li class="card"><div class="card-title"><a href="${href("option", t.id)}">${esc(t.name)}</a></div>
        <div class="card-meta"><span class="chip">${esc(optionSummary(t))}</span><span class="chip">対象 ${t.applies_to.length}</span></div>
        <div class="card-foot">${regionBadges(t.refs)}</div></li>`,
          )
          .join("")}</ul>`
      : empty("該当する表がありません")
  }`;
}

export function renderOptionTable(id: string) {
  const t = optionTableById.get(id);
  if (!t) return `<h1>${esc(id)}</h1>${empty("表が見つかりません")}`;
  const pools = poolNames(t);
  const lineText =
    pools.size === 1
      ? `<p>オプションは<strong>${t.lines.length}行</strong>。どの行も下の候補表から 1 つ選ばれます。</p>`
      : `<p>オプションは<strong>${t.lines.length}行</strong>。行ごとに次の候補表から 1 つ選ばれます: ${[...pools.values()]
          .map((p) => `${esc(lineRange(p.lines))} = ${esc(p.name)}`)
          .join("、")}</p>`;
  return `<nav class="crumbs"><a href="${href("options")}">ランダムオプション一覧</a></nav>
  <header class="detail-head">
    <h1>${esc(t.name)}</h1>
    <div class="meta"><span class="chip">${esc(optionSummary(t))}</span> ${regionBadges(t.refs)}</div>
    <p>対象: ${appliesLinks(t)}</p>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}
  </header>
  <section><h2>オプションの行</h2>${lineText}</section>
  ${[...pools]
    .map(([p, info]) => `<section><h2>${esc(info.name)}${pools.size > 1 ? ` <span class="count">${esc(lineRange(info.lines))}</span>` : ""}</h2>${poolTable(t.pools[p])}</section>`)
    .join("")}
  ${t.rerolls.length ? `<section><h2>再付与</h2>${rerollTable(t)}</section>` : ""}
  <section><h2>出典</h2>${refList(t.refs)}</section>`;
}
