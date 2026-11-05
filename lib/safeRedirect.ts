// ログイン後の戻り先（`/auth/callback?next=...`）を、このサイトの中のパスだけに絞る
// （2026-11-05導入・重大度中）。
//
// 【なぜ要るか】以前は `NextResponse.redirect(`${origin}${next}`)` と文字列を連結していた。
// `next=@evil.example` なら `https://<このサイト>@evil.example`（ユーザー情報付きURL＝
// 行き先は evil.example）、`next=.evil.example` なら `https://<このサイト>.evil.example` になり、
// **ログイン直後の利用者を外部サイトへ送れた**（オープンリダイレクト。偽のログイン画面への誘導に使われる）。
//
// いまのサイトは `next` を一度も付けていない（components/AuthWidget.tsx は redirectTo に
// クエリを含めない）ので、通すのは「/ で始まる素直なパス」だけにして、それ以外は全部 "/" に倒す。
// 判定は URL を実際に組み立てて**行き先のオリジンが変わらないこと**まで確かめる
// （`/\evil.example` のようにブラウザが `//` と同じに読む形もここで落ちる）。
// 素の `.ts` なのは scripts/check.ts から挙動を検査するため。

/** `next` が同じオリジンの中のパスならそれを、そうでなければ "/" を返す。 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return "/";
  // 先頭は "/" 1文字だけ。"//" "/\" は別ホストへのURLとして解釈されうる。
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // 制御文字（改行・タブ等）はブラウザが取り除いて別の形に読むことがあるので通さない。
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  try {
    const base = new URL(origin);
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin) return "/";
    // `/.//evil.example`・`/a/..//evil.example` は解決すると pathname が `//evil.example` になり、
    // それを文字列で返すと受け取った側で「別ホストへのURL」に読まれる（2026-11-05・反証で修正）。
    if (resolved.pathname.startsWith("//") || resolved.pathname.startsWith("/\\")) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}
