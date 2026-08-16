# ChatGPT App Directory 提出可否調査（2026-08-13）

`docs/ai-era-strategy-2026-08-13.md` 2-7節・5章「今週の一手」#3の実行結果。
「アニメ視聴ガイド」を ChatGPT App Directory（Apps SDK 経由のプラグイン提出）に
**いま**提出できるかを、OpenAI公式文書を中心に調べた。**読み取り専用の調査で、コード変更は伴わない。**

## 背景（却下済み施策との違い）

`docs/growth-channels-2026-08-11.md` は「MCP化＋（Smithery / mcp.so 等の第三者）レジストリ登録」
を却下している（理由: レジストリの利用者数の出典が実在しなかった）。
ChatGPT App Directory は**別物**として `docs/ai-era-strategy-2026-08-13.md` 2-7節が再提案を許容した
（①OpenAI公式の一次発表がある ②対象が週間8億WAUと公表されている ③受付開始という新事実がある）。
本書はその実行可否を具体的に調べた結果であり、**却下済み施策の復活ではない**。

---

## 結論を先に（1枚）

| 項目 | 判定 | 根拠 |
|---|---|---|
| いま提出できるか | **できない** | MCPサーバーが存在せず、提出フロー自体に入れない（1章） |
| 最大の障壁 | MCPサーバー未実装（技術的前提の欠如） | 1章 |
| 次点の障壁 | 収益化モデルの緊張関係（配信バッジ＝提携リンク直行が商取引規定と衝突しうる） | 4章 |
| 作れば通るか | **判定不能** | 「非公式コネクタ」規定・Annict再配布可否が公式文書だけでは分からない（2章・4章） |
| 追加費用 | 0円（未着手のため） | — |
| 日本語アプリ固有の制約 | 明記された制約は見つからず（＝無い確証ではない） | 5章 |

**このドキュメントの位置づけ**: 「出せる／出せない」の判定と、出せる状態にするための不足点の棚卸し。
着手するかどうかの判断・費用の発生する作業（開発者本人確認、Annictへの問い合わせ等）は**利用者判断**。

---

## 1. 提出の前提条件

| 要件 | 内容 | 本サイトの現状 |
|---|---|---|
| MCPサーバー | Apps SDK は Model Context Protocol (MCP) の拡張。プラグインは「MCP server and optional UI」で構成される | **無い**。`grep -i mcp` はドキュメント言及のみで、コード実装はゼロ（本書作成時点で再確認済み） |
| ホスティング | 本番は「安定した公開可能なHTTPSエンドポイント」必須。一般に `/mcp` で終わるURL。Secure MCP Tunnel単独・一時トンネル・ローカルエンドポイントは不可 | 該当エンドポイント無し |
| トランスポート | MCPストリーミング型HTTP（streamable HTTP）対応が絶対条件 | 未実装 |
| 認証 | 「プライベートデータの読み取り／ユーザー代理アクション」時に必須 | 本サイトは読み取り専用の公開データのみのため、必須要件に当たらない可能性が高い（推測: 一次情報の条件文からの解釈。確証ではない） |
| ドメイン確認 | 提出ポータルで検証トークンを取得し `https://<ホスト名>/.well-known/openai-apps-challenge` で公開する | `public/.well-known/` は存在せず未整備。二次情報（OpenAI Developer Communityのスレッド）によれば、サブパスでホストしたMCPサーバーだと確認リクエストがルートドメインに飛ぶ不具合の報告あり（**二次情報のみ・原典未確認**） |

