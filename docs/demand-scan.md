# 配信の需要シグナル収集（demand-scan）

SNS・コミュニティ・掲示板・Q&A から「アニメ配信の需要シグナル」を直近1週間ぶん拾って一覧化する仕組み。
2つの需要を集める:

- **(A) 作品の配信先の困りごと** … 「この作品どこで見れる？」「配信されてない」系。サイト本来の課題と直結。
- **(B) 配信サービスへの需要** … 「どのサブスクがいい？」「dアニメ入るべき？解約したい」系。

## 設計方針（なぜこの形か）

- **収集は検索エンジン経由（WebSearch）のみ。各サイトへ直接スクレイピングしない。** 低負荷・ToS安全で、
  既存の `outreach-scout` エージェントと同じ思想（`docs/sns-growth-research.md`）。X APIは従量課金のため使わない。
- **収集（Claude/WebSearch）と集計（node CLI）を分離。** WebSearchはClaude側のツールでnodeから呼べないため、
  Claudeが検索して生ヒットを保存 → CLIが決定論的に集計、の2段運用にした。集計は再現可能でテストしやすい。
- **推測でデータを埋めない**（CLAUDE.md準拠）。日付が取れないヒットは「日付不明」として残し、勝手に日付を作らない。

## 使い方（2段運用）

### ステップ1: 収集（Claude に依頼）

Claude に「配信の需要シグナルを集めて」と頼む。Claude は次を行う:

1. `node scripts/demand-scan.js --print-queries` で正準クエリ集を確認（クエリ定義は `content/demand/queries.js`）。
2. 各クエリを WebSearch で実行（**直近1週間を目安**、1クエリ10件程度に抑える＝負荷配慮）。
3. 結果を `content/demand/raw/<YYYY-MM-DD>.jsonl` に1行1ヒットで保存する。1行の形:

```json
{"source":"chiebukuro","url":"https://...","title":"...","snippet":"本文抜粋","date":"2026-07-14","query":"使った検索クエリ"}
```

- `source`: `chiebukuro` / `x` / `5ch` / `reddit` / `matome` / `web` のいずれか（スコア重みに使う）。
- `date`: 分かる範囲でJST日付。**分からなければ `null`**（WebSearchの抜粋は日付を伴わないことが多い）。

### ステップ2: 集計（CLI）

```bash
node scripts/demand-scan.js                     # content/demand/raw の最新JSONLを集計
node scripts/demand-scan.js content/demand/raw/2026-07-15.jsonl   # ファイル指定
```

主なオプション:

| オプション | 意味 |
|---|---|
| `--days N` | 直近N日でフィルタ（既定7。**日付が分かるヒットのみ**古いと除外。`null`は残す） |
| `--top N` | 各ランキングの上位N件（既定20） |
| `--json PATH` | 集計JSONの保存先（既定 `content/demand/out/<今日>.json`） |
| `--titles PATH` | 作品タイトル辞書（JSON配列/改行区切り）。引用符無しでも作品名を拾える |
| `--now ISO` | 「現在時刻」を固定（再現・テスト用） |
| `--print-queries` | 収集用の正準クエリ集を表示 |

出力: 標準出力に Markdown 表（サービス需要 / 作品の配信先困りごと）＋ `content/demand/out/<日付>.json` に集計JSON。

## 集計ロジック（`scripts/lib/demand-analyze.js`）

- **重複排除**: URL単位。
- **期間フィルタ**: `date` が分かるものだけ `--days` で切る。`null` は「日付不明」で残す（件数を注記表示）。
- **需要タイプ分類**: キーワード群（`WHERE_TO_WATCH` / `SERVICE_DEMAND`）でヒットを判定。
- **抽出**: 配信サービス名は正準リスト `SERVICES`（口語のネトフリ/アマプラ等も網羅）で、作品名は「」『』等の
  引用符 or `--titles` 辞書で抽出。
- **スコア**: `出典重み(SOURCE_WEIGHT)` の合計。知恵袋(1.3)＞X/Reddit(1.0)＞5ch(0.9)＞web(0.8)＞まとめ(0.5)。
  まとめ記事は「需要」より供給側情報なので低め。
- **未分類**: 作品/サービスを特定できなかった需要ヒットは `unclassified` に残し手動レビューに回す。

## 既知の限界

- **検索エンジンは供給側のまとめ記事（SEO記事）を上位に返しがち。** 個別のX投稿・5chレスは拾いにくい。
  需要が濃いのは Yahoo!知恵袋のQ&A。より生の声が要るときは収集クエリに `site:` を足して調整する。
