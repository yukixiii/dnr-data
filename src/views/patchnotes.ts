// 日韓のアップデート (data/patchnotes.json)
import { patchnotes } from "../data.ts";
import { esc, href } from "../components/ui.ts";
import type { PatchBlock, PatchCell, PatchNote, PatchSection } from "../types.ts";

// 本文の改行は <br> にする (表のマス内の改行など)
const text = (s: string) => esc(s).replace(/\n/g, "<br>");

function cellHtml(c: PatchCell, tag: "th" | "td") {
  if (typeof c === "string") return `<${tag}>${text(c)}</${tag}>`;
  const span = `${c.rowspan ? ` rowspan="${c.rowspan}"` : ""}${c.colspan ? ` colspan="${c.colspan}"` : ""}`;
  return `<${tag}${span}>${text(c.text)}</${tag}>`;
}

const rowHtml = (r: PatchCell[], tag: "th" | "td") => `<tr>${r.map((c) => cellHtml(c, tag)).join("")}</tr>`;
const cellText = (c: PatchCell) => (typeof c === "string" ? c : c.text);

// 日本版の告知の表は見出し行が分かれていないので、形から見出しを決める。
// 2 列だけの表は「項目 | 値」として左の列を見出しにし、それ以外は空のマスの無い 1 行目 (縦に結合していればその行数ぶん) を見出しにする
function tableHtml(b: Extract<PatchBlock, { type: "table" }>) {
  let head = b.head ?? [];
  let rows = b.rows;
  let kv = false;
  if (!head.length && rows.length > 1) {
    if (rows.every((r) => r.length === 2 && cellText(r[0]))) kv = true;
    else if (rows[0].every((c) => cellText(c))) {
      const n = Math.max(...rows[0].map((c) => (typeof c === "string" ? 1 : (c.rowspan ?? 1))));
      head = rows.slice(0, n);
      rows = rows.slice(n);
    }
  }
  const body = kv
    ? rows.map((r) => `<tr>${cellHtml(r[0], "th")}${cellHtml(r[1], "td")}</tr>`).join("")
    : rows.map((r) => rowHtml(r, "td")).join("");
  return `<div class="table-wrap"><table class="data${kv ? " pn-kv" : ""}">${
    head.length ? `<thead>${head.map((r) => rowHtml(r, "th")).join("")}</thead>` : ""
  }<tbody>${body}</tbody></table></div>${b.note ? `<p class="pn-note">${text(b.note)}</p>` : ""}`;
}

