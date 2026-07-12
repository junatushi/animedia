import { textOn } from "@/lib/services";
import type { ServiceTag } from "@/lib/types";

function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// 配信サービスを「アイコン＋略称」のコンパクトなチップで並べる。
// 略称だけだと1文字アイコンより分かりやすく、省スペースも両立できる。
// 正式名称（例: dアニメストア）は title 属性＋視覚的に隠したテキスト（.sr-only）で
// DOMに保持し、スクリーンリーダー・検索エンジン・生成AIにも伝わるようにする。
export default function ServiceMarks({
  services,
  otherServices,
  hasBroadcastData = false,
}: {
  services: ServiceTag[];
  otherServices: string[];
  // Annictに放送データ（TV含む）はあるが配信サービスが0件のときtrue。
  // 「Annictにデータ自体が無い」場合と表示を分けるために使う（省略時はfalse＝従来通り）。
  hasBroadcastData?: boolean;
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
  return (
    <div className="svc-marks">
      {services.map((s) => (
        <span key={s.key} className="svc-chip" title={s.name}>
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
        </span>
      ))}
      {otherServices.map((name) => (
        <span key={name} className="svc-chip svc-chip-other" title={name}>
          <span className="svc-chip-name">{name}</span>
        </span>
      ))}
    </div>
  );
}
