"use client";

import { logEvent } from "@/lib/logEvent";

// SNSアカウントのフォロー導線（2026-08-06導入）。
//
// 【なぜ必要だったか】このサイトはXアカウントを持ち、毎日手動で投稿しているのに、
// **サイト上でフォローを促す場所がどこにも無かった**。アカウントへのリンクは
//   ・`/about`（運営者情報。実測で人気ページに一度も入っていない低流入ページ）
//   ・`app/layout.tsx` の Organization JSON-LD の `sameAs`（機械可読で人間には見えない）
// の2箇所だけで、実際に人が着地する作品ページ・シーズンページ・トップには1つも無い。
//
// 2026-07-26の実測では30日で訪問者128人・556ページビュー（1人あたり4.3ページ・
// 直帰率41%）ある。**この人たちは一度もフォローを誘われていない**。
// 一方、X上で約70投稿してフォロワーは0だった。
// 「投稿を見た人にフォローしてもらう」より「すでにサイトを使っている人に
// フォローしてもらう」ほうが、母数も文脈も有利という判断（2026-08-06）。
//
// 【intent/follow を使う理由】プロフィールURL（x.com/animedia0705）へ送ると、
// 相手はプロフィールを開いてからフォローボタンを探すことになる。
// intent/follow はフォローの確認ダイアログが直接開くので1手少ない。
// Blueskyは同種のintentが無いのでプロフィールURLをそのまま使う。
//
// 【押しつけない】バナーやモーダルにはしない。フッターの注記の直前に1行置くだけ。
// 配信情報を調べに来た人の邪魔をしてまで獲るものではない。

const X_SCREEN_NAME = "animedia0705";

// クリックされたかを計測する。どのSNSが選ばれているか分からないと、
// 導線を増やすべきか・文言を変えるべきかの判断ができないため。
// イベント名は app/api/track/route.ts の ALLOWED_EVENTS で許可制。
const LINKS = [
  { key: "x", label: "X", href: `https://x.com/intent/follow?screen_name=${X_SCREEN_NAME}` },
  { key: "bluesky", label: "Bluesky", href: "https://bsky.app/profile/animedia0705.bsky.social" },
  { key: "mastodon", label: "Mastodon", href: "https://mastodon.social/@animedia" },
];

export default function FollowLinks() {
  return (
    <>
      <p className="follow-links">
        新作の配信情報を毎日お知らせしています。フォローはこちら:{" "}
        {LINKS.map((l, i) => (
          <span key={l.key}>
            {i > 0 && " ・ "}
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => logEvent("follow_click", { network: l.key })}
            >
              {l.label}
            </a>
          </span>
        ))}
      </p>
      {/* カレンダー購読（2026-08-07追加。app/calendar.ics）。
          SNSのフォローと違い、購読されたらこちらが何もしなくても毎週相手の
          カレンダーに出る。調査した長命な類似サービス（しょぼいカレンダー・Annict・
          AnimeSchedule・映画.com）が例外なく持っていた定着装置で、
          本サイトには導線が /developers にしか無かった
          （docs/growth-strategy-2026-08.md ／ docs/operations.md ⑱）。 */}
      <p className="follow-links">
        今期の放送スケジュールをカレンダーに取り込めます:{" "}
        <a
          href="/calendar.ics"
          onClick={() => logEvent("calendar_subscribe", { scope: "all" })}
        >
          カレンダーで購読する（.ics）
        </a>
      </p>
    </>
  );
}
