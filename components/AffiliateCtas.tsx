"use client";

import { logEvent } from "@/lib/logEvent";

// アフィリエイトCTA（「このサービスで見る」ボタン列）。
// ・リンク先はサーバー側で lib/affiliate.ts が選んだ「その時点で報酬額が最大のASP」。
// ・ステマ規制（景表法）対応: リンクの直前に広告である旨を明瞭に表示し、
//   各ボタンにも「PR」ラベルを付ける（冒頭の一括表記だけでは不十分とされるため。
//   消費者庁ステマ規制Q&A Q13参照）。
// ・rel="sponsored nofollow" は広告リンクに対するGoogle推奨のマークアップ。
// ・items が空（未提携・全案件停止）のときは何も描画しない＝従来の見た目のまま。
export interface AffiliateCtaItem {
  serviceKey: string;
  serviceName: string;
  color: string;
  url: string;
  asp: string;
}

export default function AffiliateCtas({ items }: { items: AffiliateCtaItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="aff-block">
      <p className="aff-disclosure">
        以下は広告リンク（PR）です。当サイトはアフィリエイトプログラムに参加しており、
        リンク経由の登録により報酬を受け取ることがあります。
      </p>
      <div className="aff-ctas">
        {items.map((it) => (
          <a
            key={it.serviceKey}
            href={it.url}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="aff-cta"
            style={{ borderColor: it.color }}
            onClick={() => logEvent("affiliate_click", { service: it.serviceKey, asp: it.asp })}
          >
            <span className="aff-cta-pr" aria-hidden="true">
              PR
            </span>
            <span>{it.serviceName}で見る ↗</span>
            <span className="sr-only">（アフィリエイト広告リンク・新しいタブで開きます）</span>
          </a>
        ))}
      </div>
    </div>
  );
}
