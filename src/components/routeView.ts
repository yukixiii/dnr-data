// 作成ルートの表示: 入手 → 手順 → … → 完成 の縦ステップと、必要素材の合計表。
// 素材は各手順の葉。素材自体の入手レシピは1段だけ折りたたみで見せ、それ以上はたどらない。
import { dropsByItem, interPreds, itemById, memberLabel, recipesByResult } from "../data.ts";
import { buildRoutes, numericQty, routeTotals, stageSubtotal, type Route, type RouteStep, type TotalLine, type Transition } from "../route.ts";
import type { Qty, Recipe } from "../types.ts";
import { esc, href, itemLink, locationLink, rateCell, refInline } from "./ui.ts";

export const RECIPE_LABEL: Record<Recipe["type"], string> = {
  craft: "製作",
  evolve: "進化",
  refine: "精製",
  exchange: "交換",
  upgrade: "強化/増幅",
  dismantle: "分解",
  other: "その他",
};

const typeBadge = (type: Recipe["type"]) => `<span class="recipe-type type-${type}">${RECIPE_LABEL[type]}</span>`;
const fmtNum = (n: number) => n.toLocaleString("ja-JP");
const qtyText = (q: Qty["qty"]) => (typeof q === "number" ? fmtNum(q) : q);

/** レシピの付帯情報 (場所・費用・成功率・出典) */
function recipeMeta(r: Recipe) {
  return [
    r.where ? `<span class="where">${esc(r.where)}</span>` : "",
    r.gold !== undefined ? `<span class="gold">${fmtNum(r.gold)}G</span>` : "",
    r.rate !== undefined || r.rate_text ? `成功率 ${rateCell(r.rate, r.rate_text)}` : "",
    r.result_qty && r.result_qty > 1 ? `${r.result_qty}個生成` : "",
    refInline(r.refs),
  ]
    .filter(Boolean)
    .join(" ");
}

/** 一覧などで使う1行のレシピ見出し */
export function recipeHeader(r: Recipe) {
  return `<span class="recipe-head">${typeBadge(r.type)} ${recipeMeta(r)}</span>${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ""}`;
}

const inlineMats = (ms: Qty[]) => ms.map((m) => itemLink(m.item, qtyText(m.qty))).join("、");

/** 素材の入手先を短く (ドロップ先2件まで + 入手メモ) */
function obtainShort(id: string) {
  const drops = dropsByItem.get(id) ?? [];
  const locs = [...new Set(drops.map((d) => d.table.location))];
  const parts: string[] = [];
  if (locs.length) {
    const shown = locs.slice(0, 2).map((loc) => locationLink(loc, drops.find((d) => d.table.location === loc)!.table.location_kind));
    parts.push(`${shown.join("、")}${locs.length > 2 ? ` 他${locs.length - 2}件` : ""}`);
  }
  const memo = itemById.get(id)?.obtain?.[0];
  if (memo) parts.push(esc(memo.length > 40 ? `${memo.slice(0, 40)}…` : memo));
  return parts.join(" / ");
}

/** 素材自体の作り方・交換先 (1段だけ。再帰しない) */
function howTo(id: string) {
  const rs = (recipesByResult.get(id) ?? []).filter((r) => r.type !== "dismantle");
  if (!rs.length) return "";
  const shown = rs.slice(0, 4);
  return `<details class="howto"><summary>${rs.length === 1 ? RECIPE_LABEL[rs[0].type] : `入手レシピ ${rs.length}件`}</summary><ul>${shown
    .map((r) => `<li>${typeBadge(r.type)} ${r.base ? `${itemLink(r.base)} + ` : ""}${inlineMats(r.materials) || "—"} ${recipeMeta(r)}</li>`)
    .join("")}${rs.length > shown.length ? `<li><a href="${href("item", id)}">他${rs.length - shown.length}件</a></li>` : ""}</ul></details>`;
}

function matList(ms: Qty[]) {
  if (!ms.length) return "";
  return `<ul class="mats">${ms
    .map((m) => {
      const hint = obtainShort(m.item);
      return `<li class="mat">${itemLink(m.item, qtyText(m.qty))}${hint ? `<span class="obtain-hint">${hint}</span>` : ""}${howTo(m.item)}</li>`;
    })
    .join("")}</ul>`;
}

