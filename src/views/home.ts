// トップページと出典一覧
import { ds, lastUpdated, recipesByResult, sourceById, tablesByItem } from "../data.ts";
import { esc, href, itemLink } from "../components/ui.ts";

export function renderHome() {
  // 系統ごとの装備数。最新の公式お知らせで扱われた系統 (=最新装備) を先に並べる
  const series = new Map<string, { count: number; withRecipe: number; level: number; latest: string }>();
  for (const it of ds.items) {
    if (!it.series) continue;
    const s = series.get(it.series) ?? { count: 0, withRecipe: 0, level: 0, latest: "" };
    s.count++;
    if (recipesByResult.has(it.id)) s.withRecipe++;
    s.level = Math.max(s.level, it.level ?? 0);
    // 系統が初登場した時期 (系統内で最も古い出典日) で並べる
    const first = it.refs.map((r) => sourceById.get(r.source)?.published_at ?? "").filter(Boolean).sort()[0] ?? "";
    if (first && (!s.latest || first < s.latest)) s.latest = first;
    series.set(it.series, s);
  }
  const topSeries = [...series.entries()]
    .filter(([, s]) => s.count >= 2)
    .sort((a, b) => b[1].latest.localeCompare(a[1].latest) || b[1].count - a[1].count)
    .slice(0, 16);
  const latestSources = ds.sources.filter((s) => s.kind === "official").slice(0, 6);
  const featured = ds.items.filter((it) => recipesByResult.has(it.id) && tablesByItem.has(it.id)).slice(0, 8);

  return `
  <section class="hero">
    <h1>ドラゴンネストR 装備データベース</h1>
    <p>最新装備の作成ルート・素材の入手先・ステータス・強化確率・ドロップ率を、公式お知らせと日中韓の情報源から出典付きでまとめています。</p>
    <form class="hero-search" action="#/items" data-search>
      <input type="search" name="q" placeholder="装備名・素材名で検索" aria-label="検索">
      <button type="submit">検索</button>
    </form>
    <dl class="stats-row">
      <div><dt>装備</dt><dd><a href="${href("items")}">${ds.items.length}</a></dd></div>
      <div><dt>素材・アイテム</dt><dd><a href="${href("materials")}">${ds.materials.length}</a></dd></div>
      <div><dt>作成レシピ</dt><dd>${ds.recipes.length}</dd></div>
      <div><dt>確率表</dt><dd><a href="${href("enhance")}">${ds.enhance_tables.length}</a></dd></div>
      <div><dt>報酬表</dt><dd><a href="${href("drops")}">${ds.drops.length}</a></dd></div>
    </dl>
  </section>

  ${
    topSeries.length
      ? `<section><h2>装備系統 <span class="count">新しい順</span></h2><ul class="cards series">${topSeries
          .map(
            ([name, s]) => `<li class="card"><div class="card-title"><a href="#/items?series=${encodeURIComponent(name)}">${esc(name)}</a></div>
          <div class="card-meta"><span class="chip">${s.count}件</span>${s.latest ? `<span class="chip">${esc(s.latest.slice(0, 7))}〜</span>` : ""}${s.level ? `<span class="chip">Lv${s.level}</span>` : ""}${
            s.withRecipe ? `<span class="tag">作成ルート ${s.withRecipe}</span>` : ""
          }</div></li>`,
          )
          .join("")}</ul></section>`
      : ""
  }

  ${
    featured.length
      ? `<section><h2>作成ルートと強化表がそろっている装備</h2><ul class="plain inline">${featured.map((it) => `<li>${itemLink(it.id)}</li>`).join("")}</ul></section>`
      : ""
  }

  <section><h2>最近の公式アップデート</h2><ul class="plain">${latestSources
    .map((s) => `<li><span class="muted">${esc(s.published_at ?? "")}</span> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`)
    .join("")}</ul>
    <p><a href="${href("sources")}">すべての出典 →</a></p>
  </section>
  <p class="muted">データ最終取得日: ${esc(lastUpdated)}</p>`;
}

export function renderSources() {
  const byRegion = { JP: [] as typeof ds.sources, KR: [] as typeof ds.sources, CN: [] as typeof ds.sources };
  for (const s of ds.sources) byRegion[s.region].push(s);
  const label = { JP: "日本", KR: "韓国", CN: "中国" };
  const kindLabel = { official: "公式", wiki: "Wiki", community: "コミュニティ" };
  return `<h1>出典・更新履歴</h1>
  <p>各データには出典を付けています。<span class="badge region-JP">JP</span> 日本版、<span class="badge region-KR">KR</span> 韓国版、<span class="badge region-CN">CN</span> 中国版の情報です。日本版で数値が公開されていない場合のみ海外版の値で補完し、「海外版の値」と表示しています。海外版は実装時期や数値が日本版と異なる場合があります。</p>
  ${(Object.keys(byRegion) as (keyof typeof byRegion)[])
    .filter((r) => byRegion[r].length)
    .map(
      (r) => `<section><h2><span class="badge region-${r}">${r}</span> ${label[r]} <span class="count">${byRegion[r].length}</span></h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>公開日</th><th>種別</th><th>タイトル</th><th>取得日</th></tr></thead><tbody>${byRegion[r]
      .map(
        (s) => `<tr><td>${esc(s.published_at ?? "")}</td><td>${kindLabel[s.kind]}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(
          s.title,
        )}</a></td><td>${esc(s.fetched_at)}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>`,
    )
    .join("")}`;
}
