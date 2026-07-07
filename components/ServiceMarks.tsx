import { textOn } from "@/lib/services";
import type { ServiceTag } from "@/lib/types";

function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// 配信サービスを「アイコンのみ」で並べる（省スペース）。ただしサービス名は
// title属性＋視覚的に隠したテキスト（.sr-only）としてDOMに保持するので、
// スクリーンリーダー・検索エンジン・生成AIには「dアニメストア」等の名称が読める。
export default function ServiceMarks({
  services,
  otherServices,
}: {
  services: ServiceTag[];
  otherServices: string[];
}) {
  if (services.length === 0 && otherServices.length === 0) {
    return <span className="no-haishin">配信情報なし</span>;
  }
  return (
    <div className="svc-marks">
      {services.map((s) => (
        <span
          key={s.key}
          className="svc-mark"
          style={{ background: s.color, color: textOn(s.color) }}
          title={s.name}
        >
          <span aria-hidden="true">{brandMark(s.short)}</span>
          <span className="sr-only">{s.name}</span>
        </span>
      ))}
      {otherServices.map((name) => (
        <span key={name} className="svc-mark svc-mark-other" title={name}>
          <span aria-hidden="true">＋</span>
          <span className="sr-only">{name}</span>
        </span>
      ))}
    </div>
  );
}
