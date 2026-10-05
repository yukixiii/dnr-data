// ハッシュルーター。静的ホスティングでサーバー設定なしに動くよう #/path?query 形式を使う。
import "./style.css";
import { lastUpdated, optionAliasOf, resolveDetail } from "./data.ts";
import { renderItemList } from "./views/itemList.ts";
import { renderItemDetail } from "./views/itemDetail.ts";
import { renderEnhanceList, renderEnhanceTable } from "./views/enhance.ts";
import { renderDrops, renderDungeon, renderDungeonList } from "./views/drops.ts";
import { renderOptionList, renderOptionTable } from "./views/options.ts";
import { renderHome, renderSources } from "./views/home.ts";

const app = document.getElementById("app")!;

type Route = { path: string[]; query: URLSearchParams };

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [p, q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

function render({ path, query }: Route): { html: string; title: string; nav: string } {
  const [page, id] = path;
  switch (page) {
    case undefined:
      return { html: renderHome(), title: "", nav: "" };
    case "items":
      return { html: renderItemList(query, "equipment"), title: "装備一覧", nav: "items" };
    case "materials":
      return { html: renderItemList(query, "materials"), title: "素材一覧", nav: "materials" };
    case "item":
      return { html: renderItemDetail(id), title: resolveDetail(id)?.group?.name ?? id, nav: "items" };
    case "enhance":
      // ランダムオプション表に吸収した旧い表のリンク
      if (id && optionAliasOf(id)) return { html: renderOptionTable(optionAliasOf(id)!), title: "ランダムオプション", nav: "options" };
      return id
        ? { html: renderEnhanceTable(id), title: "強化確率", nav: "enhance" }
        : { html: renderEnhanceList(query), title: "強化・段階確率", nav: "enhance" };
    case "options":
      return { html: renderOptionList(query), title: "ランダムオプション", nav: "options" };
    case "option":
      return { html: renderOptionTable(id), title: "ランダムオプション", nav: "options" };
    case "drops":
      return { html: renderDrops(query), title: "ドロップ率", nav: "drops" };
    case "dungeons":
      return { html: renderDungeonList(), title: "ダンジョン", nav: "dungeons" };
    case "dungeon":
      return { html: renderDungeon(id), title: id, nav: "dungeons" };
    case "sources":
      return { html: renderSources(), title: "出典", nav: "sources" };
    default:
      return { html: `<h1>ページが見つかりません</h1><p><a href="#/">トップへ</a></p>`, title: "Not found", nav: "" };
  }
}

let lastPage = "";
function update() {
  const route = parse();
  const { html, title, nav } = render(route);
  app.innerHTML = html;
  document.title = title ? `${title} | DNR装備DB` : "DNR装備DB";
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  // 同じ一覧ページ内のフィルタ変更ではスクロール位置と入力フォーカスを保つ
  const pageKey = route.path.join("/");
  if (pageKey !== lastPage) window.scrollTo(0, 0);
  lastPage = pageKey;
}

// フィルタフォーム: 入力のたびに URL のクエリを書き換える (履歴は置き換え)
// IME 変換中に再描画すると入力欄が作り直されて未確定の文字が確定してしまうため、変換が終わるまで待つ
let debounce = 0;
let composing = false;
app.addEventListener("compositionstart", () => {
  composing = true;
  clearTimeout(debounce);
});
app.addEventListener("compositionend", (e) => {
  composing = false;
  scheduleFilter(e.target as HTMLElement);
});
app.addEventListener("input", (e) => {
  if (composing || (e as InputEvent).isComposing) return;
  scheduleFilter(e.target as HTMLElement);
});
function scheduleFilter(target: HTMLElement) {
  const form = target.closest<HTMLFormElement>("form[data-filter]");
  if (!form) return;
  clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    if (composing) return;
    const params = new URLSearchParams();
    new FormData(form).forEach((v, k) => v && params.set(k, String(v)));
    const base = location.hash.split("?")[0] || "#/";
    const active = document.activeElement as HTMLInputElement | null;
    const name = active?.name;
    const pos = active?.selectionStart ?? null;
    history.replaceState(null, "", `${base}${params.size ? `?${params}` : ""}`);
    update();
    if (name) {
      const el = app.querySelector<HTMLInputElement>(`form[data-filter] [name="${name}"]`);
      el?.focus();
      if (el && pos !== null && "setSelectionRange" in el && el.type === "search") el.setSelectionRange(pos, pos);
    }
  }, 150);
}
app.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.matches("[data-search]")) {
    const q = new FormData(form).get("q");
    location.hash = `#/items${q ? `?q=${encodeURIComponent(String(q))}` : ""}`;
  }
});

document.getElementById("updated")!.textContent = lastUpdated;
window.addEventListener("hashchange", update);
update();
