# 引き継ぎメモ（2026-07-09時点）

新規セッション開始時に読む前提。プロジェクト概要は`CLAUDE.md`参照。

## ⚠️ 最優先: push確認

```
git fetch origin && git status -sb
```
直近1コミット（`cf045b3` パフォーマンス改善）が未pushの可能性あり。pushはユーザーが手動で行う運用。

## 現在の到達点

- **あらすじ整備**: 106/109（実質完了）。残り3件は内容未公開1件・ユーザー判断で対象外2件
- **AIサムネ**: 110/110（完了）
- **配信チップの声優/検索/配信サービス絞り込み**: 折りたたみ式で実装済み
- **レンタル作品**: `content/works/rentalServices.ts`に人力で3件登録済み（LV999の村人/dアニメ、鉄鍋のジャン！/Prime、ブチ切れ令嬢/Prime）。配信チップから除外し作品ページの専用欄に表示
- **SNS自動投稿**: 毎日21:00 JST（曜日で内容出し分け）＋新シーズン初日は告知も追加。Bluesky/Mastodon自動、Xは下書きIssue
- **表示速度**: トップページSSR化＋Annictクエリ軽量化＋キャッシュ温め（8分おき、今年の4シーズン）。コールドでも7-8秒→2-4秒に短縮、キャッシュヒット時0.1-0.4秒
- **運営者情報ページ**（`/about`）・Bing Webmaster Tools登録・アクセシビリティ改善　すべて完了
- `docs/growth-ideas.md`の実装可能な項目はすべて完了

## 次回やること候補

1. push確認（上記）
2. レンタル作品の追加確認（`docs/operations.md`「⑧ レンタル作品の除外」手順）
3. あらすじ残り3件: ヒロアカ記念短編（内容公開後に追記）
4. AI引用の週次モニタリング・Wikidata登録はユーザー運用（Claude側の対応不要）
5. 新シーズン切替時: `season-updater`エージェントで配信情報チェック → `docs/operations.md`のサイクル早見表に従う

## 今セッションで踏んだ落とし穴（再発防止）

- **dev server起動中に`rm -rf .next && npm run build`すると`.next`キャッシュが破損する**
  （`Cannot find module`等のエラー）。ビルド前に必ず`preview_stop`してから。
- Annict GraphQLスキーマにレンタル/サブスク区別フィールドは無い（introspectionで確認済み）。
  レンタル判定はdアニメ検索API（`vodType: svod/tvod`）かWeb検索での個別確認が必要。
  Amazon直接アクセスはbot判定でブロックされる。
- サーバー/クライアントで年・シーズン解決ロジックがズレるとSSRの`initialData`と表示が
  食い違う。`lib/resolveSeasonParams.ts`に共通化済み、変更時は両方への影響に注意。

## コミット前の定番チェック
`npx tsc --noEmit` → `node scripts/check.ts`（37/37期待）→ `preview_stop` → `rm -rf .next && npm run build`