出典（一次・本文確認済み）:
[App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) ／
[Build an MCP server](https://developers.openai.com/plugins/build/mcp-server) ／
[Submit plugins](https://developers.openai.com/plugins/deploy/submission)

---

## 2. 審査基準・ガイドライン

出典（一次・本文確認済み）: [App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)

| 観点 | 内容 | 本サイトへの影響 |
|---|---|---|
| 目的・独自性 | 「明確な目的を果たし、約束したことを確実に実行する」「ネイティブ機能でサポートされていない機能を提供する」 | 該当しうる（配信先の横断検索はChatGPTのネイティブ機能に無い） |
| 禁止カテゴリ（商品） | 成人向け・ギャンブル・違法薬物・処方薬・偽造品・マルウェア・タバコ・銃器等 | 該当しない |
| 禁止される詐欺的サービス | 偽造身分証・信用スコア操作・投機的暗号資産/NFT | 該当しない |
| **サードパーティ統合** | 「外部サイトのスクレイピング・クエリリレー・サードパーティAPI統合を、適切な許可と規約遵守なしに行わない」「**サードパーティサービスへの非公式コネクタとして主に機能するプラグイン**（パススルー的な中間ソフトウェアレイヤー含む）は承認できない」 | **判定不能（重要）**。本サイトの中核はAnnict GraphQL APIのデータを正規化・提示するもの。付加価値（配信サービス名の正規化・複数ソース統合・独自UI）を主張できる余地はあるが、審査側判断次第。加えて**Annict自体の利用規約が「第三者AI/チャットアプリでの再配布・提示」を許容しているかは未調査**（`docs/annict-contribution.md` の相談が前提。今回はOpenAI公式文書を優先し対象外とした） |
| 開発者認証 | 「検証済みの個人または組織から」。個人開発者でも可 | 未実施（本タスク範囲外・利用者本人のみ判断可） |
| プライバシーポリシー | 「収集する個人データの区分・使用目的・受取人の区分・データ保持期間・ユーザーへの制御」を説明した公開済みポリシーが必須 | 既存 `app/privacy/page.tsx` を確認したところ、データ収集の種類（Vercel Web Analytics・ログイン時の情報等）や広告掲載方針の説明はあるが、**「データ保持期間」の明記は見当たらない**。「受取人の区分」はASP・Vercel・Googleが個別に言及されている程度で、区分としての整理はされていない。Apps SDK提出前に追記が要る |
| 一般ユーザー向け適切性 | 「13〜17歳を含む一般ユーザーに適していること」との言及 | 検索要約段階の情報（一次情報の要約経由、**本文未再確認**）。該当しない要素は無いと見られるが未確認のまま |
| 典型的な却下理由 | トライアル/デモ版の拒否・ツール動作の説明不備・アクションラベル誤り/欠落・追加ログイン手順の要求 | 現状は該当項目を作っていないので判定材料無し |

---

## 3. 提出フロー

出典（一次・本文確認済み）: [Submit plugins](https://developers.openai.com/plugins/deploy/submission)

- 提出には「Apps Management」の書き込み権限＋身元確認済みの発行者IDが必要。
- 準備物: プラグイン名・説明・ロゴ・カテゴリ・ウェブサイトURL、MCPサーバー情報（公開URL・ドメイン確認・
  認証詳細・デモ認証情報）、スタータープロンプト5〜10個、テストケース（ポジティブ5件・ネガティブ3件）、
  対応国・地域の選択。
- フロー: ポータルから提出 → OpenAIの審査（期間は公式に明記なし） → 承認後、開発者が公開時期を選択 →
  公開と同時に全ユーザーに利用可能。
- **審査期間**: 公式文書に日数の記載なし。二次情報（OpenAI Developer Communityの複数スレッド）では
  数週間〜3ヶ月超とばらつく報告が多数あり、**二次情報のみ・原典未確認。目安として当てにできない**。

---

## 4. 収益化の可否（最重要の設計論点）

出典（一次・本文確認済み）: [App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)

> 現在、プラグインは**物理的商品のみ**で商取引を行える。サブスクリプション、デジタルコンテンツ、
> トークン、クレジットなどデジタル製品・サービスの販売は、直接的または間接的（例: フリーミアム
> アップセル）を問わず許可されていない。

許可されること: 現行プランで使えない機能の説明、利用可能プラン情報ページへのリンク。
**禁止されること**: 「チェックアウトまたは他の取引ページへの直接リンク」「アップグレード・サブスクリプション・
購入処理を明示的に開始するページへのリンク」。広告についても「プラグインは広告を配信してはならず、
主として広告媒体として存在してはならない」との規定あり。

### 本サイトへの影響（重大）

`CLAUDE.md` に明記の通り、本サイトの配信バッジは**必ずそのサービス自身**（提携リンク→無ければ公式サイト）
へ直接遷移する設計で、収益源はアフィリエイト経由の申込み誘導。これは上記「アップグレード・サブスク・
購入処理を明示的に開始するページへのリンク禁止」規定と抵触する可能性が高い。

**この論点は実装の追加では解決しない。** Apps SDK版を作るなら、バッジの遷移先を「作品ページ／サービス
概要ページ」等の非取引的な情報ページに作り替える必要が生じうる。かつ CLAUDE.md の基本ルール
「配信バッジの遷移先」（重大度高・事故扱い）は Web版サイトの設計として確定済みのため、
Apps SDK版で異なる遷移ルールを持たせるなら**Web版とは別立ての方針**として扱う必要がある
（Web版のルールを緩めることは無い）。

---

## 5. 日本語アプリ／日本からの提出に関する制約

- **明記された制約は見つからなかった**。`app-submission-guidelines` ページ本文を確認したが、
  language / locale / country / region に関する明示的な記述は無い（一次情報での確認結果）。
- 提出フローには「対応国・地域を選択する」項目があり（[Submit plugins](https://developers.openai.com/plugins/deploy/submission)、一次・本文確認済み）、
  日本を対象国として指定すること自体は可能と読める。
- ChatGPTが日本を含む100以上の国・地域・59言語に対応しているとの情報（[ChatGPT Supported Countries](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)、**本文403のため未確認・検索要約経由**）。
- Apps SDKのリファレンスに `_meta["openai/locale"]` / `_meta["openai/userLocation"]` 等の
  ロケール対応フィールドが存在（[Reference – Apps SDK](https://developers.openai.com/apps-sdk/reference)、**検索要約経由で本文未再確認**）。

**この項目は「見つからなかった」＝制約が無いことの確証ではない**、というだけに留める。

---

## 6. 足りないもの（実装コスト付き・すべて推定）

出せる状態にするために必要な作業。コストは既存の類似実装（Discordスラッシュコマンド等）からの
**推定**であり実測ではない。

| # | 不足点 | 実装コスト（推定） | 備考 |
|---|---|---|---|
| 1 | MCPサーバー本体（streamable HTTP対応・`/mcp`で終わる安定公開URL） | **大**（新規サーバー構築。既存REST API群とは別に用意が要る） | 認証は読み取り専用公開データのみのため恐らく不要（1章）だが確証はない |
| 2 | ドメイン確認用 `/.well-known/openai-apps-challenge` | 小（静的ファイル1つ） | 検証トークンは提出ポータルからしか取得できないため、着手順は#1のあと |
| 3 | プライバシーポリシーへの「データ保持期間」「受取人の区分」の明記 | 小 | `app/privacy/page.tsx` の追記のみ。実際に行っているデータ保持・提供先の実態を先に確認する必要あり（CLAUDE.mdの「実際に行っていることだけを書く」方針に従う） |
| 4 | スタータープロンプト5〜10個・テストケース（ポジ5／ネガ3）・対応国選択の文章準備 | 小（文章作成） | MCPサーバーが動く状態になってから着手が現実的 |
| 5 | OpenAI Platform Dashboardでの発行者本人確認 | 見積り不能 | **利用者本人のみ実施可**。本人確認プロセスのため所要時間は制御できない |
| 6 | Annict利用規約側の確認（第三者AI/チャットアプリでの再配布可否） | 小（問い合わせ自体は） | 返答待ち期間は制御不能。`docs/annict-contribution.md` の相談フローが前提 |

### 実装では解決しない論点（判断が必要）

- **収益化モデルの再設計**（4章）: バッジ遷移先を情報ページに作り替えるかどうかは、
  Web版の「配信バッジの遷移先」ルール（CLAUDE.md・重大度高）とは別立ての方針判断であり、
  コスト見積りの対象ではなく**意思決定**が先。
- **「非公式コネクタ」規定への該当可否**（2章）: 公式文書だけでは判定できない。審査に出して
  初めて分かる可能性が高く、事前に潰せるリスクではない。

---

## 7. 出典一覧

### 一次・本文確認済み

- [App submission guidelines – Apps SDK](https://developers.openai.com/apps-sdk/app-submission-guidelines)
- [Build an MCP server – Plugins](https://developers.openai.com/plugins/build/mcp-server)
- [Submit plugins – Plugins](https://developers.openai.com/plugins/deploy/submission)

### 一次だが本文未確認（403等・検索要約経由）

- [Reference – Apps SDK](https://developers.openai.com/apps-sdk/reference)
- [UX principles – Apps SDK](https://developers.openai.com/apps-sdk/concepts/ux-principles)
- [Developers can now submit apps to ChatGPT](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/)（OpenAI公式ブログ）
- [Introducing apps in ChatGPT and the new Apps SDK](https://openai.com/index/introducing-apps-in-chatgpt/)（OpenAI公式ブログ）
- [Build with the Apps SDK – Help Center](https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk)
- [ChatGPT Supported Countries – Help Center](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)

### 二次情報（原典未確認）

- OpenAI Developer Community の各スレッド（審査期間・却下事例の実例、ドメイン確認のサブパス不具合報告）
  例: [ChatGPT app submissions: domain verification step does not support subpath-hosted MCP servers](https://community.openai.com/t/chatgpt-app-submissions-domain-verification-step-does-not-support-subpath-hosted-mcp-servers/1379021)

### 本書内で「確認済み」とした本サイト側の事実

- MCP実装の有無: `grep -ril mcp` をコード拡張子（`.ts`/`.tsx`/`.js`/`.md`/`.json`）で実行し、
  ドキュメント言及とpermission設定のみでコード実装ゼロと再確認（本書作成時点）。
- `/.well-known/` ディレクトリ: `public/.well-known/` は存在しない（本書作成時点で確認）。
- 既存の公開API・ウィジェット: `app/api/*`（`discord` / `notify` / `search-index` / `season` /
  `service-additions` / `services` / `sns-image` / `track` / `watched` / `work`）はいずれもREST/Route
  Handlerで、MCPエンドポイントではない。
- プライバシーポリシーの記載内容: `app/privacy/page.tsx` を本文確認。データ保持期間の明記なし。

---

## 未確定のまま残っている点（次に確かめること）

- OpenAI Developer Communityの審査期間・却下事例の**原典**（本書はいずれも二次情報経由）
- ChatGPT App Directoryの**日本語アプリの審査実績**と、掲載後の流入実績（公開情報が見つかっていない）
- Annictの利用規約における**サービス外への再配布可否**（`docs/annict-contribution.md` の相談が未実行）
- 「非公式コネクタ」規定に本サイトが該当するかどうかの、審査側の実際の判断
