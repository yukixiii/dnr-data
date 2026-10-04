// 作成ルートの組み立て (表示は components/routeView.ts)。
// ベース装備の流れ (base → result) を背骨にして、入手 → 手順 → … → 完成 の一本道に並べる。
// 素材の入手レシピはたどらない (素材は各手順の葉として表示するだけ) ので、木が爆発しない。
import { groupOf, interPreds, isIntra, memberIndex, recipeById, recipesByResult, refDate } from "./data.ts";
import type { ItemGroup, Qty, Recipe } from "./types.ts";

export const MAX_ROUTES = 4;
const MAX_DEPTH = 12;
/** グループ内の段階上げがこの回数以下なら手順として1つずつ並べ、超えたら1つの「段階強化」にまとめる */
const STAGE_COLLAPSE = 2;

/** グループ内の1段階。recipe が無い (gap) ときは原文から前段だけ分かっている */
export interface Transition {
  from: string;
  to: string;
  recipe?: Recipe;
  generic?: boolean; // 部位を問わない総称レシピ
}

export type RouteStep =
  | { kind: "obtain"; item: string } // 出発点: 別途入手する
  | { kind: "recipe"; recipe: Recipe }
  | { kind: "link"; t: Transition } // レシピ未登録 or 総称レシピでの段階変化
  | { kind: "choice"; result: string; options: Recipe[] } // いずれか1つの方法で入手
  | { kind: "stages"; group: ItemGroup; transitions: Transition[] };

export interface Route {
  steps: RouteStep[];
}

/** グループ内を前の段階へさかのぼる。entry = グループの外から入ってくる段階 */
export function chainBack(id: string): { entry: string; transitions: Transition[] } {
  const g = groupOf(id);
  if (!g) return { entry: id, transitions: [] };
  const transitions: Transition[] = [];
  const seen = new Set([id]);
  let cur = id;
  for (;;) {
    const idx = memberIndex(g, cur);
    // 直前に近い段階からのレシピを優先 (マジック5段階→レア1段階 のような段の切り替わりも1本でつながる)
    const intra = (recipesByResult.get(cur) ?? [])
      .filter((r) => isIntra(r) && !seen.has(r.base!) && memberIndex(g, r.base!) < idx)
      .sort((a, b) => memberIndex(g, b.base!) - memberIndex(g, a.base!));
    let t: Transition | undefined;
    if (intra.length) t = { from: intra[0].base!, to: cur, recipe: intra[0] };
    else {
      const m = g.members[idx];
      if (m.from && !seen.has(m.from)) {
        const via = m.via ? recipeById.get(m.via) : undefined;
        t = { from: m.from, to: cur, recipe: via, generic: !!via };
      }
    }
    if (!t) break;
    transitions.unshift(t);
    cur = t.from;
    seen.add(cur);
  }
  return { entry: cur, transitions };
}

function stageSteps(id: string, transitions: Transition[]): RouteStep[] {
  if (!transitions.length) return [];
  if (transitions.length > STAGE_COLLAPSE) return [{ kind: "stages", group: groupOf(id)!, transitions }];
  return transitions.map((t) => (t.recipe && !t.generic ? { kind: "recipe", recipe: t.recipe } : { kind: "link", t }));
}

/** その装備に至る手順が1つでもあるか (無ければ「入手」で止める) */
function hasPreds(id: string) {
  const c = chainBack(id);
  return c.transitions.length > 0 || interPreds(c.entry).length > 0;
}

