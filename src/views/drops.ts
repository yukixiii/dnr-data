// ドロップ率・報酬表 / ダンジョン詳細
import { ds, dropsByLocation, dungeonById, itemById, newestFirst, refDate } from "../data.ts";
import type { DropTable } from "../types.ts";
import { empty, esc, href, itemLink, locationLink, rateCell, refInline, refList, regionBadges } from "../components/ui.ts";

const LOC_KIND_LABEL: Record<DropTable["location_kind"], string> = {
  dungeon: "ダンジョン",
  box: "箱・袋",
  shop: "商店",
  quest: "クエスト",
  gather: "採集",
  other: "その他",
};

export function dropTableHtml(t: DropTable) {
  const hasFrom = t.entries.some((e) => e.from);
  const hasFloors = t.entries.some((e) => e.floors);
  const hasQty = t.entries.some((e) => e.qty !== undefined && e.qty !== "");
  const numericSum = t.entries.reduce((s, e) => s + (e.rate ?? 0), 0);
  return `<div class="drop-table">
    <h3>${t.label ? esc(t.label) : "報酬"} ${regionBadges(t.refs)} ${refInline(t.refs)}${
      refDate(t.refs) ? `<span class="muted">${esc(refDate(t.refs))} 告知</span>` : ""
    }</h3>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>アイテム</th>${hasFrom ? "<th>獲得元</th>" : ""}${hasFloors ? "<th>階層/条件</th>" : ""}<th>確率</th>${hasQty ? "<th>個数</th>" : ""}</tr></thead>
      <tbody>${t.entries
        .map(
          (e) => `<tr><td>${itemLink(e.item)}</td>${hasFrom ? `<td>${esc(e.from ?? "")}</td>` : ""}${
            hasFloors ? `<td>${esc(e.floors ?? "")}</td>` : ""
          }<td>${rateCell(e.rate, e.rate_text)}</td>${hasQty ? `<td>${esc(e.qty ?? "")}</td>` : ""}</tr>`,
        )
        .join("")}</tbody>
    </table></div>
    ${numericSum > 0 && Math.abs(numericSum - 100) < 0.5 ? `<p class="muted">確率合計 ${numericSum.toFixed(2)}%</p>` : ""}
  </div>`;
}

export function renderDrops(query: URLSearchParams) {
  const q = (query.get("q") ?? "").toLowerCase();
  const kind = query.get("kind") ?? "";
  const tables = newestFirst(ds.drops).filter((t) => {
    if (kind && t.location_kind !== kind) return false;
    if (!q) return true;
    const hay = [t.location, t.label, ...t.entries.map((e) => itemById.get(e.item)?.name ?? e.item)].join(" ").toLowerCase();
    return hay.includes(q);
  });
  const byLoc = new Map<string, DropTable[]>();
  for (const t of tables) byLoc.set(t.location, [...(byLoc.get(t.location) ?? []), t]);

  return `<h1>ドロップ率・報酬</h1>
  <form class="filters" data-filter>
    <input type="search" name="q" value="${esc(query.get("q") ?? "")}" placeholder="ダンジョン名・アイテム名で検索" aria-label="検索">
    <select name="kind" aria-label="区分"><option value="">すべての区分</option>${Object.entries(LOC_KIND_LABEL)
      .map(([k, v]) => `<option value="${k}" ${k === kind ? "selected" : ""}>${v}</option>`)
      .join("")}</select>
  </form>
  <p class="muted">${byLoc.size} 箇所 / ${tables.length} 表。「確定」「一定確率」等は公式の定性表記で、数値が公開されていないものです。</p>
  ${
    byLoc.size
      ? [...byLoc.entries()]
          .map(
            ([loc, ts]) => `<section class="group">
      <h2>${locationLink(loc, ts[0].location_kind)} <span class="chip">${LOC_KIND_LABEL[ts[0].location_kind]}</span></h2>
      ${ts.map(dropTableHtml).join("")}
    </section>`,
          )
          .join("")
      : empty("該当する報酬表がありません")
  }`;
}

export function renderDungeon(id: string) {
  const d = dungeonById.get(id);
  const tables = newestFirst(dropsByLocation.get(id) ?? []);
  if (!d && !tables.length) return `<h1>${esc(id)}</h1>${empty("登録されていません")}`;
  const kindLabel: Record<string, string> = { nest: "ネスト", stage: "ステージ", dungeon: "ダンジョン", raid: "レイド", pvp: "PvP", event: "イベント", other: "その他" };
  return `<nav class="crumbs"><a href="${href("dungeons")}">ダンジョン一覧</a></nav>
  <header class="detail-head">
    <h1>${esc(id)}</h1>
    ${
      d
        ? `<div class="meta"><span class="chip">${kindLabel[d.kind]}</span>${d.level ? `<span class="chip">Lv${d.level}</span>` : ""}${
            d.difficulty ? `<span class="chip">${esc(d.difficulty)}</span>` : ""
          } ${regionBadges(d.refs)}</div>
    ${d.entry ? `<p><strong>入場:</strong> ${esc(d.entry)}</p>` : ""}
    ${d.notes ? `<p class="desc">${esc(d.notes)}</p>` : ""}`
        : ""
    }
  </header>
  <section><h2>報酬・ドロップ</h2><p class="muted">シーズン制コンテンツは告知ごとに報酬が異なるため、新しい告知の表から順に表示しています。</p>${tables.length ? tables.map(dropTableHtml).join("") : empty("報酬表なし")}</section>
  ${d ? `<section><h2>出典</h2>${refList(d.refs)}</section>` : ""}`;
}

export function renderDungeonList() {
  const kindLabel: Record<string, string> = { nest: "ネスト", stage: "ステージ", dungeon: "ダンジョン", raid: "レイド", pvp: "PvP", event: "イベント", other: "その他" };
  const groups = new Map<string, typeof ds.dungeons>();
  for (const d of ds.dungeons) groups.set(d.kind, [...(groups.get(d.kind) ?? []), d]);
  return `<h1>ダンジョン・コンテンツ</h1>${[...groups.entries()]
    .map(
      ([k, arr]) => `<section class="group"><h2>${kindLabel[k]} <span class="count">${arr.length}</span></h2>
      <ul class="cards">${arr
        .map(
          (d) => `<li class="card"><div class="card-title"><a href="${href("dungeon", d.id)}">${esc(d.name)}</a></div>
          <div class="card-meta">${d.level ? `<span class="chip">Lv${d.level}</span>` : ""}${
            dropsByLocation.has(d.id) ? `<span class="tag">報酬表 ${dropsByLocation.get(d.id)!.length}</span>` : ""
          }</div>${d.entry ? `<div class="card-foot muted">${esc(d.entry)}</div>` : ""}</li>`,
        )
        .join("")}</ul></section>`,
    )
    .join("")}`;
}
