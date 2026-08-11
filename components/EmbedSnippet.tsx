"use client";

// 作品ページの「ブログに貼る」欄。配信先ウィジェットの貼り付けコードを見せてコピーさせる。
//
// 置き場所の意図: アニメ感想ブログを書く人は、その作品の記事を書いている最中に
// 「この作品はどこで見れるか」を調べに来る（2026-07-26のSearch Console実測でこのページに
// 来るクエリは「作品名 配信」系が大半）。つまり“貼りたくなる瞬間”はまさにこのページ上にある。
// 別途ジェネレーターのページに誘導するより、その場でコピーできる方が使われる。
//
// 検索意図（＝配信先の答え）を押し下げないよう <details> で閉じておく。
// スニペットの中身の組み立ては lib/embed.ts（サーバー側で生成して文字列で受け取る）。
import { useState } from "react";
import { logEvent } from "@/lib/logEvent";

interface Props {
  title: string;
  // 静的HTML（貼った時点の情報で固定）
  snippet: string;
  // iframe（配信先が変わったら自動で追従）
  iframeSnippet: string;
}

type Kind = "html" | "iframe";

export default function EmbedSnippet({ title, snippet, iframeSnippet }: Props) {
  const [kind, setKind] = useState<Kind>("html");
  const [copied, setCopied] = useState(false);

  const code = kind === "html" ? snippet : iframeSnippet;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard APIが使えない環境（非HTTPS等）ではテキストエリアの手動選択に任せる。
      return;
    }
    setCopied(true);
    logEvent("embed_copy", { kind });
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <details className="embed-share">
      <summary>ブログ・サイトに「{title}」の配信先を貼る（無料・HTMLをコピー）</summary>
      <div className="embed-share-body">
        <div className="embed-share-tabs" role="group" aria-label="貼り付けコードの形式">
          <button
            type="button"
            className={kind === "html" ? "is-on" : ""}
            onClick={() => setKind("html")}
          >
            HTML（軽い）
          </button>
          <button
            type="button"
            className={kind === "iframe" ? "is-on" : ""}
            onClick={() => setKind("iframe")}
          >
            iframe（自動更新）
          </button>
        </div>
        <p className="embed-share-note">
          {kind === "html"
            ? "貼った時点の配信先で固定されます。外部のCSS・JavaScriptを読み込まないので、貼り先の表示速度に影響しません。"
            : "配信先が変わると自動で最新に更新されます。iframeが使えるブログ（WordPress・はてなブログ等）向け。"}
        </p>
        <textarea className="embed-share-code" readOnly rows={kind === "html" ? 8 : 3} value={code} />
        <div className="embed-share-actions">
          <button type="button" className="embed-share-copy" onClick={copy}>
            {copied ? "コピーしました" : "コピー"}
          </button>
          <a href="/developers">使い方・利用条件</a>
        </div>
      </div>
    </details>
  );
}
