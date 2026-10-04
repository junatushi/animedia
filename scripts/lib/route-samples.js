// 動的セグメントに入れる「実在する値」と、そこから作る代表URL（2026-09-09導入）。
//
// 【なぜ切り出したか】
// `scripts/patrol.js` が持っていた realValues()／realFor() を、
// `scripts/measure-production.js`（本番の表示速度を毎日測る）と共有するため。
// 同じ「実在する値をどう選ぶか」を2箇所に書くと、片方だけが新しいページ種別に
// 追随して、もう片方が**静かに対象から外れる**（㊳と同じ形）。
//
// 【外してはいけない点】
// ①**値もURLもハードコードしない**。実在する名前・IDはリポジトリ同梱の索引から取り、
//   対象URLは `scripts/lib/app-routes.js` の走査から導出する。
// ②**非ASCIIの名前を優先する**。2026-08-31の事故（㊱）は日本語名にだけ出たので、
//   ASCII名を選ぶと検査が素通りする。
// ③**埋められないセグメントは黙って飛ばさない**。呼び出し側へ `skipped` として返し、
//   利用者に見せる。新しいページ種別を足したとき、ここに登録するまで
//   「対象に入っていない」ことが画面に出続ける。
const fs = require("node:fs");
const path = require("node:path");
const { appRoutes } = require("./app-routes.js");

const REPO = path.join(__dirname, "..", "..");
const E = encodeURIComponent;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
}