const labelBadge = (text: string) => `<span class="recipe-type type-step">${text}</span>`;

function stepBody(s: RouteStep): string {
  switch (s.kind) {
    case "obtain": {
      const hint = obtainShort(s.item);
      return `<div class="step-title">${labelBadge("入手")} ${itemLink(s.item)}</div>${hint ? `<div class="obtain-hint">${hint}</div>` : ""}`;
    }
    case "recipe": {
      const r = s.recipe;
      return `<div class="step-title">${typeBadge(r.type)} ${r.base ? `${itemLink(r.base)} → ` : ""}${itemLink(r.result)}</div>
        <div class="step-meta">${recipeMeta(r)}</div>${matList(r.materials)}${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ""}`;
    }
    case "link": {
      const { t } = s;
      const head = `<div class="step-title">${labelBadge("変化")} ${itemLink(t.from)} → ${itemLink(t.to)}</div>`;
      if (t.recipe)
        return `${head}<div class="step-meta">${RECIPE_LABEL[t.recipe.type]} ${recipeMeta(t.recipe)} <span class="muted">(部位を問わない共通の手順)</span></div>${matList(t.recipe.materials)}${
          t.recipe.notes ? `<div class="note">${esc(t.recipe.notes)}</div>` : ""
        }`;
      return `${head}<div class="muted">方法・素材は原文に記載なし (レシピ未登録)</div>`;
    }
    case "choice":
      return `<div class="step-title">${labelBadge("入手")} ${itemLink(s.result)} <span class="muted">— 次のいずれか1つ</span></div>
        <div class="table-wrap"><table class="data choice"><thead><tr><th>方法</th><th>下取り/ベース</th><th>素材</th><th>場所・出典</th></tr></thead><tbody>${s.options
          .map(
            (r) =>
              `<tr><td>${typeBadge(r.type)}</td><td>${r.base ? itemLink(r.base) : "—"}</td><td>${inlineMats(r.materials) || "—"}</td><td>${recipeMeta(r)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`;
    case "stages":
      return stagesBody(s.transitions);
  }
}

function stagesBody(ts: Transition[]) {
  const first = ts[0].from;
  const last = ts[ts.length - 1].to;
  const sub = stageSubtotal(ts);
  const gaps = ts.filter((t) => !t.recipe).length;
  const chips = sub.lines
    .filter((l) => l.sum !== undefined)
    .map((l) => `<li class="mat">${itemLink(l.item, fmtNum(l.sum!))}</li>`)
    .join("");
  return `<div class="step-title">${labelBadge("段階強化")} ${itemLink(first)} → ${itemLink(last)} <span class="muted">(${ts.length}回)</span></div>
    ${chips ? `<div class="step-meta">素材の小計${sub.gold ? ` / <span class="gold">${fmtNum(sub.gold)}G</span>` : ""}</div><ul class="mats">${chips}</ul>` : ""}
    ${gaps ? `<div class="muted">${gaps}回分は方法・素材が原文に記載なし</div>` : ""}
    <details class="stage-detail"><summary>段階ごとの素材を表示</summary>${stageTable(ts)}</details>`;
}

/** 段階ごとの素材表 (グループ詳細の「段階強化」でも使う) */
export function stageTable(ts: Transition[], opts: { cumulative?: boolean } = {}) {
  const hasGold = ts.some((t) => t.recipe?.gold !== undefined);
  const hasRate = ts.some((t) => t.recipe?.rate !== undefined || t.recipe?.rate_text);
  const cum = new Map<string, number>();
  return `<div class="table-wrap"><table class="data stages"><thead><tr><th>段階</th><th>素材</th>${hasGold ? "<th>費用</th>" : ""}${
    hasRate ? "<th>成功率</th>" : ""
  }${opts.cumulative ? "<th>累計</th>" : ""}<th>出典</th></tr></thead><tbody>${ts
    .map((t) => {
      const r = t.recipe;
      const label = `${esc(memberLabel(t.from))} → ${esc(memberLabel(t.to))}`;
      if (!r) return `<tr class="gap"><th>${label}</th><td colspan="${2 + +hasGold + +hasRate + +!!opts.cumulative}" class="muted">レシピ未登録</td></tr>`;
      for (const m of r.materials) {
        const n = numericQty(m.qty);
        if (n !== undefined) cum.set(m.item, (cum.get(m.item) ?? 0) + n);
      }
      return `<tr><th>${label}</th><td>${inlineMats(r.materials) || "—"}${t.generic ? ` <span class="muted">(部位共通の手順)</span>` : ""}</td>${hasGold ? `<td class="num">${r.gold !== undefined ? `${fmtNum(r.gold)}G` : ""}</td>` : ""}${
        hasRate ? `<td>${rateCell(r.rate, r.rate_text)}</td>` : ""
      }${opts.cumulative ? `<td class="num">${[...cum].map(([id, n]) => `${esc(itemById.get(id)?.name ?? id)} ${fmtNum(n)}`).join("<br>")}</td>` : ""}<td>${refInline(r.refs)}</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function totalsTable(lines: TotalLine[], gold: number, hasChoice: boolean) {
  if (!lines.length && !gold) return "";
  return `<h3 class="totals-title">必要素材の合計</h3>
  <div class="table-wrap"><table class="data totals"><thead><tr><th>素材</th><th>合計</th><th>合計できない記載</th><th>入手先</th></tr></thead><tbody>${lines
    .map(
      (l) => `<tr><td>${itemLink(l.item)}</td><td class="num">${l.sum !== undefined ? fmtNum(l.sum) : "—"}</td><td>${l.texts
        .map((t) => `<span class="unsummed">${esc(t.qty)}</span> <span class="muted">(手順${t.step})</span>`)
        .join("<br>")}</td><td class="obtain-hint">${obtainShort(l.item) || (interPreds(l.item).length ? "レシピあり" : "")}</td></tr>`,
    )
    .join("")}${gold ? `<tr><td>ゴールド</td><td class="num">${fmtNum(gold)}G</td><td class="muted">記載のある手順のみ</td><td></td></tr>` : ""}</tbody></table></div>
  <p class="muted">「不明」「記載なし」など数で書かれていない個数は合計に含めず、原文の表記のまま手順番号付きで載せています。${
    hasChoice ? "「いずれか1つ」の手順の素材は選び方で変わるため合計に含めていません。" : ""
  }</p>`;
}

function routeBody(r: Route, target: string) {
  const t = routeTotals(r.steps);
  return `<ol class="route">${r.steps
    .map(
      (s, i) => `<li class="step step-${s.kind}${s.kind === "link" && !s.t.recipe ? " gap" : ""}">
        <span class="step-marker" aria-hidden="true">${i + 1}</span>
        <div class="step-card">${stepBody(s)}</div></li>`,
    )
    .join("")}
    <li class="step step-done"><span class="step-marker" aria-hidden="true">✓</span><div class="step-card"><div class="step-title">完成: ${itemLink(target)}</div></div></li>
  </ol>${totalsTable(t.lines, t.gold, t.hasChoice)}`;
}

function routeTitle(r: Route) {
  const s = r.steps[0];
  const start = s.kind === "obtain" ? itemLink(s.item) : s.kind === "choice" ? itemLink(s.result) : s.kind === "recipe" ? itemLink(s.recipe.result) : "";
  return `${start} から <span class="muted">(${r.steps.length}手順)</span>`;
}

/** 作成ルートのセクション本体。手順が「入手」だけなら空文字 */
export function routeSection(target: string) {
  const { routes, omitted } = buildRoutes(target);
  if (!routes.length || routes.every((r) => r.steps.every((s) => s.kind === "obtain"))) return "";
  if (routes.length === 1) return routeBody(routes[0], target);
  return `<p class="muted">前段装備の違いで ${routes.length + omitted} 通りのルートがあります。</p>${routes
    .map(
      (r, i) => `<details class="route-alt" ${i === 0 ? "open" : ""}><summary>ルート${"ABCDEFGH"[i]}: ${routeTitle(r)}</summary>${routeBody(r, target)}</details>`,
    )
    .join("")}${omitted ? `<p class="muted">他 ${omitted} 通りは、各前段装備のページで確認できます。</p>` : ""}`;
}
