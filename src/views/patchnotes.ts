// 日韓のアップデート (data/patchnotes.json)
import { patchnotes } from "../data.ts";
import { esc } from "../components/ui.ts";
import type { PatchBlock, PatchCell, PatchNote, PatchSection } from "../types.ts";

// 本文の改行は <br> にする (表のマス内の改行など)
const text = (s: string) => esc(s).replace(/\n/g, "<br>");

function cellHtml(c: PatchCell, tag: "th" | "td") {
  if (typeof c === "string") return `<${tag}>${text(c)}</${tag}>`;
  const span = `${c.rowspan ? ` rowspan="${c.rowspan}"` : ""}${c.colspan ? ` colspan="${c.colspan}"` : ""}`;
  return `<${tag}${span}>${text(c.text)}</${tag}>`;
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
      return `<div class="table-wrap"><table class="data">${
        b.head?.length ? `<thead>${b.head.map((r) => `<tr>${r.map((c) => cellHtml(c, "th")).join("")}</tr>`).join("")}</thead>` : ""
      }<tbody>${b.rows.map((r) => `<tr>${r.map((c) => cellHtml(c, "td")).join("")}</tr>`).join("")}</tbody></table></div>${
        b.note ? `<p class="muted">${text(b.note)}</p>` : ""
      }`;
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
  return `<details class="pn-section"><summary>${esc(s.heading)}${orig}${s.summary_only ? ` <span class="chip">要約</span>` : ""}</summary>
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
    <h2><span class="badge region-${n.region}">${n.region}</span> ${esc(n.date)} ${esc(n.title_ja ?? n.title)}</h2>
    <p class="muted">${n.title_ja ? `原題: ${esc(n.title)} ・ ` : ""}<a href="${esc(n.url)}" target="_blank" rel="noopener">公式の告知 ↗</a>${
      n.region === "KR" ? " ・ 非公式の日本語訳です。名称は日本版にあるものは日本版の表記にしています。" : ""
    }</p>
    ${n.sections.map(sectionHtml).join("")}
  </article>`;
}

export function renderPatchnotes(query: URLSearchParams) {
  const region = query.get("region");
  const list = patchnotes.filter((n) => !region || n.region === region);
  const tab = (r: string | null, label: string) =>
    `<a class="chip${r === region ? " is-active" : ""}" href="#/patchnotes${r ? `?region=${r}` : ""}">${label}</a>`;
  return `<h1>日韓アップデート</h1>
  <p class="muted">韓国版と日本版のアップデート告知の内容をまとめています。韓国版は日本語訳、日本版は公式お知らせの内容を整理したものです。イベント・パッケージなどは要約のみです。正確な内容は各公式の告知をご覧ください。</p>
  <nav class="pn-tabs">${tab(null, "すべて")}${tab("KR", "韓国")}${tab("JP", "日本")}</nav>
  ${list.length ? list.map(noteHtml).join("") : `<p>まだありません。</p>`}`;
}

