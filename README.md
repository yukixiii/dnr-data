# DNR装備DB

ドラゴンネストR(日本版)の最新装備について、作成ルート(素材・入手先)、ステータス、強化確率、ドロップ率を出典付きでまとめた静的サイト。
値はゲームクライアント (日本版) のデータを正とし、クライアントに無い情報 (入手方法・ダンジョンのドロップ率・実装時期など) を公式お知らせ・wiki・海外版の情報で補っている。

## 使い方

```sh
npm install
npm run dev        # ローカル確認 (http://localhost:5173)
npm run build      # validate → 型チェック → dist/ に静的ファイル出力
```

`dist/` はハッシュルーティング (`#/item/...`) なので、GitHub Pages / Cloudflare Pages / 任意の静的ホスティングに設定なしで置ける。

公開: main に push すると `.github/workflows/pages.yml` が検証・ビルドして GitHub Pages (https://yukixiii.github.io/dnr-data/) にデプロイする。

## データ

`data/*.json` が本体 (型: `src/types.ts`, スキーマ: `data/schema/dnr.schema.json`)。

| ファイル | 内容 |
|---|---|
| `items.json` | 装備・アーティファクト・タリスマン・竜珠など |
| `materials.json` | 素材・通貨・箱 (items と同じ id 空間) |
| `recipes.json` | 製作・進化・交換レシピ (結果 / ベース装備 / 素材 / ゴールド / 成功率) |
| `enhance_tables.json` | 強化・製作段階・精製の確率表 |
| `drops.json` | ダンジョン報酬・採集・箱の中身 (数値の確率 or 「確定」「一定確率」等の定性表記) |
| `dungeons.json` | ダンジョン・ネスト・ステージ |
| `sources.json` | 出典 (URL・地域 JP/KR/CN・公開日・取得日) |
| `item_groups.json` | 強化・段階・増幅・等級・物理/魔法/混合などの違いだけの同一装備のまとめ (メンバーは段階順) |
| `sets.json` | セット効果 (必要数ごとの能力値・スキル)。アイテムの `set` から参照 |

原則:
- アイテム・ダンジョンの id は日本語の正式名称 (ゲーム内の名前) そのもの。同じ名前で別物のものは `名前(等級)`・`名前[Ⅱ]`・`名前(物理)`・`名前(火)` のように区別する。
  ゲーム内に共通の名前が無いもの (職業ごとに名前が違う武器の「◯◯メインウェポン」、告知の総称) はプロジェクトの id。
  改名した旧 id は `ingest/aliases.json` に残し、`#/item/<旧id>` は新しい id (分割したものはグループ) に転送する。
- 値はゲームクライアントの値を正とする (`jp-client-<日付>`)。告知などの値と違った場合は元の値を description / notes に「告知では …」として残す。
- クライアントに無い値だけ公式お知らせ・wiki で補い、それも無いものだけ KR/CN の出典で補完する (画面では「海外版の値」と表示)。
- 告知の数値は原文どおり。推測値は入れない。

### 段階違いの装備のまとめ (`item_groups.json`)

`[1段階]…[15段階]`、`(マジック/レア/エピック)`、`[増幅]`、`[真]`、`祝福された`、`[Ⅱ]` など、名前の印だけが違うアイテムは画面上で1つの装備として扱う (一覧は1件、詳細ページで段階を切り替え)。ブローチはキャラクターごとに 封印された力 → 次元/異界/信念 まで1系統にまとめる。
レシピ・ドロップ・強化表は各段階のアイテム id を指したままでよい。

- 規則は `ingest/groups-lib.ts`。装備系 kind (と段階付きの箱舟アイテム) だけが対象で、素材・消耗品はまとめない。
- `npm run gen:groups`: ファイルが無ければ規則どおりに生成。あれば上書きせず、未割り当ての候補と存在しないメンバーを表示する。新しい段階アイテムを追加したら実行し、表示に従って手で追記する。
- メンバーの `from` / `via` は、レシピは無いが原文の説明から前段が分かるものだけに付ける (作成ルートで「レシピ未登録」や総称レシピの手順として表示される)。
- `npm run merge` はこのファイルを書き換えない。

## データ更新の流れ

1. 公式お知らせを取得してテキスト化
   ```sh
   npm run fetch:notices -- list "" 3        # お知らせ一覧 (番号とタイトル)
   npm run fetch:notices -- list 確率 3      # 検索語で絞り込み
   npm run fetch:notices -- 1466 1467        # 本文を ingest/raw/notice-<no>.txt に保存 (表はタブ区切り)
   npm run fetch:page -- vip-status "https://wikiwiki.jp/vipdranes/ステータス・装備" "#body"
   ```
   中国版フォーラム dngamer.site (DN聚集地) はログインが必要なので、ログイン済みのブラウザで https://dngamer.site/ を開き、
   `ingest/dngamer-export.js` を DevTools のコンソールで実行して JSON をダウンロードしてから変換する。
   ```sh
   npm run import:dngamer -- ~/Downloads/dngamer-export-YYYYMMDD.json   # ingest/raw/dngamer-<スレッドid>.txt
   ```
   中国語名 → 日本版の id の対応は `ingest/names-zh.json` に置く (日本版にあるものだけ)。
2. `ingest/EXTRACTION_GUIDE.md` に従い `ingest/drafts/<名前>.json` を作成し、`npm run validate -- ingest/drafts/<名前>.json` で検証。
3. 統合: `npm run merge -- tmp-merged` で別ディレクトリに出して `data/` と差分比較し、必要な部分を `data/` に反映。
   (`npm run merge` は `data/` を上書きし、クライアントの値も消えるので、`data/` を直接作り直した場合は 5 を必ずやり直す)
4. 段階違いのアイテムを追加したら `npm run gen:groups` で `item_groups.json` の追記漏れを確認。
5. 日本版クライアントデータの反映 (下記)。
6. `npm run validate` → `npm run build`。

### 日本版クライアントデータ (`jp-client-<日付>`)

`ingest/client/export.json` はゲームクライアントの表から取り出した値。書き出すツールは別管理 (このリポジトリには含めない)。
`ingest/client/states.json` は能力値の種類番号 → 能力名の対応表。

反映の手順 (export.json が変わったら最後まで繰り返す):
1. 書き出しツールで export.json を作る。`renames` (改名・分割・統合) があれば `npm run rename:ids` で data/ の id を付け替える。
2. もう一度 export.json を作る (新しい id で書き出され、`renames` が空になる)。
3. `npm run apply:client` (`-- --dry` で表示だけ、`-- -v` で詳細)。素材のスタブを作った後に照合できるレシピがあるので、
   export.json の作り直しと apply:client を、変更が出なくなるまで (通常 2 回) 繰り返す。

`npm run rename:ids` (`ingest/rename-ids.ts`):
- 改名 (1 → 1)・統合 (複数 → 1)・分割 (1 → 複数)。等級・物理/魔法/混合・属性などの変種に分けたものは item_groups にまとめる。
- レシピは部位・ラベルが対応するものを組にし、決まらないものは分割先ごとに複製する (apply:client がクライアントで確認できない複製を整理)。

`npm run apply:client` (`ingest/apply-client.ts`) は**クライアントの値で上書きする**:
- アイテム: 等級・装備レベル・部位・最大強化・セット・能力値 (基本 + 強化 +1～+N + 細工段階)。取引・説明は既存の文が無い時だけ。
  クライアントで強化できない装備は最大強化と告知の +N 表を外して注記に残す。最新世代 (Lv99 以上) でまだ無い装備は追加する。
- 強化表: クライアントの強化 ID と段階の対応が取れた表は確率・ゴールド・素材をクライアントの値にし、能力値はアイテム側に移す。
  海外版だけの表は日本版の表に置き換え (日本版の表があれば削除)。強化表の無いアイテムには `client-enh-<強化ID>` を作る。
  段階の対応は既存の値との一致で決める (「[+0]」= +0 から強化する時、のように 1 つずれる表がある)。
- レシピ: 製作・交換 (ショップ)・進化の表と照合できたものは費用・成功率・個数をクライアントの値にする。
  クライアントにだけあるものは `client-shop-*` (交換) / `client-chg-*` (進化) / `client-cmp-*` (製作) として追加。
- 袋・箱の中身: `client-box-*` (確率は表示用確率か重みから計算。選択袋は「選択」)。ダンジョンのドロップ率はクライアントに無いので告知の値のまま。
- セット効果 (`sets.json`)、能力値の名前の表記ゆれの統一、参照の無くなった出典の削除。
- レコードには出典 `jp-client-<日付>` が付く。告知ではないので出典に `published_at` は付けない (並べ替えには取得日を使う)。

割合の能力値はゲーム内表示と同じく小数2桁 (`0.0801` → `8.01%`)。

スクレイピングは手動・低頻度で実行する (各スクリプトはリクエスト間に1秒待機)。