/** 索引から、動的セグメントに入れられる実在の値を1組そろえる。 */
function realValues() {
  const studios = readJson("content/archive/studios.json");
  const archive = readJson("content/archive/index.json");
  const people = readJson("content/archive/people.json").people;
  // 配信1件以上の作品を持つ、いちばん新しい過去クール。
  const season = [...archive.seasons].filter((s) => s.workIds.length > 0).at(-1);
  // 声優は「そのクールに2作品以上」の人を1人。ページが実在する条件と同じ。
  const counts = new Map();
  for (const [name, works] of Object.entries(people)) {
    for (const w of works) {
      if (w[2] === season.year && w[3] === season.season) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  }
  const eligible = [...counts].filter(([, c]) => c >= 2).map(([n]) => n);
  const person =
    eligible.find((n) => [...n].some((ch) => ch.codePointAt(0) > 0x7f)) ?? eligible[0] ?? null;
  // 配信サービスのキーは lib/services.ts の正準リストから読む。
  const svcSrc = fs.readFileSync(path.join(REPO, "lib/services.ts"), "utf8");
  const serviceKey = (svcSrc.match(/\{\s*key:\s*"([a-z_]+)"/) || [])[1] || "d_anime";
  // 上の②。
  const preferNonAscii = (names) =>
    names.find((n) => [...n].some((ch) => ch.codePointAt(0) > 0x7f)) ?? names[0];
  return {
    studio: preferNonAscii(Object.keys(studios.studios)),
    director: preferNonAscii(Object.keys(studios.directors)),
    person,
    workId: String(season.workIds[0]),
    year: String(season.year),
    season: season.season,
    serviceKey,
  };
}

/** 季節の並び順。lib/resolveSeasonParams.ts の SEASON_KEYS から読む（書き写さない）。 */
function seasonOrder() {
  const src = fs.readFileSync(path.join(REPO, "lib/resolveSeasonParams.ts"), "utf8");
  const m = src.match(/SEASON_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  const keys = m ? [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : [];
  // 読めなかったら既定値に倒さない。黙って倒すと、定数名が変わった日に
  // 「今期」の判定だけが静かにズレて、また測っていない面ができる。
  if (keys.length !== 4) {
    throw new Error("lib/resolveSeasonParams.ts の SEASON_KEYS を読めませんでした（定義が変わった？）");
  }
  return keys;
}

/**
 * **今期（現在クール）**の実在する値（2026-09-27追加）。
 *
 * 【なぜ要るか・重大度高】上の realValues() が返すのは**過去クールの値だけ**である
 * （`content/archive/index.json` はスナップショット＝2010〜昨年しか持たない）。
 * そのため毎日の表示速度の計測は、**全面が事前生成済みのページしか測っていなかった**。
 * 実利用者が見るのは今期のページで、そちらは `generateStaticParams` の対象外＝
 * `fallback: blocking` でその場生成になる。2026-09-27の実測では、
 * 合成計測が「12面中12面が目標(2秒)を満たす」と報告し続けている裏で、
 * 実利用者(RUM)の p75 LCP は person 3,332ms / anime 2,885ms だった。
 * **測っていない面が遅い**という、画面を見ても計測ログを見ても気づけない形の穴。
 *
 * 【クール名を書かない】今期は `scripts/track-season.js` の `targetSeasons` **だけ**が
 * 決める（記録側と同じ定義。`scripts/freshness.js` も同じものを使う）。
 * **日付の計算をここに書き写さない**（書き写すとクールが変わった日に静かにズレる）。
 *
 * 【2026-10-04訂正・重大度高】以前は `first-seen.json` の**いちばん早いキー**を今期と
 * みなしていた。だが記録側は**消えたクールを消さない**（`check-track-season.js` が
 * 固定している）ので、クールが替わっても前のクールのキーが残り続ける。結果、10月に
 * なっても `-current` の5面は**全部 2026-summer（もう終わったクール）を測っていた**。
 * 本当の今期（秋）は1面も測られておらず、#198 の効果判定ができない状態だった。
 * いまは今期のキーを `targetSeasons` で求め、**記録に無ければ null を返す**
 * （古いクールに黙って落ちない＝呼び出し側が「測っていない」と出す）。
 *
 * 声優名だけは今期ぶんの一次情報がリポジトリに無い（people.json は過去クールのみ）ので
 * null を返す。呼び出し側が `skipped` として出すので、**黙って対象から外れない**。
 */
// 今期のキー（例: "2026-autumn"）。定義は track-season.js の targetSeasons だけが持つ。
// today を渡せるのは回帰テストのため（差し替えるのは日付という値だけで、判断の分岐は
// 本番と同じ経路を通る）。
function currentTrackedSeasonKey(today) {
  const { targetSeasons, jstToday } = require("../track-season.js");
  return targetSeasons(today || jstToday())[0];
}

// fresh を渡せるのは回帰テストのため（既定は content/coverage/first-seen.json を読む）。
function currentValues({ today, fresh: freshIn } = {}) {
  const order = seasonOrder();
  let fresh = freshIn;
  if (!fresh) {
    try {
      fresh = readJson("content/coverage/first-seen.json");
    } catch {
      return null;
    }
  }
  const currentKey = currentTrackedSeasonKey(today);
  // 今期が記録に無いときは null（**前のクールに落ちない**＝上の訂正の再発防止）。
  const works = fresh?.sources?.annict?.[currentKey]?.works;
  if (!works) return null;
  const [year, season] = currentKey.split("-");
  // 配信サービスが1件以上ある作品を選ぶ（実際に人が開くページに近い形）。
  // 並べてから先頭を採るので、日が変わっても同じURLを測り続けられる＝前日比が意味を持つ。
  const workId = Object.entries(works)
    .filter(([, w]) => w && w.services && Object.keys(w.services).length > 0)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b))[0];
  if (!workId || !order.includes(season)) return null;
  const svcSrc = fs.readFileSync(path.join(REPO, "lib/services.ts"), "utf8");
  const serviceKey = (svcSrc.match(/\{\s*key:\s*"([a-z_]+)"/) || [])[1] || "d_anime";
  return { year, season, workId, serviceKey, studio: null, director: null, person: null };
}

/**
 * 動的セグメントの名前 → そこに入る実在する値。
 * [name] はルートによって指すものが違う（制作会社／監督／声優）ので route も見る。
 * 知らないセグメント名には null を返す（＝呼び出し側が skipped として報告する）。
 */
function realFor(segment, route, v) {
  if (segment === "id") return v.workId;
  if (segment === "year") return v.year;
  if (segment === "season") return v.season;
  if (segment === "key") return v.serviceKey;
  if (segment === "name") {
    if (route.routePath.startsWith("/studio/")) return v.studio;
    if (route.routePath.startsWith("/director/")) return v.director;
    return v.person;
  }
  return null;
}

/**
 * app/ を走査して「面ごとに代表URLを1本」返す（HTMLページだけ。APIと画像は除く）。
 * 戻り値: { urls: [{ face, routePath, path }], skipped: string[] }
 *
 * face は先頭セグメント（"/" は "home"）。表示速度は面ごとに傾向が違うので、
 * 面を単位にすると `scripts/seo-report.js` の「面別」と並べて読める。
 */
function buildUrls(values, { faceSuffix = "", onlySeasonal = false, label = "" } = {}) {
  // robots.txt が拒否している面は測らない（訪問者もクローラーも来ないので、
  // 表示速度の代表値に混ぜる意味が無く、しかも /admin はトークン必須で404になる）。
  // **手で "/admin" と書かない**。app/robots.ts から読み取る＝拒否を増やしたとき自動で従う。
  const robotsSrc = fs.readFileSync(path.join(REPO, "app/robots.ts"), "utf8");
  const disallow = [...robotsSrc.matchAll(/disallow:\s*"([^"]+)"/g)].map((m) => m[1]);
  const routes = appRoutes(path.join(REPO, "app"))
    .filter((r) => r.kind === "html")
    .filter((r) => !disallow.some((d) => d !== "/" && r.routePath.startsWith(d)))
    // 今期ぶんでは「クールや作品でURLが変わる面」だけを測る。/ や /about は
    // 今期でも過去クールでも同じURLなので、入れると同じページを2回測るだけになる。
    .filter((r) => !onlySeasonal || r.segments.includes("season") || r.segments.includes("id"));
  const urls = [];
  const skipped = [];
  for (const r of routes) {
    const reals = {};
    let ok = true;
    for (const s of r.segments) {
      const real = realFor(s, r, values);
      if (!real) {
        ok = false;
        skipped.push(`${r.routePath}${label}（[${s}] の実在値が無い）`);
        break;
      }
      reals[s] = real;
    }
    if (!ok) continue;
    const p = r.routePath.replace(/\[(?:\.{0,3})([^\]]+)\]/g, (_, name) => E(reals[name]));
    const first = p.split("/")[1] ?? "";
    urls.push({ face: (first === "" ? "home" : first) + faceSuffix, routePath: r.routePath, path: p });
  }
  return { urls, skipped };
}

function sampleUrls(values = realValues()) {
  return buildUrls(values);
}

/**
 * **今期ぶん**の代表URL（2026-09-27追加）。face に `-current` を付けて返す。
 *
 * 上の sampleUrls() が返すのは過去クール＝**事前生成済み**のページなので、
 * それだけを測っていると「焼けていない面が遅い」ことに永久に気づけない
 * （currentValues() の説明を参照）。接尾辞を付けるのは、
 * ①`scripts/speed-report.js` が face 単位で前回比・7日前比を出すため、
 * 名前がクールごとに変わると比較が切れる ②既存の断面（過去クール）と
 * 並べて読めると「焼いてある／いない」の差がそのまま表に出る、の2つの理由から。
 *
 * **今期の作品が取れないときは空で返さず skipped に出す**（黙って対象から外れない）。
 */
function currentSampleUrls() {
  const v = currentValues();
  if (!v) {
    return {
      urls: [],
      skipped: [
        `今期の全面（今期＝${currentTrackedSeasonKey()} の作品が content/coverage/first-seen.json から導出できない）`,
      ],
    };
  }
  return buildUrls(v, { faceSuffix: "-current", onlySeasonal: true, label: "（今期）" });
}

module.exports = { realValues, realFor, currentValues, currentTrackedSeasonKey, sampleUrls, currentSampleUrls };
