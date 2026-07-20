"use client";

import { textOn, getOfficialUrl } from "@/lib/services";
import { pickAffiliate } from "@/lib/affiliate";
import { logEvent } from "@/lib/logEvent";
import type { ServiceTag } from "@/lib/types";

function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// 配信サービスを「アイコン＋略称」のコンパクトなチップで並べる。
// 略称だけだと1文字アイコンより分かりやすく、省スペースも両立できる。
// 正式名称（例: dアニメストア）は title 属性＋視覚的に隠したテキスト（.sr-only）で
// DOMに保持し、スクリーンリーダー・検索エンジン・生成AIにも伝わるようにする。
//
// バッジのリンク先（2026-07-18導入）: 提携済みアフィリエイトリンクがあればそれ
// （その時点で報酬額が最大のASP。lib/affiliate.ts）、無ければ各サービスの公式サイト
// （lib/services.ts の officialUrl）にリンクする。どちらもリンク先が無いケースは
// 起きない設計（SERVICESの全エントリがofficialUrl必須）だが、万一取得できない場合は
// リンクなしのバッジとして表示する（バッジ自体を非表示にはしない＝表示件数は減らさない）。
// アフィリエイトリンクの有無でバッジの表示・非表示は変えない。
export default function ServiceMarks({
  services,
  otherServices,
  hasBroadcastData = false,
  hideDisclosure = false,
}: {
  services: ServiceTag[];
  otherServices: string[];
  // Annictに放送データ（TV含む）はあるが配信サービスが0件のときtrue。
  // 「Annictにデータ自体が無い」場合と表示を分けるために使う（省略時はfalse＝従来通り）。
  hasBroadcastData?: boolean;
  // シーズン一覧のカード等、同じServiceMarksが作品数ぶん繰り返される画面では、
  // 開示文（.svc-disclosure）を作品ごとに何度も出すと冗長になるため省略できる。
  // 個々のバッジのPRタグ自体は省略しない（バッジ単体でも広告リンクと分かる状態を保つ）。
  hideDisclosure?: boolean;
}) {
  if (services.length === 0 && otherServices.length === 0) {
    return hasBroadcastData ? (
      <span className="no-haishin no-haishin-tv" title="TV放送の記録はありますが、配信サービスはAnnictにまだ登録されていません">
        TV放送のみ（配信情報は未登録の可能性）
      </span>
    ) : (
      <span className="no-haishin">配信情報なし</span>
    );
  }

  const links = services.map((s) => {
    const program = pickAffiliate(s.key);
    const href = program?.url ?? getOfficialUrl(s.key);
    return { service: s, program, href };
  });
  const hasAnyAffiliate = links.some((l) => l.program);

  return (
    <div className="svc-marks">
      <div className="svc-chips">
        {links.map(({ service: s, program, href }) => {
          const markAndName = (
            <>
              <span
                className="svc-chip-mark"
                style={{ background: s.color, color: textOn(s.color) }}
                aria-hidden="true"
              >
                {brandMark(s.short)}
              </span>
              <span className="svc-chip-name" aria-hidden="true">
                {s.short}
              </span>
              <span className="sr-only">{s.name}</span>
              {program && <span className="svc-chip-pr" aria-hidden="true">PR</span>}
            </>
          );
          return (
            <span
              key={s.key}
              className={s.manualSourceUrl ? "svc-chip svc-chip-manual" : "svc-chip"}
              title={
                s.manualSourceUrl
                  ? `${s.name}（Annict未登録・公式情報で手動確認）`
                  : program
                    ? `${s.name}（広告リンク・PR）`
                    : s.name
              }
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel={program ? "sponsored nofollow noopener noreferrer" : "noopener noreferrer"}
                  className="svc-chip-link"
                  onClick={() =>
                    logEvent(program ? "affiliate_click" : "official_link_click", {
                      service: s.key,
                      asp: program?.asp ?? null,
                    })
                  }
                >
                  {markAndName}
                </a>
              ) : (
                markAndName
              )}
              {/* Annictに無く人力補完したサービスは、出典（一次情報）へのリンクを添えて
                  「自動取得ではない」ことを利用者に伝える（CLAUDE.mdの一次情報明示方針）。
                  上のリンクとは別のアンカーなので、入れ子にならないよう兄弟要素にする。 */}
              {s.manualSourceUrl && (
                <a
                  href={s.manualSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="svc-chip-manual-mark"
                  aria-label={`${s.name}の配信情報の出典（手動確認）`}
                >
                  ✓
                </a>
              )}
            </span>
          );
        })}
        {otherServices.map((name) => (
          <span key={name} className="svc-chip svc-chip-other" title={name}>
            <span className="svc-chip-name">{name}</span>
          </span>
        ))}
      </div>
      {/* ステマ規制（景表法）対応: PRバッジが1件でもあれば、リンクの近くに
          広告である旨を明示する（消費者庁ステマ規制Q&A Q13: 一般消費者に明瞭な表示が必要）。 */}
      {hasAnyAffiliate && !hideDisclosure && (
        <p className="svc-disclosure">
          PR表示のあるボタンは広告リンクです。当サイトはアフィリエイトプログラムに参加しており、
          リンク経由の登録により報酬を受け取ることがあります。
        </p>
      )}
    </div>
  );
}
