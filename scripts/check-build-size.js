// デプロイ成果物の大きさに予算を設けて見張る（2026-09-14導入・重大度高）。
//
// 【なぜ要るか】Vercel Hobby の Deployment Storage は 10GB で、**保持している
// デプロイ数ぶん掛かる**。しかも Hobby は「直近10件の本番デプロイ」を保持期間の
// 設定に関わらず必ず保持する（https://vercel.com/changelog/hobby-projects-now-default-to-30-day-deployment-retention）。
// つまり **1デプロイの成果物 × 10 が、何をしても消えない床**になる。
//
//   成果物 1.0GB → 床だけで 10GB ＝ 上限ちょうど（2026-09-14に実際にこの状態で、
//                                        実測は 28.23GB ＝ 上限の282%だった）
//   成果物 0.57GB → 床は 5.7GB ＝ 上限の57%
//
// 成果物はページ数とページの大きさの積で決まり、**クールが増えるたびに自動で増える**
// （CLAUDE.md の条件④）。放っておくと必ずまた超えるので、増えたことに気づく仕掛けが要る。
// 「気づく」だけでは足りない（気づいても誰も見ない）ので、予算を超えたら落とす。
//
// 【予算の出し方】ここに書いた数字は逐次的に決めた値ではなく、上限から逆算している:
//   10GB（上限） × 0.65（床に使ってよい割合） ÷ 10（必ず保持される本番デプロイ数）= 650MB
// 残りの3.5GBはプレビューと、直近10件より古い本番デプロイの取り分。
// **この値を上げるときは、上の式のどれを変えるのかを書くこと**（数字だけ書き換えない）。
//
// 【超えたときの手当て】ページを減らすのではなく、まず1ページを小さくする
// （ISR Writes も転送量も同じ比率で効く）。内訳を出すのはそのため。
// 経緯は docs/operations.md の㊻。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const QUOTA_BYTES = 10 * 1000 * 1000 * 1000; // Hobby の Deployment Storage
const ALWAYS_RETAINED_PRODUCTION = 10; // 保持期間に関わらず残る本番デプロイ数
const FLOOR_SHARE = 0.65; // 上の床に使ってよい割合（残りはプレビュー等）
const BUDGET_BYTES = Math.round((QUOTA_BYTES * FLOOR_SHARE) / ALWAYS_RETAINED_PRODUCTION);

// デプロイに含まれるもの。ビルドキャッシュ（.next/cache）は別枠なので数えない。
const TARGETS = [".next/server", ".next/static", "public"];

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 競合で消えたファイルは無視 */
        }
      }
    }
  }
  return total;
}

const mb = (n) => (n / 1e6).toFixed(1) + "MB";

/** 面ごとの「1ページあたりバイト数」を、このビルドの実測から出す（.html の枚数で割る）。 */
function bytesPerPage(appDir, face) {
  const dir = path.join(appDir, face);
  if (!fs.existsSync(dir)) return null;
  let pages = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (e.name.endsWith(".html")) pages++;
    }
  }
  if (pages === 0) return null;
  return { pages, perPage: dirSize(dir) / pages };
}

/**
 * 1年あたりに増える成果物のバイト数。**実データから導出**する（手で書かない）。
 * 材料が1つでも欠けたら null を返す（年数を推測で出さない）。
 */
