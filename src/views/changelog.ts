// 更新履歴 (data/changelog.json)
import { changelog, defaultMember, groupById, itemById } from "../data.ts";
import { esc, href, itemAnchor, itemLink, locationLink } from "../components/ui.ts";
import type { ChangelogDay, ChangelogEntry } from "../types.ts";

const KIND_LABEL: Record<ChangelogEntry["kind"], string> = { add: "追加", tidy: "整理", view: "表示", fix: "修正" };

function linkHtml(l: NonNullable<ChangelogEntry["links"]>[number]) {
  if (l.kind === "dungeon") return locationLink(l.id, "dungeon");
  if (l.kind === "page") return `<a href="#/${esc(l.id)}">${esc(l.label ?? l.id)}</a>`;
  // グループ id は代表の段階のアイコン・等級でグループ名を出す
  const g = groupById.get(l.id);
  const rep = g && itemById.get(defaultMember(g));
  return g && rep ? itemAnchor(rep, g.id, g.name) : itemLink(l.id);
}

function dayHtml(d: ChangelogDay, limit = Infinity, h = "h2") {
  return `<section class="changelog-day"><${h}>${esc(d.date)}</${h}><ul class="changelog">${d.changes
    .slice(0, limit)
    .map(
      (c) =>
        `<li><span class="chip cl-${c.kind}">${KIND_LABEL[c.kind]}</span> <span>${esc(c.text)}${
          c.links?.length ? ` <span class="cl-links">${c.links.map(linkHtml).join("")}</span>` : ""
        }</span></li>`,
    )
    .join("")}</ul></section>`;
}

export function renderChangelog() {
  return `<h1>更新履歴</h1>
  <p class="muted">このサイトのデータと表示の主な変更です。ゲーム本体のアップデートは<a href="${href("patchnotes")}">日韓アップデート</a>をご覧ください。</p>
  ${changelog.map((d) => dayHtml(d)).join("")}`;
}

/** トップページ用: 最新 days 日分、各日 limit 行まで */
export function renderRecentChanges(days = 2, limit = 4) {
  if (!changelog.length) return "";
  return `<section class="recent-changes"><h2>最近の更新</h2>${changelog
    .slice(0, days)
    .map((d) => dayHtml(d, limit, "h3"))
    .join("")}<p><a href="${href("changelog")}">更新履歴をすべて見る →</a></p></section>`;
}
