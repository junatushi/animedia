// ───────────────────────────────────────────────────────────────
// Vercelの利用量（請求明細）を扱う純粋関数（2026-09-14導入）
//
// scripts/fetch-vercel-usage.js（取得）と scripts/usage-report.js（判定）が共有する。
// ネットワークにも fs にも触らないので、そのまま検査から呼べる
// （scripts/check-vercel-usage.js）。
//
// 【なぜ自前で叩くか】
// `vercel usage --breakdown daily --json` というCLIコマンドが存在する（実在を確認済み）。
// ただしCLIの実装を読むと、やっていることは
//     GET https://api.vercel.com/v1/billing/charges?from=<ISO>&to=<ISO>[&teamId=]
// をJSON Lines（1行1レコード）で受け取り、日付とサービス名で畳んでいるだけだった。
// そこでCLIは入れず、同じAPIを直接取って**CLIの --json とまったく同じ形**に畳む。
//   ・CIに296パッケージ（npx vercel）を入れずに済む＝実行が速く、供給網の面も小さい
//   ・**トークンを argv に載せない**（`--token` はプロセス一覧に出る）。ヘッダーで送る
//   ・生の明細から畳むので、CLIが捨てている情報（PricingUnit）も残せる
// 出力の形をCLIに合わせてあるので、人が手元で
//   npx vercel@59 usage --breakdown daily --from … --to … --json
// を叩けば**同じ形のJSONが出る**＝突き合わせができる（docs/vercel-usage-setup.md）。
//
// 【単位についての未確定事項・重要】
// CLIのヘルプは "Show billing usage (MIUs and costs)" と書いており、`PricingQuantity`が
// ダッシュボードのゲージと同じ単位（ISR Writesなら「回」、Fast Origin Transferなら「GB」）
// で返るかは**実データを見るまで確定できない**（この作業環境からは api.vercel.com が
// 403で届かない）。したがって判定は「観測した単位が予期した単位と一致したときだけ」行い、
// 一致しなければ**保留と明記する**。数字を静かに間違えるより、判定しないほうがよい
// （CLAUDE.mdの「落ちるのではなく数字を静かに間違える方向に壊れる」を避ける）。
// ───────────────────────────────────────────────────────────────

const LA_TIMEZONE = "America/Los_Angeles";

/** そのUTC時刻における指定タイムゾーンのオフセット（ミリ秒。local - utc）。 */
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.create(null);
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  // hour12:false は環境によって深夜0時を "24" と綴るので畳む。
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}

/**
 * "YYYY-MM-DD" を「ロサンゼルス時間のその日の0時」のUTC ISO文字列にする。
 *
 * Vercelの請求期間はLA時間で区切られる（CLIの --from/--to も
 * "interpreted as midnight LA time" と明記されている）。JSTで解釈すると
 * **1日ぶんズレた窓**を取ることになり、日次の判定が静かに狂う。
 * オフセットを2回当てるのは夏時間の切り替え日に1回では収束しないため。
 */
function laMidnightUtcIso(dateStr, { plusDays = 0 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`日付の形式が違います: ${JSON.stringify(dateStr)}（YYYY-MM-DD）`);
  }
  const naive =
    Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) +
    plusDays * 86400000;
  let ms = naive - tzOffsetMs(naive, LA_TIMEZONE);
  ms = naive - tzOffsetMs(ms, LA_TIMEZONE);
  return new Date(ms).toISOString();
}

/** JSTの「今日」。GitHub Actionsのランナーは常にUTCなので明示的に足す。 */
function jstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" に日数を足す（UTC基準の暦計算）。 */
function shiftDate(dateStr, days) {
  const ms =
    Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) +
    days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ── 明細の畳み込み ─────────────────────────────────────────────
//
// 1行1レコードのJSON Lines。CLIが読んでいるフィールドだけを使う:
//   ServiceName / PricingQuantity / PricingUnit / EffectiveCost / BilledCost
//   ChargePeriodStart / Tags.ProjectName / RegionName
// 未知のフィールドは無視する（増えても壊れない）。