function back(id: string, depth: number, visited: Set<string>): RouteStep[][] {
  const { entry, transitions } = chainBack(id);
  const tail = stageSteps(id, transitions);
  const key = groupOf(entry)?.id ?? entry;
  const preds = interPreds(entry);
  if (!preds.length || visited.has(key) || depth > MAX_DEPTH) return [[{ kind: "obtain", item: entry }, ...tail]];
  const next = new Set(visited).add(key);
  // 前段装備にさらに作成手順があるものだけ別ルートとして枝分かれさせる。
  // 交換 (旧装備の下取り等) や、作り方の無いベースは「いずれか1つ」の選択肢にまとめる。
  const deep = preds.filter((r) => r.base && r.type !== "exchange" && hasPreds(r.base));
  const shallow = preds.filter((r) => !deep.includes(r));
  const out: RouteStep[][] = [];
  for (const r of deep) for (const p of back(r.base!, depth + 1, next).slice(0, MAX_ROUTES * 4)) out.push([...p, { kind: "recipe", recipe: r }, ...tail]);
  if (shallow.length === 1) {
    const r = shallow[0];
    out.push([...(r.base ? [{ kind: "obtain", item: r.base } as RouteStep] : []), { kind: "recipe", recipe: r }, ...tail]);
  } else if (shallow.length > 1) out.push([{ kind: "choice", result: entry, options: shallow }, ...tail]);
  return out;
}

const stepRecipes = (s: RouteStep): Recipe[] =>
  s.kind === "recipe"
    ? [s.recipe]
    : s.kind === "choice"
      ? s.options
      : s.kind === "link"
        ? (s.t.recipe ? [s.t.recipe] : [])
        : s.kind === "stages"
          ? s.transitions.flatMap((t) => (t.recipe ? [t.recipe] : []))
          : [];

/** 新しい告知のレシピを含むルートを先に。最大 MAX_ROUTES 件、残りは omitted */
export function buildRoutes(target: string): { routes: Route[]; omitted: number } {
  const all = back(target, 0, new Set()).map((steps) => ({ steps }));
  const newest = (r: Route) => r.steps.flatMap(stepRecipes).reduce((m, x) => (refDate(x.refs) > m ? refDate(x.refs) : m), "");
  const sorted = all.map((r, i) => ({ r, i, d: newest(r) })).sort((a, b) => b.d.localeCompare(a.d) || a.i - b.i);
  return { routes: sorted.slice(0, MAX_ROUTES).map((x) => x.r), omitted: Math.max(0, sorted.length - MAX_ROUTES) };
}

// ---------- 必要素材の合計 ----------

export interface TotalLine {
  item: string;
  sum?: number; // 数値で書かれた個数の合計
  texts: { qty: string; step: number }[]; // 「不明」「記載なし」など合計できない記載 (手順番号付き)
}

export const numericQty = (q: Qty["qty"]): number | undefined => {
  if (typeof q === "number") return q;
  return /^\d[\d,]*$/.test(q) ? Number(q.replace(/,/g, "")) : undefined;
};

/** perStep[i] = 手順 i+1 で使うレシピ。数値の個数は合計し、それ以外は記載どおり手順番号付きで残す */
function accumulate(perStep: Recipe[][]) {
  const lines = new Map<string, TotalLine>();
  let gold = 0;
  perStep.forEach((recipes, i) => {
    for (const r of recipes) {
      gold += r.gold ?? 0;
      for (const m of r.materials) {
        const line = lines.get(m.item) ?? { item: m.item, texts: [] };
        const n = numericQty(m.qty);
        if (n !== undefined) line.sum = (line.sum ?? 0) + n;
        else if (!line.texts.some((t) => t.qty === String(m.qty) && t.step === i + 1)) line.texts.push({ qty: String(m.qty), step: i + 1 });
        lines.set(m.item, line);
      }
    }
  });
  return { lines: [...lines.values()], gold };
}

/** steps の並びが表示上の手順番号 (1始まり) になる。「いずれか1つ」の選択肢は合計に入れない */
export function routeTotals(steps: RouteStep[]) {
  return {
    ...accumulate(steps.map((s) => (s.kind === "choice" ? [] : stepRecipes(s)))),
    hasChoice: steps.some((s) => s.kind === "choice"),
  };
}

/** 段階強化の素材の小計 */
export const stageSubtotal = (transitions: Transition[]) => accumulate([transitions.flatMap((t) => (t.recipe ? [t.recipe] : []))]);
