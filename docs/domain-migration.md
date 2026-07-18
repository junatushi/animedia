# 独自ドメイン移行手順（Runbook）

2026-07-18作成。独自ドメイン取得後にこの手順で移行する。サイトURLは
`lib/siteUrl.ts` に一元化済みのため、**コード変更は原則この1行だけ**。

## 手順

1. **ドメイン取得**（ユーザー作業。年1,000〜2,000円程度）
   - 取得先は任意（Vercel Domains・お名前.com・Cloudflare Registrar等）。
2. **Vercelにドメインを追加**（ユーザー作業）
   - Vercel Project → Settings → Domains → 独自ドメインを追加し、DNS設定（案内に従う）。
   - 独自ドメインを**Primary**に設定すると、旧 `animedia-khaki.vercel.app` への
     アクセスは自動で新ドメインに301リダイレクトされる（リンク資産が引き継がれる）。
3. **コード変更**（Claude作業）
   - `lib/siteUrl.ts` の1行を新ドメインに変更 → デプロイ。
   - canonical・OGP・sitemap・robots・llms.txt・RSS・JSON-LD・通知メール内リンクは
     すべてここを参照しているため自動で追従する。
4. **GitHub Actionsの変更**（Claude作業）
   - `.github/workflows/warm-cache.yml` の `BASE` と `.github/workflows/notify-run.yml` の
     URLを新ドメインに変更（これらは `lib/siteUrl.ts` を参照できないため個別更新）。
5. **外部サービスの更新**（ユーザー作業）
   - **Google Search Console**: 新ドメインのプロパティを追加・所有権確認 →
     旧プロパティで「アドレス変更」を実行 → 新プロパティにsitemapを送信。
   - **Bing Webmaster Tools**: 同様にサイト追加。
   - **Supabase**: Authentication → URL Configuration の Site URL / Redirect URLs を
     新ドメインに変更（**忘れるとGoogleログインが壊れる**）。
   - **Google Cloud Console**: OAuth同意画面・認証情報のリダイレクトURIに新ドメインを追加。
   - **Resend**: 送信ドメインを独自ドメインに変更するとメール到達率も上がる（任意・推奨）。
   - X・Bluesky・MastodonのプロフィールURL、Wikidata登録を更新。
   - ASP登録サイトURL・各アフィリエイト提携のサイト情報を新ドメインに更新。
6. **確認**
   - 旧URL→新URLのリダイレクト、Googleログイン、通知メールのリンク、
     `/*sitemap.xml` `robots.txt` `llms.txt` の内容を目視確認。
   - `npm run build` と `node scripts/check.ts` が通ること。

## 注意

- 移行はトラフィックが小さい今のうちに行うほど傷が浅い（被リンク・インデックスの
  引き継ぎコストが小さい）。AdSense審査はサブドメイン（vercel.app）では申請できない
  ため、審査を受ける場合は独自ドメインが前提になる。
- 旧ドメインのリダイレクトはVercelプロジェクトが生きている限り維持される。