const DEFAULT_PRICING_UNIT = "MIUs";

/** JSON Lines を1行ずつ配列にする。空行は捨て、壊れた行は行番号つきで落とす。 */
function parseJsonLines(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${i + 1}行目のJSONが壊れています: ${e.message}`);
    }
  }
  return out;
}

function addInto(map, key, charge, fallbackUnit) {
  const prev = map.get(key) || {
    pricingQuantity: 0,
    effectiveCost: 0,
    billedCost: 0,
    pricingUnit: charge.PricingUnit || fallbackUnit,
  };
  map.set(key, {
    pricingQuantity: prev.pricingQuantity + (charge.PricingQuantity || 0),
    effectiveCost: prev.effectiveCost + (charge.EffectiveCost || 0),
    billedCost: prev.billedCost + (charge.BilledCost || 0),
    pricingUnit: prev.pricingUnit,
  });
}

const toRows = (map) =>
  [...map.entries()]
    .sort((a, b) => b[1].billedCost - a[1].billedCost || a[0].localeCompare(b[0]))
    .map(([name, v]) => ({
      name,
      pricingQuantity: v.pricingQuantity,
      pricingUnit: v.pricingUnit,
      effectiveCost: v.effectiveCost,
      billedCost: v.billedCost,
    }));

/**
 * 明細レコードの配列を、CLIの `--breakdown daily --json` と同じ形に畳む。
 *
 * 日付の鍵は ChargePeriodStart の先頭10文字（CLIの getPeriodKey と同一）。
 * ここを日本時間に直したりしないこと。CLIと違う畳み方をすると、人が手元で
 * CLIを叩いたときに突き合わせられなくなる（この形にしてある唯一の理由）。
 */
function aggregateCharges(charges, { from, to, context = null } = {}) {
  const services = new Map();
  const periods = new Map();
  let pricingUnit = DEFAULT_PRICING_UNIT;
  let chargeCount = 0;

  for (const charge of charges) {
    chargeCount++;
    if (chargeCount === 1 && charge.PricingUnit) pricingUnit = charge.PricingUnit;
    const name = charge.ServiceName || "Unknown";
    addInto(services, name, charge, pricingUnit);

    const periodKey = charge.ChargePeriodStart
      ? String(charge.ChargePeriodStart).slice(0, 10)
      : "Unknown";
    if (!periods.has(periodKey)) periods.set(periodKey, new Map());
    addInto(periods.get(periodKey), name, charge, pricingUnit);
  }

  const totals = { pricingQuantity: 0, effectiveCost: 0, billedCost: 0 };
  for (const row of toRows(services)) {
    totals.pricingQuantity += row.pricingQuantity;
    totals.effectiveCost += row.effectiveCost;
    totals.billedCost += row.billedCost;
  }

  return {
    period: { from, to },
    context,
    pricingUnit,
    breakdown: {
      period: "daily",
      data: [...periods.keys()]
        .sort()
        .map((periodKey) => {
          const rows = toRows(periods.get(periodKey));
          const t = { pricingQuantity: 0, effectiveCost: 0, billedCost: 0 };
          for (const r of rows) {
            t.pricingQuantity += r.pricingQuantity;
            t.effectiveCost += r.effectiveCost;
            t.billedCost += r.billedCost;
          }
          return { periodKey, services: rows, totals: t };
        }),
    },
    services: toRows(services),
    totals,
    chargeCount,
  };
}

// ── 無料枠の予算表 ─────────────────────────────────────────────
//
// **上限は30日ぶんの合計。** 1日あたりの予算は「上限 ÷ 30」で導出する
// （ここで割っておかないと、ローリング30日の合計を毎日読むことになり、
//   対策前の分が窓に残っている間ずっと赤く見える＝判断できない）。
//
// `unit` は「ダッシュボードのゲージと同じ単位」。請求API（/v1/billing/charges）が
// 返す PricingUnit がこれと一致したときだけ上限と比較する。一致しなければ保留。
// `aliases` は請求APIの ServiceName。Vercelが名前を変えても**黙って消えない**よう、
// 未知の ServiceName は judge() が「未対応」として必ず出す。

const PERIOD_DAYS = 30;

const BUDGET = [
  {
    key: "isrWrites",
    label: "ISR Writes",
    limit: 200000,
    unit: "writes",
    aliases: ["ISR Writes", "Edge Config Writes / ISR Writes"],
    note: "回数ではなく8KB単位のバイト量で数える（docs/operations.md の㊻）",
  },
  {
    key: "isrReads",
    label: "ISR Reads",
    limit: 1000000,
    unit: "reads",
    aliases: ["ISR Reads"],
  },
  {
    key: "fluidActiveCpu",
    label: "Fluid Active CPU",
    limit: 4,
    unit: "hours",
    aliases: ["Fluid Active CPU", "Active CPU"],
    note: "実測で唯一の超過項目だった（㊶）。I/O待ちはここに出ない",
  },
  {
    key: "fluidProvisionedMemory",
    label: "Fluid Provisioned Memory",
    limit: 360,
    unit: "GB-hours",
    aliases: ["Fluid Provisioned Memory", "Provisioned Memory"],
    note: "I/O待ちでも止まらない＝middleware に外部への往復を置かない理由",
  },
  {
    key: "fastOriginTransfer",
    label: "Fast Origin Transfer",
    limit: 10,
    unit: "GB",
    aliases: ["Fast Origin Transfer"],
  },
  {
    key: "fastDataTransfer",
    label: "Fast Data Transfer",
    limit: 100,
    unit: "GB",
    aliases: ["Fast Data Transfer", "Data Transfer"],
  },
  {
    key: "functionInvocations",
    label: "Function Invocations",
    limit: 1000000,
    unit: "invocations",
    aliases: ["Function Invocations", "Serverless Function Invocations"],
  },
  {
    key: "edgeRequests",
    label: "Edge Requests",
    limit: 1000000,
    unit: "requests",
    aliases: ["Edge Requests"],
  },
  {
    // **期間の合計ではなく「残高」**。古いデプロイが保持期間を過ぎて消えるまで下がらないので、
    // 1日あたりに割ってはいけないし、30日の見込みも出してはいけない。
    // 予算の見張りは scripts/check-build-size.js（1デプロイの大きさ×10）が別に持つ。
    key: "deploymentStorage",
    label: "Deployment Storage",
    limit: 10,
    unit: "GB",
    kind: "balance",
    aliases: ["Deployment Storage", "Build Storage"],
    note: "残高なので日割りしない。直近10件のデプロイは保持期間に関わらず残る",
  },
];

const budgetByAlias = new Map();
for (const b of BUDGET) {
  for (const alias of b.aliases) budgetByAlias.set(normalizeServiceName(alias), b);
}

/** サービス名の表記ゆれ（大小・空白・記号）を吸収する。 */
function normalizeServiceName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function budgetFor(serviceName) {
  return budgetByAlias.get(normalizeServiceName(serviceName)) || null;
}

/** 1日あたりの予算（上限 ÷ 30）。残高型には存在しない。 */
function perDayBudget(b) {
  return b.kind === "balance" ? null : b.limit / PERIOD_DAYS;
}

/**
 * 取得済みスナップショットを判定する。
 *
 * @param snapshot fetch-vercel-usage.js が書き出したJSON
 * @param options.days 直近何日ぶんで1日あたりを出すか（既定7日）
 * @param options.today 基準日（YYYY-MM-DD。テストが固定するため）
 *
 * **返すのは判定結果だけで、表示はしない**（usage-report.js が整形する）。
 * 判定できない理由（データが無い・単位が違う・未対応のサービス名）は
 * 握りつぶさず `status` と `reason` に載せる。
 */
function judge(snapshot, { days = 7, today = null } = {}) {
  const daily = snapshot?.breakdown?.data ?? [];
  const known = daily.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.periodKey));

  // **当日は途中までしか集計されていない**ので、基準日そのものは平均に入れない
  // （GSCの「途中の週と完全な週を並べない」と同じ話。入れると必ず低く見える）。
  const cutoff = today || (known.length ? known[known.length - 1].periodKey : null);
  const complete = cutoff ? known.filter((d) => d.periodKey < cutoff) : known;
  const window = complete.slice(-days);

  const seen = new Map(); // budget key -> 合計
  const unknownServices = new Map(); // 予算表に無い ServiceName -> 合計
  const units = new Map();

  for (const day of window) {
    for (const svc of day.services || []) {
      const b = budgetFor(svc.name);
      if (!b) {
        unknownServices.set(svc.name, (unknownServices.get(svc.name) || 0) + svc.pricingQuantity);
        continue;
      }
      seen.set(b.key, (seen.get(b.key) || 0) + svc.pricingQuantity);
      if (svc.pricingUnit) units.set(b.key, svc.pricingUnit);
    }
  }

  const metrics = BUDGET.map((b) => {
    const total = seen.get(b.key);
    const observedUnit = units.get(b.key) ?? null;
    const perDay = perDayBudget(b);
    const base = {
      key: b.key,
      label: b.label,
      limit: b.limit,
      unit: b.unit,
      kind: b.kind ?? "period",
      note: b.note ?? null,
      observedUnit,
      days: window.length,
      total: total ?? null,
      perDay: total === undefined || window.length === 0 ? null : total / window.length,
      perDayBudget: perDay,
      projected: null,
      ratio: null,
    };
    if (total === undefined) {
      return { ...base, status: "missing", reason: "この期間の明細に現れない" };
    }
    if (b.kind === "balance") {
      // 残高は日割りも見込みも出せない（出すと必ず誤る）。
      return { ...base, perDay: null, status: "balance", reason: "残高なので日割りしない" };
    }
    if (window.length === 0) {
      return { ...base, status: "nodata", reason: "完全な日が1日も無い" };
    }
    if (observedUnit && normalizeServiceName(observedUnit) !== normalizeServiceName(b.unit)) {
      // 単位が食い違ったまま上限と比べると、桁ごと違う数字で合否を出すことになる。
      return {
        ...base,
        status: "unit-mismatch",
        reason: `単位が一致しない（予期 ${b.unit} / 観測 ${observedUnit}）＝上限との比較は保留`,
      };
    }
    const projected = (total / window.length) * PERIOD_DAYS;
    const ratio = projected / b.limit;
    return {
      ...base,
      projected,
      ratio,
      status: ratio > 1 ? "over" : ratio > 0.8 ? "warn" : "ok",
      reason: null,
    };
  });

  return {
    days: window.length,
    from: window[0]?.periodKey ?? null,
    to: window[window.length - 1]?.periodKey ?? null,
    chargeCount: snapshot?.chargeCount ?? 0,
    metrics,
    unknownServices: [...unknownServices.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total })),
    // 明細が1件も無いのは「利用ゼロ」ではなく「取れていない」。Hobbyプランで
    // 請求明細が返らない可能性を、利用ゼロと読み違えないための区別。
    empty: (snapshot?.chargeCount ?? 0) === 0,
  };
}

module.exports = {
  LA_TIMEZONE,
  PERIOD_DAYS,
  BUDGET,
  DEFAULT_PRICING_UNIT,
  tzOffsetMs,
  laMidnightUtcIso,
  jstToday,
  shiftDate,
  parseJsonLines,
  aggregateCharges,
  normalizeServiceName,
  budgetFor,
  perDayBudget,
  judge,
};
