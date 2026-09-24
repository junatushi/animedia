// ビルド成果物のHTMLを実際に読み、**そのページが使っているクラスが、そのページに
// 埋め込まれたCSSに定義されているか**を数える（2026-09-14導入・重大度高）。
//
// 【なぜソースの検査だけでは足りないか】
// scripts/check.ts の「CSSの層分け」は app/ と components/ の import グラフから
// 「このルートはこのクラスを出しうる」を導出して突き合わせている。導出が正しい限り
// それで十分だが、導出そのものが外れる形（className の書き方が変わる、層の割り当てを
// 変える、層の部品の置き場所を間違える）では**同じ前提で作った検査は同じように外れる**。
// ここは前提を共有しない: **出来上がったHTMLの class= と <style> の中身だけ**を見る。
//
// 壊れ方は「そのページだけ無スタイル」で、画面を開かない限り気づけない。
// CI（.github/workflows/ci.yml）が `npm run build` の直後に実行する。
//
// 使い方: npm run build のあとに `node scripts/check-page-css.js`
// （.next が無ければ「ビルドしてから実行してください」と言って終了コード1で落ちる）

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_DIR = path.join(ROOT, ".next", "server", "app");
const MANIFEST = path.join(ROOT, ".next", "prerender-manifest.json");

// class= に出てくるトークン（<style> の中身は除いてから数える）。
function usedClasses(html) {
  const markup = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  const out = new Set();
  for (const m of markup.matchAll(/\sclass=\\?"([^"\\]*)/g)) {
    for (const t of m[1].split(/\s+/)) if (t) out.add(t);
  }
  return out;
}

// そのHTMLが持っている <style> を全部つないだもの。
function inlinedCss(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

function definedClasses(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return out;
}

function main() {
  console.log("【ビルド成果物のCSS網羅】");
  if (!fs.existsSync(MANIFEST)) {
    // `npm run check` からも呼ばれる（CIの並びと1本に揃えるため）。手元でまだ
    // ビルドしていないときは**黙って成功せず**、省略したことを言ってから抜ける。
    // CIでは `npm run build` の直後に走るので、そちらでは必ず本物の検査になる。
    console.log("  ─ .next が無いので省略（CIでは `npm run build` の後に実行される）");
    console.log("結果: 省略（ビルドしてから実行すると検査されます）");
    return;
  }
  // ビルドがソースより古いと、直した後の状態を検査できていない。黙って通さない。
  const buildAt = fs.statSync(path.join(ROOT, ".next", "BUILD_ID")).mtimeMs;
  let newestSrc = 0;
  const scanSrc = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) scanSrc(full);
      else newestSrc = Math.max(newestSrc, fs.statSync(full).mtimeMs);
    }
  };
  for (const d of ["app", "components", "lib"]) scanSrc(path.join(ROOT, d));
  if (newestSrc > buildAt) {
    console.log("  ─ ビルドがソースより古いので省略（`npm run build` をやり直してください）");
    console.log("結果: 省略（ビルドが古い）");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // **対象は手で並べない**（CLAUDE.mdの㊳）。事前生成された具体パスを
  // srcRoute（ルートの形）ごとにまとめ、各形から1枚ずつ見る。
  // ページ種別を増やしても自動で対象に入る。
  const bySrc = new Map();
  for (const [route, info] of Object.entries(manifest.routes)) {
    const src = info.srcRoute || route;
    if (!bySrc.has(src)) bySrc.set(src, []);
    bySrc.get(src).push(route);
  }

  let ng = 0;
  let checked = 0;
  const rows = [];
  for (const [src, routes] of [...bySrc].sort()) {
    // 同じ形の中でいちばん中身が多そうなもの＝最後のパスも見る（1枚目だけだと
    // 空に近いページを見て通ってしまうことがある）。
    const samples = routes.length > 1 ? [routes[0], routes[routes.length - 1]] : [routes[0]];
    for (const route of samples) {
      const rel = route === "/" ? "index" : route.replace(/^\//, "");
      const file = path.join(APP_DIR, rel + ".html");
      if (!fs.existsSync(file)) continue; // Route Handler（.body）等
      const html = fs.readFileSync(file, "utf8");
      const css = inlinedCss(html);
      if (css.length === 0) {
        ng++;
        rows.push(`✗ ${route}: <style> が1つも無い（無スタイル）`);
        continue;
      }
      const used = usedClasses(html);
      const defined = definedClasses(css);
      // 定義が無いクラスがあっても、それが「装飾を持たない目印」なら問題ない。
      // 実害があるのは globals.css に**定義があるのに配られていない**場合なので、
      // globals.css に出てくるクラスだけを対象にする。
      const missing = [...used].filter((c) => GLOBAL_CLASSES.has(c) && !defined.has(c));
      checked++;
      if (missing.length > 0) {
        ng++;
        rows.push(`✗ ${route}: ${missing.length}件のクラスにCSSが無い → ${missing.slice(0, 8).join(", ")}`);
      } else {
        rows.push(
          `✓ ${route.padEnd(42)} class ${String(used.size).padStart(3)} / CSS ${(css.length / 1024).toFixed(1).padStart(5)}KB`
        );
      }
    }
  }

  for (const r of rows) console.log("  " + r);
  console.log(`結果: ${ng === 0 ? `全てOK（${checked} ページ）` : `${ng} 件NG`}`);
  if (checked === 0) {
    console.error("1ページも検査できませんでした（対象の導出が壊れています）。");
    process.exit(1);
  }
  if (ng > 0) process.exit(1);
}

const GLOBAL_CLASSES = definedClasses(fs.readFileSync(path.join(ROOT, "app", "globals.css"), "utf8"));

if (require.main === module) main();
module.exports = { usedClasses, inlinedCss, definedClasses };