function estimateGrowth(appDir) {
  let index, people;
  try {
    index = JSON.parse(fs.readFileSync(path.join(ROOT, "content/archive/index.json"), "utf8"));
    people = JSON.parse(fs.readFileSync(path.join(ROOT, "content/archive/people.json"), "utf8"));
  } catch {
    return null;
  }

  // 作品ページ: 配信1件以上（＝sitemapに載せ、焼く対象）を年で畳む。
  const worksByYear = new Map();
  for (const s of index.seasons || []) {
    worksByYear.set(s.year, (worksByYear.get(s.year) || 0) + (s.workIds?.length || 0));
  }
  // 声優ページ: app/person/[name]/[year]/[season] の generateStaticParams と同じ規則で
  // 組を作り、年で畳む。規則は①そのクールに2作品以上 ②過去年は総出演が閾値以上
  // （＝索引に載るページだけ焼く）。
  //
  // **閾値をここに書き写さない。** lib/personPage.ts から読み取る（1箇所が持つ）。
  // 読めなければ null を返して見通しを出さない（古い閾値で年数を出すほうが害になる）。
  const personSrc = (() => {
    try {
      return fs.readFileSync(path.join(ROOT, "lib/personPage.ts"), "utf8");
    } catch {
      return "";
    }
  })();
  const minAppear = Number(/PERSON_PAGE_MIN_APPEARANCES\s*=\s*(\d+)/.exec(personSrc)?.[1]);
  const minTotal = Number(/PERSON_PAGE_INDEX_MIN_TOTAL_WORKS\s*=\s*(\d+)/.exec(personSrc)?.[1]);
  if (!Number.isFinite(minAppear) || !Number.isFinite(minTotal)) return null;

  const personByYear = new Map();
  {
    const counts = new Map();
    const totalWorks = new Map();
    for (const [name, works] of Object.entries(people.people || {})) {
      totalWorks.set(name, works.length);
      for (const w of works) {
        const k = `${w[2]}/${w[3]}/${name}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    for (const [key, c] of counts) {
      if (c < minAppear) continue;
      const parts = key.split("/");
      const year = Number(parts[0]);
      const name = parts.slice(2).join("/");
      // 今年のクールは索引に載るが**焼かない**（ライブ取得なのでビルドを外部APIに
      // 依存させない）。成長の見積もりに要るのは「翌年以降、過去年として焼かれる数」
      // なので、ここでは過去年の規則（総出演が閾値以上）で数える。
      if ((totalWorks.get(name) || 0) < minTotal) continue;
      personByYear.set(year, (personByYear.get(year) || 0) + 1);
    }
  }

  // 直近3年の平均。**最新年は途中（まだクールが揃っていない）ことがある**ので、
  // 揃っている年だけを使う（作品数の索引に4クール分ある年）。
  const completeYears = [...worksByYear.keys()]
    .filter((y) => (index.seasons || []).filter((s) => s.year === y).length === 4)
    .sort((a, b) => b - a)
    .slice(0, 3);
  if (completeYears.length === 0) return null;
  const avg = (m) => completeYears.reduce((n, y) => n + (m.get(y) || 0), 0) / completeYears.length;
  const worksPerYear = Math.round(avg(worksByYear));
  const personPerYear = Math.round(avg(personByYear));

  const anime = bytesPerPage(appDir, "anime");
  const person = bytesPerPage(appDir, "person");
  const season = bytesPerPage(appDir, "season");
  if (!person || !season) return null;
  // 作品ページを焼いていないビルド（スナップショットが旧形式）では実測が無い。
  // その場合は作品ページ分を 0 として出し、注記で分かるようにする。
  const animePer = anime ? anime.perPage : 0;

  return {
    worksPerYear,
    personPerYear,
    // 作品ページをまだ焼いていない断面（スナップショットが旧形式）では実測が無いので
    // 0 として数える。**そのぶん見通しは長く出る**ので、呼び出し側で必ず断る。
    animeMissing: !anime,
    bytesPerYear:
      worksPerYear * animePer + personPerYear * person.perPage + 4 * season.perPage,
  };
}

function main() {
  console.log("【デプロイ成果物の大きさ】");
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    // `npm run check` からも呼ばれる。ビルドが無いときは**黙って成功せず**、
    // 省略したと言ってから抜ける（CIでは build の直後に走るので必ず本物になる）。
    console.log("  ─ .next が無いので省略（CIでは `npm run build` の後に実行される）");
    console.log("結果: 省略（ビルドしてから実行すると検査されます）");
    return;
  }

  let total = 0;
  for (const t of TARGETS) {
    const size = dirSize(path.join(ROOT, t));
    total += size;
    console.log(`  ${t.padEnd(16)} ${mb(size).padStart(9)}`);
  }

  // どのページ種別が効いているかを出す（減らす先を探すのは人なので、内訳が要る）。
  // **対象は走査して導出する**（ページ種別を足したら自動で出る。CLAUDE.md の㊳）。
  const appDir = path.join(ROOT, ".next", "server", "app");
  if (fs.existsSync(appDir)) {
    const rows = [];
    for (const e of fs.readdirSync(appDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const size = dirSize(path.join(appDir, e.name));
      if (size > 1e6) rows.push([e.name, size]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    if (rows.length > 0) {
      console.log("  ── 内訳（1MB以上の面）──");
      for (const [name, size] of rows.slice(0, 8)) {
        console.log(`  ${("/" + name).padEnd(16)} ${mb(size).padStart(9)}  (${Math.round((size / total) * 100)}%)`);
      }
    }
  }

  // ── クールが増えたら何年で予算に当たるか（2026-09-19導入）────────────────
  //
  // 【なぜ要るか】この検査は「超えた日」に落ちるが、超えてから慌てても打てる手は
  // 少ない（1ページを小さくする作業は数日かかる）。CLAUDE.md の条件④は
  // 「クールが増えるたび作品数は増えることを加味する」なので、**いつ当たるか**を
  // 毎回出しておく。
  //
  // 【数え方】増分は手で書かない（㊳）。実データから導出する:
  //   ・作品ページ … content/archive/index.json の workIds を年で畳み、直近3年の平均
  //   ・声優ページ … content/archive/people.json から generateStaticParams と
  //                  同じ規則で組を作り、直近3年の平均
  //   ・シーズンページ … 1年4クール（定義そのもの）
  // 1ページの大きさは**このビルドの実測**（面ごとの合計 ÷ .html の枚数）を使う。
  // どちらかが取れなければ「出さない」（推測で年数を書かない）。
  const growth = estimateGrowth(appDir);
  if (growth) {
    const left = BUDGET_BYTES - total;
    const years = growth.bytesPerYear > 0 ? left / growth.bytesPerYear : Infinity;
    console.log(
      `  ── 成長の見通し ──  1年あたり +${mb(growth.bytesPerYear)}` +
        `（作品 ${growth.worksPerYear}件 / 声優 ${growth.personPerYear}件 / シーズン 4件）`
    );
    console.log(
      left <= 0
        ? "  残り 0 — すでに予算を超えています"
        : `  残り ${mb(left)} — このままなら約 ${years.toFixed(1)} 年で予算に当たります` +
          (years < 2 ? "（2年未満。1ページを小さくする手を先に決めておくこと）" : "")
    );
    // **この断りを消さないこと。** 作品ページを焼いていない断面では、いちばん増える面が
    // 見通しから丸ごと抜けている＝年数が実際よりずっと長く出る。「10年ある」と読んで
    // 安心したまま再生成し、その日に予算を超えるのがいちばん困る壊れ方。
    if (growth.animeMissing) {
      console.log(
        "  ※ 作品ページをまだ焼いていないので、この見通しに作品ページ分は入っていません" +
          "（スナップショット再生成後は大きく短くなる。docs/snapshot-regenerate.md の手順5）"
      );
    }
  }

  const pct = Math.round((total / BUDGET_BYTES) * 100);
  const floor = total * ALWAYS_RETAINED_PRODUCTION;
  console.log(
    `  合計 ${mb(total)} / 予算 ${mb(BUDGET_BYTES)}（${pct}%）` +
      ` — 必ず保持される本番${ALWAYS_RETAINED_PRODUCTION}件ぶんの床は ${mb(floor)}` +
      `（上限 ${mb(QUOTA_BYTES)} の ${Math.round((floor / QUOTA_BYTES) * 100)}%）`
  );

  if (total > BUDGET_BYTES) {
    console.error(
      `結果: NG — 予算 ${mb(BUDGET_BYTES)} を超えています。\n` +
        "  まず「1ページを小さくする」を検討すること（ISR Writes・転送量・表示速度に同じ比率で効く）。\n" +
        "  事前生成の対象を減らすのは最後の手段（焼かないページはデプロイのたびに\n" +
        "  ISR Writes を払い直すので、成果物が減っても総費用が増えることがある）。\n" +
        "  予算そのものを上げるときは、このファイル冒頭の式のどれを変えるのかを書くこと。"
    );
    process.exit(1);
  }
  console.log("結果: 全てOK");
}

if (require.main === module) main();
module.exports = { BUDGET_BYTES, dirSize };
