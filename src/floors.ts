// ドロップ表の階層表記 (DropEntry.floors) の解析。階層ごとの表に並べ替えるために使う。
// 表記は出典ごとに揺れる: "AS-03-1" "DM1" "LB15" "12階層" "AS-01～DM-10" "AS-03 ～ AS-04-5" "AS-01～06階層" "AS-05階層～" "ラビリンス15階層以上" など。
// 解析できないもの ("10,15,20～50階層" "5階層 120秒" "クラス1位" 等) は undefined を返し、呼び出し側で元の表記のまま扱う。

/** 並べ替えのキー: [系統, 番号, 細分]。系統は 階層=0 < LB=1 < AS=2 < DM=3 */
export type FloorKey = number[];

export interface FloorSpan {
  start: FloorKey;
  end: FloorKey; // 開いた範囲 ("AS-05階層～") は Infinity
  single: boolean;
}

const norm = (s: string) => s.normalize("NFKC").replace(/[〜～]/g, "~").replace(/\s+/g, "");

function token(t: string): FloorKey | undefined {
  let m = t.match(/^AS-?0*(\d+)(?:-(\d+))?(?:階層)?$/);
  if (m) return [2, +m[1], m[2] ? +m[2] : 0];
  m = t.match(/^DM-?0*(\d+)(?:-(\d+))?(?:階層)?$/);
  if (m) return [3, +m[1], m[2] ? +m[2] : 0];
  m = t.match(/^LB0*(\d+)$/);
  if (m) return [1, +m[1], 0];
  m = t.match(/^(?:ラビリンス|アセンション)?0*(\d+)(?:階層)?$/);
  if (m) return [0, +m[1], 0];
  return undefined;
}

export function parseFloors(s: string | undefined): FloorSpan | undefined {
  if (!s) return undefined;
  const t = norm(s);
  const one = token(t);
  if (one) return { start: one, end: one, single: true };
  // 開いた範囲: "AS-05階層~" "DM-01~" "ラビリンス15階層以上" "アセンション2階層以上~"
  const open = t.match(/^(.+?)(?:以上~?|~)$/);
  if (open) {
    const a = token(open[1]);
    return a ? { start: a, end: [a[0], Infinity, 0], single: false } : undefined;
  }
  const m = t.match(/^(.+?)~(.+)$/);
  if (!m) return undefined;
  let a = token(m[1]);
  let b = token(m[2]);
  // 片側だけ系統が書かれていない ("1~25階層" "AS-01~06階層") ものは、書かれている側の系統にする
  if (!a && b && /^\d+$/.test(m[1])) a = [b[0], +m[1], 0];
  if (a && b && a[0] !== b[0] && /^\d+(階層)?$/.test(m[2])) b = [a[0], parseInt(m[2], 10), 0];
  return a && b ? { start: a, end: b, single: false } : undefined;
}

export const cmpKey = (a: FloorKey, b: FloorKey) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/**
 * 階層表記の並べ替え。解析できるものは開始の階層順 (同じ開始なら広い範囲が先)、解析できないものは後ろ (元の順)。
 * 戻り値は Array.prototype.sort にそのまま渡せる比較結果 (解析できない同士は 0 で安定ソートに任せる)。
 */
export function compareFloors(a: string | undefined, b: string | undefined) {
  const pa = parseFloors(a);
  const pb = parseFloors(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  return cmpKey(pa.start, pb.start) || cmpKey(pb.end, pa.end);
}

/** 同じ表の中で表記の揺れ ("AS-03 ～ AS-04-5" と "AS-03～AS-04-5") を同じ行にまとめるためのキー */
export const floorRowKey = (s: string) => norm(s);