function blockHtml(b: ViewBlock, s: PatchSection) {
  switch (b.type) {
    case "h":
      return b.level === 1 ? `<h4>${text(b.text)}</h4>` : `<h5>${text(b.text)}</h5>`;
    case "p":
      return `<p>${text(b.text)}</p>`;
    case "ul":
      return `<ul>${b.items.map((i) => `<li>${text(i)}</li>`).join("")}</ul>`;
    case "table":
      return tableHtml(b);
    case "img":
    case "imgs": {
      const label = `画像${b.type === "img" && b.alt ? `: ${esc(b.alt)}` : b.type === "imgs" && b.count > 1 ? ` ×${b.count}` : ""} (原文参照)`;
      return `<p class="pn-img">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${label}</a>` : label}</p>`;
    }
  }
}

function sectionHtml(s: PatchSection) {
  const orig = s.heading_orig && s.heading_orig !== s.heading ? ` <span class="muted">${esc(s.heading_orig)}</span>` : "";
  const src = s.url ? `<p class="pn-src"><a href="${esc(s.url)}" target="_blank" rel="noopener">原文 ↗</a></p>` : "";
  return `<details class="pn-section"><summary><span class="pn-heading">${esc(s.heading)}</span>${orig}${s.summary_only ? ` <span class="chip">要約</span>` : ""}</summary>
    <div class="pn-body">${imgRuns(s.blocks)
      .map((b) => blockHtml(b, s))
      .join("")}${src}</div></details>`;
}

// 説明の無い画像が続くときは「画像 ×3」のように 1 行にまとめる
type ViewBlock = PatchBlock | { type: "imgs"; count: number };
function imgRuns(blocks: PatchBlock[]): ViewBlock[] {
  const out: ViewBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === "img" && !b.alt && last?.type === "imgs") last.count++;
    else out.push(b.type === "img" && !b.alt ? { type: "imgs", count: 1 } : b);
  }
  return out;
}

function noteHtml(n: PatchNote) {
  return `<article class="patchnote" id="pn-${esc(n.id)}">
    <h2 class="pn-title"><span class="badge region-${n.region}">${n.region}</span> ${esc(n.title_ja ?? n.title)}</h2>
    <p class="pn-meta">${n.title_ja ? `原題: ${esc(n.title)} ・ ` : ""}<a href="${esc(n.url)}" target="_blank" rel="noopener">公式の告知 ↗</a>${
      n.region === "KR" ? " ・ 非公式の日本語訳です。名称は日本版にあるものは日本版の表記にしています。" : ""
    }</p>
    ${n.sections.map(sectionHtml).join("")}
  </article>`;
}

const INTRO = `<p class="muted">韓国版と日本版のアップデート告知の内容をまとめています。韓国版は日本語訳、日本版は公式お知らせの内容を整理したものです。イベント・パッケージなどは要約のみです。正確な内容は各公式の告知をご覧ください。</p>`;

// 地域で絞った告知を日付ごとにまとめる (データが新しい順なので日付も新しい順)
function byDate(region: string | null) {
  const days = new Map<string, PatchNote[]>();
  for (const n of patchnotes) if (!region || n.region === region) days.set(n.date, [...(days.get(n.date) ?? []), n]);
  return days;
}

const dayHref = (date: string, region: string | null) => `${href("patchnotes", date)}${region ? `?region=${region}` : ""}`;

export function renderPatchnotes(query: URLSearchParams) {
  const region = query.get("region");
  const days = byDate(region);
  const tab = (r: string | null, label: string) =>
    `<a class="chip${r === region ? " is-active" : ""}" href="#/patchnotes${r ? `?region=${r}` : ""}">${label}</a>`;
  return `<h1>日韓アップデート</h1>
  ${INTRO}
  <nav class="pn-tabs">${tab(null, "すべて")}${tab("KR", "韓国")}${tab("JP", "日本")}</nav>
  ${
    days.size
      ? `<ul class="cards pn-days">${[...days.entries()]
          .map(
            ([date, notes]) => `<li class="card"><div class="card-title"><a href="${dayHref(date, region)}">${esc(date)}</a></div>
          <ul class="pn-day-notes">${notes
            .map(
              (n) =>
                `<li><span class="badge region-${n.region}">${n.region}</span> ${esc(n.title_ja ?? n.title)} <span class="muted">${n.sections.length} 項目</span></li>`,
            )
            .join("")}</ul></li>`,
          )
          .join("")}</ul>`
      : `<p>まだありません。</p>`
  }`;
}

/** 1 日分のページ。同じ日の告知 (日本の複数のお知らせ、日韓の両方) をまとめて出す */
export function renderPatchnoteDay(date: string, query: URLSearchParams) {
  const region = query.get("region");
  const days = byDate(region);
  const dates = [...days.keys()];
  const i = dates.indexOf(date);
  const crumbs = `<nav class="crumbs"><a href="${href("patchnotes")}${region ? `?region=${region}` : ""}">日韓アップデート一覧</a></nav>`;
  if (i < 0) return `${crumbs}<h1>${esc(date)} のアップデート</h1><p>この日のアップデートはありません。</p>`;
  const newer = dates[i - 1];
  const older = dates[i + 1];
  return `${crumbs}
  <h1>${esc(date)} のアップデート</h1>
  ${INTRO}
  ${days.get(date)!.map(noteHtml).join("")}
  <nav class="pn-pager">${newer ? `<a href="${dayHref(newer, region)}">← ${esc(newer)}</a>` : "<span></span>"}${
    older ? `<a href="${dayHref(older, region)}">${esc(older)} →</a>` : "<span></span>"
  }</nav>`;
}

