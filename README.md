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

原則:
- アイテム・ダンジョンの id は日本語の正式名称そのもの。
- すべてのレコードは `refs` で出典を持つ。日本版で未公表の値だけ KR/CN の出典で補完し、画面では「海外版の値」と表示される。
- 数値は原文どおり。推測値は入れない。

## データ更新の流れ

1. 公式お知らせを取得してテキスト化
   ```sh
   npm run fetch:notices -- list "" 3        # お知らせ一覧 (番号とタイトル)
   npm run fetch:notices -- list 確率 3      # 検索語で絞り込み
   npm run fetch:notices -- 1466 1467        # 本文を ingest/raw/notice-<no>.txt に保存 (表はタブ区切り)
   npm run fetch:page -- vip-status "https://wikiwiki.jp/vipdranes/ステータス・装備" "#body"
   ```
2. `ingest/EXTRACTION_GUIDE.md` に従い `ingest/drafts/<名前>.json` を作成し、`npm run validate -- ingest/drafts/<名前>.json` で検証。
3. 統合: `npm run merge -- tmp-merged` で別ディレクトリに出して `data/` と差分比較し、必要な部分を `data/` に反映。
   (`npm run merge` は `data/` を上書きするので、`data/` を手で直した後は使わないこと)
4. `npm run validate` → `npm run build`。

スクレイピングは手動・低頻度で実行する (各スクリプトはリクエスト間に1秒待機)。
