"use client";

import { logEvent } from "@/lib/logEvent";

// カレンダー購読リンク（2026-08-07導入）。
//
// フッター（components/FollowLinks.tsx）が持つ「今期の全作品」の購読リンクに対して、
// こちらは `?service=` 付き＝「そのサービスで見られる作品だけ」の購読に使う。
// 調査（docs/growth-strategy-2026-08.md 穴3）では、購読の価値が跳ねるのは
// 「自分が入っているサービスの分だけ」を出せたときだと整理していたが、
// その形の導線はどこにも無かった。加入判断が起きるサービス別ページに置く。
//
// クライアントコンポーネントにしているのは押された数を測るためだけ。
// イベント名は app/api/track/route.ts の ALLOWED_EVENTS で許可制。
export default function CalendarSubscribeLink({
  serviceKey,
  label,
}: {
  serviceKey: string;
  label: string;
}) {
  return (
    <a
      href={`/calendar.ics?service=${encodeURIComponent(serviceKey)}`}
      onClick={() => logEvent("calendar_subscribe", { scope: serviceKey })}
    >
      {label}
    </a>
  );
}
