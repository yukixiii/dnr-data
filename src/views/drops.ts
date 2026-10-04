// ドロップ率・報酬表 / ダンジョン詳細
import { currentId, ds, dropsByLocation, dungeonById, itemById, newestFirst, refDate, shownEntry, simpleBags, type ShownEntry } from "../data.ts";
import { compareFloors, floorRowKey } from "../floors.ts";
import type { DropEntry, DropTable } from "../types.ts";
import { empty, esc, href, itemLink, locationLink, rateCell, refInline, refList, regionBadges } from "../components/ui.ts";

const LOC_KIND_LABEL: Record<DropTable["location_kind"], string> = {
  dungeon: "ダンジョン",
  box: "箱・袋",
  shop: "商店",
  quest: "クエスト",
  gather: "採集",
  other: "その他",
};

/** 袋を経由した行の注記 (袋名に (+12) や (下級) などの情報があるので残す) */
const viaNote = (via?: string) =>
  via ? ` <a class="via muted" href="${href("item", via)}" title="この袋から出る">(${esc(itemById.get(via)?.name ?? via)})</a>` : "";

const hasRate = (e: DropEntry) => e.rate !== undefined || !!e.rate_text;

/** 階層表・エリア表の1セル分: (獲得元:) アイテム ×個数 (袋) 確率 (階層) */
const entryLine = (e: ShownEntry, from?: string, floors?: string) =>
  `<li>${from ? `<span class="muted">${esc(from)}:</span> ` : ""}${itemLink(e.item, e.qty)}${viaNote(e.via)}${hasRate(e) ? ` ${rateCell(e.rate, e.rate_text)}` : ""}${
    floors ? ` <span class="muted">(${esc(floors)})</span>` : ""
  }</li>`;

const ALL_FLOORS = "全階層";

/**
 * 階層ごとの表: 行 = 階層 (表の並びに関係なく階層順。範囲の表記はそのまま1行)、列 = 獲得元。
 * 階層の指定が無い行は先頭の「全階層」にまとめる。獲得元が多すぎる表は列にせず、セルの中に書く。
 */
function floorTableHtml(entries: ShownEntry[]) {
  const froms = [...new Set(entries.map((e) => e.from ?? ""))];
  const asCols = froms.length > 1 && froms.length <= 5;
  const rows = new Map<string, { label: string; es: ShownEntry[] }>();
  for (const e of entries) {
    const f = e.floors?.trim();
    const label = !f || f === ALL_FLOORS ? ALL_FLOORS : f;
    const key = label === ALL_FLOORS ? ALL_FLOORS : floorRowKey(label);
    const row = rows.get(key) ?? rows.set(key, { label, es: [] }).get(key)!;
    row.es.push(e);
  }
  const ordered = [...rows.values()].sort((a, b) =>
    a.label === ALL_FLOORS ? -1 : b.label === ALL_FLOORS ? 1 : compareFloors(a.label, b.label),
  );
  const cols = asCols ? froms : [""];
  // 獲得元が 1 種類だけならそれを列の見出しにする
  const head = asCols ? froms.map((f) => `<th>${esc(f || "報酬")}</th>`).join("") : `<th>${esc((froms.length === 1 && froms[0]) || "アイテム")}</th>`;
  const body = ordered
    .map(({ label, es }) => {
      const cells = cols
        .map((c) => {
          const hit = asCols ? es.filter((e) => (e.from ?? "") === c) : es;
          return `<td>${hit.length ? `<ul class="drop-list">${hit.map((e) => entryLine(e, !asCols && froms.length > 1 ? e.from : undefined)).join("")}</ul>` : ""}</td>`;
        })
        .join("");
      return `<tr><th>${esc(label)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data floor-table">
      <thead><tr><th>階層/条件</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/**
 * 階層の区別が無いダンジョンの表: 行 = 獲得元 (第1エリア / クリア / 金箱 など。出てきた順)、セル = その獲得元で出るアイテム。
 * 階層の指定が 1 種類だけある行は、アイテムの後ろに添える。
 */
function areaTableHtml(entries: ShownEntry[]) {
  const rows = new Map<string, ShownEntry[]>();
  for (const e of entries) rows.set(e.from ?? "", [...(rows.get(e.from ?? "") ?? []), e]);
  const body = [...rows.entries()]
    .map(([from, es]) => `<tr><th>${esc(from || "報酬")}</th><td><ul class="drop-list">${es.map((e) => entryLine(e, undefined, e.floors)).join("")}</ul></td></tr>`)
    .join("");
  return `<div class="table-wrap"><table class="data floor-table">
      <thead><tr><th>エリア/獲得元</th><th>アイテム</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/** 階層表にする表: 階層の指定が 2 種類以上あるもの */
const byFloor = (t: DropTable) => new Set(t.entries.map((e) => e.floors?.trim()).filter((f) => f && f !== ALL_FLOORS)).size >= 2;

export function dropTableHtml(t: DropTable) {
  const entries = t.entries.map(shownEntry);
  const head = `<h3>${t.label ? esc(t.label) : "報酬"} ${regionBadges(t.refs)} ${refInline(t.refs)}${
    refDate(t.refs) ? `<span class="muted">${esc(refDate(t.refs))} 告知</span>` : ""
  }</h3>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}`;
  if (byFloor(t)) return `<div class="drop-table">${head}${floorTableHtml(entries)}</div>`;
  // ダンジョン・コンテンツの表はすべて「どこで何が出るか」の形にする (箱の中身・商店などは従来の一覧)
  if (dungeonById.has(t.location)) return `<div class="drop-table">${head}${areaTableHtml(entries)}</div>`;

  const hasFrom = entries.some((e) => e.from);
  const hasFloors = entries.some((e) => e.floors);
  const hasQty = entries.some((e) => e.qty !== undefined && e.qty !== "");
  const numericSum = entries.reduce((s, e) => s + (e.rate ?? 0), 0);
  return `<div class="drop-table">${head}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>アイテム</th>${hasFrom ? "<th>獲得元</th>" : ""}${hasFloors ? "<th>階層/条件</th>" : ""}<th>確率</th>${hasQty ? "<th>個数</th>" : ""}</tr></thead>
      <tbody>${entries
        .map(
          (e) => `<tr><td>${itemLink(e.item)}${viaNote(e.via)}</td>${hasFrom ? `<td>${esc(e.from ?? "")}</td>` : ""}${
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
    // 中身が 1 種類だけの袋の表は出さない (ドロップ表では袋の代わりに中身を表示している)
    if (t.location_kind === "box" && simpleBags.has(t.location)) return false;
    if (kind && t.location_kind !== kind) return false;
    if (!q) return true;
    const names = t.entries.flatMap((e) => [e.item, shownEntry(e).item]).map((x) => itemById.get(x)?.name ?? x);
    const hay = [t.location, t.label, ...names].join(" ").toLowerCase();
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
  if (!dungeonById.has(id) && !dropsByLocation.has(id)) id = currentId(id); // 統合・改名された旧名のリンク
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
