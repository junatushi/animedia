"use client";

import { textOn, getOfficialUrl } from "@/lib/services";
import { pickAffiliate } from "@/lib/affiliate";
import { logEvent } from "@/lib/logEvent";
import type { ServiceTag } from "@/lib/types";

function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// バッジのtitle属性。広告リンクか／人力補完かは同時に成り立つので、該当する注記を全て並べる。
function titleFor(name: string, isAd: boolean, isManual: boolean): string {
  const notes = [
    isAd ? "広告リンク" : null,
    isManual ? "Annict未登録・公式情報で手動確認" : null,
  ].filter(Boolean);
  return notes.length ? `${name}（${notes.join("・")}）` : name;
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
//
// ステマ規制（景表法）対応（2026-07-27にPRタグ廃止・開示文一本化に変更）:
// 以前はアフィリエイトのあるバッジに「PR」タグを個別表示していたが、現在はバッジにPR表示は
// 無く、title属性（「（広告リンク）」）と開示文（.svc-disclosure）で広告リンクである旨を示す。
// 開示文は本コンポーネント単体では作品ごとに出るが、hideDisclosure=trueの画面（一覧等）では
// 呼び出し側が画面につき1回だけ自前で.svc-disclosureを表示する責任を持つ（下記hideDisclosure参照）。
//
// 人力補完サービスの出典（2026-07-28変更）: 以前はバッジの中に「✓」の小さなアンカーを
// 並べ、それが出典記事（例: ニュースサイト）に飛んでいた。バッジ本体（配信サービスへの
// リンク）と14pxしか離れておらず記号だけで意味も伝わらないため、「Prime Videoのバッジを
// 押したのに無関係な記事に飛んだ」という誤タップを生んでいた。現在はバッジ内のアンカーを
// 廃止し、バッジ列の下に文章＋ラベル付きリンク（.svc-manual-note）で出典を示す。
export default function ServiceMarks({
  services,
  otherServices,
  hasBroadcastData = false,
  hideDisclosure = false,
  hideManualNote = false,
}: {
  services: ServiceTag[];
  otherServices: string[];
  // Annictに放送データ（TV含む）はあるが配信サービスが0件のときtrue。
  // 「Annictにデータ自体が無い」場合と表示を分けるために使う（省略時はfalse＝従来通り）。
  hasBroadcastData?: boolean;
  // シーズン一覧のカード等、同じServiceMarksが作品数ぶん繰り返される画面では、
  // 開示文（.svc-disclosure）を作品ごとに何度も出すと冗長になるため省略できる。
  // ただしステマ規制（景表法）対応上、開示文は画面のどこかに必ず必要なため、
  // hideDisclosureを使う呼び出し側（例: components/SeasonExplorer.tsx のカード一覧）は
  // 一覧全体につき1回、自前で.svc-disclosureを表示すること。
  hideDisclosure?: boolean;
  // 人力補完サービスの出典注記（.svc-manual-note）を出さない。カード一覧のように
  // 1画面に何十件もバッジが並ぶ場所では注記が繰り返されて邪魔になるため、そこだけ
  // 省く（点線のバッジ＋title属性で「手動確認」は伝わり、出典は作品ページに出る）。
  hideManualNote?: boolean;
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
  const manualServices = services.filter((s) => s.manualSourceUrl);

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
            </>
          );
          return (
            <span
              key={s.key}
              className={s.manualSourceUrl ? "svc-chip svc-chip-manual" : "svc-chip"}
              /* 手動確認と広告リンクは両立する（人力補完したサービスに提携リンクが
                 あるケース）。以前は手動確認を優先して「（広告リンク）」が消えていたため、
                 該当する注記を全て並べる（ステマ規制対応の表示を落とさない）。 */
              title={titleFor(s.name, !!program, !!s.manualSourceUrl)}
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
            </span>
          );
        })}
        {otherServices.map((name) => (
          <span key={name} className="svc-chip svc-chip-other" title={name}>
            <span className="svc-chip-name">{name}</span>
          </span>
        ))}
      </div>
      {/* Annictに無く人力補完したサービスの出典（一次情報）。CLAUDE.mdの一次情報明示方針。
          バッジの中ではなくバッジ列の下に、何のリンクか分かる文言を添えて置く（バッジ本体＝
          配信サービスへのリンクと押し間違えないため。2026-07-28変更）。 */}
      {manualServices.length > 0 && !hideManualNote && (
        <p className="svc-manual-note">
          点線のバッジはAnnictに未登録の配信情報を公式サイト・報道記事で確認して補完したものです（
          {manualServices.map((s, i) => (
            <span key={s.key}>
              {i > 0 && "・"}
              <a href={s.manualSourceUrl} target="_blank" rel="noopener noreferrer">
                {s.name}の出典記事 ↗
              </a>
            </span>
          ))}
          ）。
        </p>
      )}
      {/* ステマ規制（景表法）対応: バッジ自体にPR表示は無いため、アフィリエイトリンクが
          1件でもあれば開示文で広告である旨を明示する（消費者庁ステマ規制Q&A Q13:
          一般消費者に明瞭な表示が必要）。hideDisclosure=trueの呼び出し側（一覧画面など）は
          この開示文を出さない代わりに、呼び出し側が画面につき1回、自前で表示する責任を持つ。 */}
      {hasAnyAffiliate && !hideDisclosure && (
        <p className="svc-disclosure">
          配信サービスのボタンには広告リンク（アフィリエイト）が含まれます。
          リンク経由の登録等により、当サイトが報酬を受け取ることがあります。
        </p>
      )}
    </div>
  );
}
