# DNR装備DB

ドラゴンネストR(日本版)の最新装備について、作成ルート(素材・入手先)、ステータス、強化確率、ドロップ率を出典付きでまとめた静的サイト。

## 使い方

```sh
npm install
npm run dev        # ローカル確認 (http://localhost:5173)
npm run build      # validate → 型チェック → dist/ に静的ファイル出力
```

`dist/` はハッシュルーティング (`#/item/...`) なので、GitHub Pages / Cloudflare Pages / 任意の静的ホスティングに設定なしで置ける。

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
| `item_groups.json` | 強化・段階・増幅などの違いだけの同一装備のまとめ (メンバーは段階順) |

原則:
- アイテム・ダンジョンの id は日本語の正式名称そのもの。
- すべてのレコードは `refs` で出典を持つ。日本版で未公表の値だけ KR/CN の出典で補完し、画面では「海外版の値」と表示される。
- 数値は原文どおり。推測値は入れない。

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
   (`npm run merge` は `data/` を上書きするので、`data/` を手で直した後は使わないこと)
4. 段階違いのアイテムを追加したら `npm run gen:groups` で `item_groups.json` の追記漏れを確認。
5. `npm run validate` → `npm run build`。

スクレイピングは手動・低頻度で実行する (各スクリプトはリクエスト間に1秒待機)。
