# 配信先の自動補完（毎日の定期実行の手順）

**2026-10-04導入。** このファイルが手順の**正本**。定期実行（claude.ai のルーティン）の設定には
「このファイルを読んで従え」とだけ書く。手順を変えるときはこのファイルを直してPRを出す
（2箇所に写さない＝`docs/daily-ops.md` の冒頭と同じ理由）。

## なぜ要るか

独占配信や配信オリジナルはAnnictの番組表に載らないまま配信日を迎えることが多く、
サイトは「配信情報なし」と出し続ける。`scripts/coverage-gaps.js` が毎日、配信先0件の作品を
Issue（ラベル `coverage-gaps`）に出しているが、**誰かが調べて `content/works/extraServices.ts`
に足すまで直らない**。2026-10-02の導入から2日間、15件が手つかずのまま残った（Issue #201）。

## 役割の分け方（誤登録しないための設計）

| 役 | 誰が | やること | やらないこと |
|---|---|---|---|
| 調べる | 定期実行のClaude（この手順） | 一次情報を読み、抜き書きつきで `extraServices.ts` に足し、PRを出す | **マージしない**。曜日・時刻（`schedule`）を付けない。既存の行を消さない・書き換えない |
| 裏を取る | GitHub Actions（`.github/workflows/coverage-autofill.yml`） | 出典ページを**取り直して** `scripts/verify-extra-services.ts` で機械検証し、全部合格・CI緑なら1日1本までマージ | 調べた側の申告を信じない |
| 判断する | 人 | 自動で通らなかったPR（ラベル `coverage-autofill-review`）を見る | — |

機械検証が見るのは次のとおり（詳細は `scripts/lib/verify-extra-services.js` の冒頭）。
**1件でも外れればマージされない**ので、迷ったら足さない・人に回すほうに倒すこと。

1. 出典が https で、X・Wikipedia・AniList・個人ブログ・動画ページ・転載サイトではない
2. 抜き書き（`evidence`）が出典ページに**そのまま**ある
3. 抜き書きにそのサービスの名前が入っている
4. 出典ページに**作品名の全文**（Annictの題名）があり、抜き書きの近くにある
5. 作品が今期・次期の「配信先0件」の作品である
6. `schedule` が無い／既存の行の削除・書き換えが無い／`confirmedDate` が7日以内

4番が肝。2026-10-04の手作業の調査で、**公式サイトの配信欄が別の作品のものだった**例に2回当たった
（ルルットリリィの配信欄は第2クールのもので、Annict #18233＝第1クールの総集編には当てはまらない／
ゴールデンカムイの配信欄は「最終章」のもので「暴走列車編」の告知ではない）。
どちらもページにサービス名は書いてあるが、**その作品の名前（全文）はページに無い**。

## 手順

### 0. やることがあるか先に確かめる（無ければすぐ終える）

```
node scripts/coverage-gaps.js
```

- 何も出なければ終了（何もコミットしない・PRも出さない）。
- `claude/coverage-autofill-` で始まる**開いたPR**が既にあれば終了（積み増さない。人の判断待ち）。
  確認は GitHub の MCP ツールか `gh pr list --state open --search "head:claude/coverage-autofill-"`。

### 1. 作業ブランチ

```
git fetch origin main
git checkout -B claude/coverage-autofill-$(TZ=Asia/Tokyo date +%F) origin/main
```

### 2. 1作品ずつ調べる（多くても10作品まで）

出力の上から順に（始まっている → 30日以内 → 開始日不明）。

1. Annictの作品ページ（`https://annict.com/works/<ID>`）から公式サイトのURLを拾う。
2. 公式サイトの「ON AIR」「放送・配信」「NEWS」、配信サービス自身の発表、PR TIMES の公式発表、
   大手ニュース（コミックナタリー・アニメイトタイムズ・アニメ！アニメ！・MANTANWEB・アニメハック等）を読む。
3. **原文を取る**。`curl -sL <URL>` で取れればそれを使う。WebFetch を使うときは
   「該当箇所を一字一句そのまま抜き出して」と頼む（要約された文は抜き書きの照合に落ちる）。
4. 次のどれに当たるかを決める:
   - **配信サービスが書いてある**: その文を抜き書きにして `extraServices.ts` に足す（下の書式）。
     `SERVICES`（`lib/services.ts`）に無いサービス（TVer・NHK ONE・ネットもテレ東・J:COM STREAM 等）は足さない。
   - **配信が無い／SERVICES外だけ／まだ始まっていない／延期**: `scripts/lib/coverage-acknowledged.js` の
     `ACKNOWLEDGED` に足す。**理由に出典URLを入れ、`recheckOn` は62日以内**（期日が来ると自動でIssueに戻る）。
   - **分からない**: 何もしない（Issueに残る。推測で埋めない）。

**よくある取り違え（必ず確かめる）**
- 総集編・特番・2期・劇場版など、**同じ公式サイトの別の作品**の配信欄ではないか。
  ページに Annict の題名の**全文**があるかを見る（無ければその出典は使えない）。
- 「配信予定」「順次配信」とだけあってサービス名が無い → 足さない。
- まとめサイト・X・Wikipedia・AniList・JustWatch・Yahoo!ニュース（転載）は出典にしない。

### 3. 書式

```ts
  // 作品名: 何を確認したか（1行）。
  12345: [
    {
      key: "d_anime",
      sourceUrl: "https://example.jp/onair/",
      confirmedDate: "2026-10-05",   // 今日（JST）
      evidence: "ページの文をそのまま（8〜400文字・サービス名を含む）",
    },
  ],
```

複数サービスは、同じ抜き書きを使って `(["d_anime", "prime"] as const).map((key) => ({ ... }))`
の形でよい（既存の 17352 を参照）。**`schedule` は付けない**（曜日・時刻は人が確かめてから足す）。

### 4. 自分でも検証してからPRを出す

```
node scripts/verify-extra-services.ts --base origin/main
node scripts/check-coverage-gaps.js
node scripts/check-verify-extra-services.js
```

- 1本目が**不合格の行は消す**（直せない行を残したままPRを出さない）。全部消えたらPRを出さずに終える。
- 外向き通信が遮断されていて1本目が「取得できなかった」になる日は、そのままPRを出してよい
  （GitHub Actions 側で取り直す）。

### 5. コミット・PR

- 触ってよいのは `content/works/extraServices.ts` と `scripts/lib/coverage-acknowledged.js` **だけ**
  （他のファイルが混ざったPRは自動ではマージされない）。
- コミットは日本語1行（例: `配信先の自動補完（2026-10-05）: タヌキとキツネ ほか2作品`）。
- `git push -u origin <ブランチ>` → PRを作る（GitHub の MCP ツール、無ければ `gh pr create`）。
  本文に、足した作品・サービス・出典URLと、足さなかった作品とその理由を書く。
- **自分でマージしない。** マージは `coverage-autofill.yml` が検証してから行う。

## Vercelの無料枠

- mainへのマージ＝本番デプロイ＝ISRキャッシュの全消去。自動マージは**JSTの1日1本まで**
  （2本目は人に回る）。PRは1日1本にまとめること。
- `coverage-acknowledged.js` だけのPRはデプロイを起こさない（`vercel.json` の `ignoreCommand` が `scripts/` を除外）。
- 足した配信先は、次のデプロイで一覧・作品ページに出る。Issueから消えるのは、その翌日の
  `track-season.yml` が本番の `/api/season` を記録したとき。