- **日付が取れないヒットが多い。** 「直近1週間」は収集時にWebSearch側で期間を意識して補う前提。
  集計側は日付が分かるものだけ厳密フィルタする（推測補完はしない）。
- サービス/作品の**追加**は `scripts/lib/demand-analyze.js` の `SERVICES` と、必要なら `--titles` 辞書で行う。

## 拡張の入口

- クエリを増やす → `content/demand/queries.js`。
- 配信サービスの表記ゆれを増やす → `demand-analyze.js` の `SERVICES` に1行追加。
- 作品名の取りこぼしを減らす → 今期タイトルを `--titles` で渡す（Annict由来のタイトル配列を書き出す等）。

---

# lead-finder（流入リード発掘）— 2026-07-16導入

`demand-scan` が「需要の集計（サービス/作品ランキング）」なのに対し、`lead-finder` は
**「アニメ視聴ガイドを今まさに必要としている“個人の投稿”を見つけ、相手の作品に合わせた返信下書きを添える」**
リード発掘ツール。接触（回答・リプ）は**手動**で行う材料づくり。

## なぜ作ったか（既存の週次Xキットとの関係）

週次X成長キット（`scripts/lib/build-growth-kit.js` / `docs/x-growth-playbook.md`）のリーチ枠は、
今は**検索クエリを配るだけ**で、実在する困りごと投稿を見つけて相手の作品に合わせて返す工程は手動。
`lead-finder` はその「探す・照合する・返信案を作る」を自動化するエンジン。まず知恵袋（ToSクリーン・
WebSearch到達可・回答がSEO資産化）で検証し、良ければ**X向けに転用**する（Xは到達量が桁違い。
自動投稿はしないが、リード＋返信案まで自動で用意できれば手動接触が一気に速くなる）。

## 使い方

収集（ステップ1）は `demand-scan` と同じ `content/demand/raw/<日付>.jsonl` を使う。リード用途では
各生ヒットに任意で `status`（`"open"|"closed"|null`）を足す。**開/閉（回答受付中か）は node からは
判定できない**ため、収集時に Claude が各スレを WebFetch で確認して記録する（推測で埋めない）。

```bash
node scripts/lead-finder.js                      # content/demand/raw の最新JSONLから
node scripts/lead-finder.js content/demand/raw/2026-07-16-leads.jsonl
```

| オプション | 意味 |
|---|---|
| `--days N` | 直近N日フィルタ（既定7。日付が分かるヒットのみ古いと除外） |
| `--open-only` | `status:"closed"` を除外（回答受付中だけに絞る） |
| `--site URL` | リンク先サイト（既定 本番。env `LEAD_SITE_URL` でも指定可） |
| `--no-net` | `/api/search-index` を叩かない（作品→`/anime/{id}` 解決をしない） |
| `--out PATH` / `--json PATH` | 出力先（既定 `docs/leads-<日付>.md` / `content/demand/out/leads-<日付>.json`） |
| `--titles PATH` | 作品タイトル辞書（引用符無しでも作品名を拾う） |
| `--now ISO` | 「現在時刻」を固定（再現・テスト用） |

## 出力

- `docs/leads-<日付>.md` … 候補一覧テーブル＋**コピペ用の返信下書き**（接触チェックボックス付き）。
- `content/demand/out/leads-<日付>.json` … 構造化データ。

返信下書きの作品名は `/api/search-index`（直近3年分のタイトル×ID）で `/anime/{id}` に解決する。
「幼女戦記2期」→「幼女戦記Ⅱ」のような季節マーカーの表記差はベースタイトルで吸収するが、
**広範な質問（例:「コナン全話」「ポケモン全シリーズ」）は個別ページに誤誘導せず、安全にトップページへ
フォールバック**する。断定表現（「配信中です」）は使わず、ページに誘導する（放送開始前ルールと同じ思想）。

## 効果測定（推測で終わらせないための実測）

リンクには `?ref=<媒体>`（chiebukuro / x / reddit）を自動付与する。これを消さずに貼ると、
Vercel Analytics の参照元で「どの媒体から実際に来たか」が数字で見える。2〜3週回して
効果が確認できたら、週次Xキットのリーチ枠を「クエリ配布」から「この返信案付きリード」へ差し替える。

## 既知の限界

- **知恵袋の直接流入は小さい**（外部リンクはnofollow・リンクは1回答1本まで・CTR低め）。本命は
  同じエンジンをXへ転用したときの到達量と、どの作品で人が迷うかが分かる**コンテンツ知能**。
- WebSearchは古い解決済みスレを上位に返しがち。**新鮮・回答受付中**のものは `status` で絞る。
- 直近1週間フィルタは日付が取れるヒットにしか効かない（`demand-scan` と同じ制約）。
