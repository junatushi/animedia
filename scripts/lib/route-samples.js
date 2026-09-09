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
function sampleUrls(values = realValues()) {
  // robots.txt が拒否している面は測らない（訪問者もクローラーも来ないので、
  // 表示速度の代表値に混ぜる意味が無く、しかも /admin はトークン必須で404になる）。
  // **手で "/admin" と書かない**。app/robots.ts から読み取る＝拒否を増やしたとき自動で従う。
  const robotsSrc = fs.readFileSync(path.join(REPO, "app/robots.ts"), "utf8");
  const disallow = [...robotsSrc.matchAll(/disallow:\s*"([^"]+)"/g)].map((m) => m[1]);
  const routes = appRoutes(path.join(REPO, "app"))
    .filter((r) => r.kind === "html")
    .filter((r) => !disallow.some((d) => d !== "/" && r.routePath.startsWith(d)));
  const urls = [];
  const skipped = [];
  for (const r of routes) {
    const reals = {};
    let ok = true;
    for (const s of r.segments) {
      const real = realFor(s, r, values);
      if (!real) {
        ok = false;
        skipped.push(`${r.routePath}（[${s}] の実在値が無い）`);
        break;
      }
      reals[s] = real;
    }
    if (!ok) continue;
    const p = r.routePath.replace(/\[(?:\.{0,3})([^\]]+)\]/g, (_, name) => E(reals[name]));
    const first = p.split("/")[1] ?? "";
    urls.push({ face: first === "" ? "home" : first, routePath: r.routePath, path: p });
  }
  return { urls, skipped };
}

module.exports = { realValues, realFor, sampleUrls };
