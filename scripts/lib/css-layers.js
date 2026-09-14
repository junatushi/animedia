// CSSを「その面が本当に要る分」だけに分ける（2026-09-14導入・重大度高）。
//
// ───────────────────────────────────────────────────────────────
// なぜ要るか（実測）
//
// app/globals.css は㊵の判断でHTMLに直接埋め込んでいる（<link> にすると往復が1回増え、
// 実測で描画開始が約370ms遅れる）。ただし**全ページに同じ全量を入れていた**ため、
// ビルド成果物を実測すると声優ページ1枚（110,317文字）の内訳はこうなっていた:
//
//   <style> のCSS             41,928文字（38%）
//   RSCペイロード内のCSSの複製   41,928文字（38%）  ← Next.jsはサーバー描画結果を
//   実際のマークアップ            4,575文字（ 4%）      flightにも載せるので必ず二重になる
//   その他（flightの残り等）     21,886文字（20%）
//
// つまり**1ページの76%がCSSで、しかも本文の18倍**。さらに .rsc（先読みで落ちる本体）にも
// 1コピー入るので、1ページあたり CSS×3 を配っていた。声優ページは4,483枚あり、
// これだけで成果物の 869MB を占めていた（全体 1.03GB）。
//
// 効くところが4つある:
//   ①Deployment Storage（Hobby 10GB）… 成果物 × 保持しているデプロイ数。本番デプロイは
//     直近10件が常に保持されるので、1デプロイ1GBだとそれだけで枠を使い切る。
//   ②ISR Writes（Hobby 30日20万）… **回数ではなく 8KB 単位のバイト量**で数える。
//     https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing
//   ③Fast Origin Transfer / 転送量
//   ④表示速度（スマホのHTMLパース。実測で声優ページが必要としているCSSは9.2KBだけ）
//
// ───────────────────────────────────────────────────────────────
// どう分けるか
//
// **手で並べない**（CLAUDE.mdの㊳）。クラス名がどの面で使われうるかを
// `app/` と `components/` の**import グラフから導出**する:
//
//   1. app/**/{page,layout,not-found}.tsx を「ルート」とする
//   2. ローカル import をたどって、そのルートが描画しうるファイル集合を出す
//   3. 各ファイルの className リテラルを集め、クラス名 → ルート集合 を作る
//   4. ルート集合が
//        ・{/ , /season/[year]/[season]} の部分集合 → explorer 層
//        ・{/anime/[id]} の部分集合            → detail 層
//        ・それ以外（複数の面で使う・レイアウト由来）→ base 層
//   5. CSSの各ルールを、対象クラスの層のうち**最も広いもの**へ入れる
//      （1つでも base のクラスを含むなら base。explorer と detail をまたぐなら base）
//
// 新しいページがSeasonExplorerを使い始めれば、そのクラスは自動的に base へ上がる。
// 逆に面を増やしても、どのクラスがどの層かを人が書き写す場所は存在しない。
//
// ───────────────────────────────────────────────────────────────
// 壊れ方と、その防ぎ方
//
// この仕組みが壊れると**そのページだけ無スタイル**になる（画面を見れば分かるが、
// 見ない限り分からない）。そこで2段構えで検査する:
//   ・scripts/check.ts … ソースから導出した「そのルートが出しうるクラス」が、
//     そのルートが埋め込む層に全部入っているかを突き合わせる（ビルド不要）
//   ・scripts/check-page-css.js … ビルド成果物のHTMLを実際に読み、class= に出てくる
//     名前が、そのHTMLの <style> の中に定義されているかを数える（ビルド後・CI）
//
// もう1つの危険は**カスケードの順序**。base は <head>、追加層は本文の先頭に入るので、
// 元のCSSで「追加層のルールの後ろに base のルールがある」箇所は前後が入れ替わる。
// findOrderConflicts() が、入れ替わったうえで**同じ要素に当たりうる同名プロパティ**を
// 持つ組を全部挙げる。0件でなければ層分けを直す（この検査を消さないこと）。
// ───────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// ── ソースの走査 ───────────────────────────────────────────────
// Next.js が「ルート」として扱うファイル名。app/ 配下を走査して見つける
// （scripts/lib/app-routes.js と同じ考え方だが、こちらは描画するもの＝
//  page / layout / not-found だけが対象。route.ts はJSXを描かない）。
const ROUTE_FILES = new Set(["page.tsx", "layout.tsx", "not-found.tsx"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// app/(dir)/page.tsx → "/dir" のようなルート識別子。
// ルートグループ「(name)」と並列ルート「@name」は URL に出ないので落とす。
function routeIdFor(file) {
  const rel = path.relative(path.join(ROOT, "app"), file).split(path.sep);
  const segs = rel.slice(0, -1).filter((s) => !s.startsWith("(") && !s.startsWith("@"));
  return "/" + segs.join("/");
}

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // 外部パッケージ
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = base + ext;
    if (fs.existsSync(p)) return p;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

const IMPORT_RE = /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g;

function importsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const p = resolveImport(file, m[1]);
    if (p) out.push(p);
  }
  return out;
}

// className に現れる**文字列リテラル**を全部拾う。
// className={cond ? "a b" : "c"} のような形も、中のリテラルを全部取る
// （どちらが出るか分からないので両方とも「出しうる」と扱う＝安全側）。
// className={変数} のように literal がまったく無い形は導出できないので
// warnings に出す（0件であることを scripts/check.ts が確かめる）。
function classesInFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const classes = new Set();
  const warnings = [];
  const re = /className\s*=\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const seg = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    let expr;
    if (seg.startsWith("{")) {
      // 対応する } まで
      let depth = 0;
      let i = 0;
      for (; i < seg.length; i++) {
        if (seg[i] === "{") depth++;
        else if (seg[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      expr = seg.slice(1, i);
    } else if (seg.startsWith('"')) {
      expr = seg.slice(0, seg.indexOf('"', 1) + 1);
    } else {
      warnings.push(`${path.relative(ROOT, file)}: className= の形を解釈できない`);
      continue;
    }
    const lits = expr.match(/"[^"]*"|`[^`]*`|'[^']*'/g) || [];
    if (lits.length === 0) {
      warnings.push(`${path.relative(ROOT, file)}: className={${expr.trim().slice(0, 60)}} に文字列リテラルが無い`);
      continue;
    }
    for (const lit of lits) {
      // テンプレートの ${...} は中身が分からないので除いて、静的な部分だけ拾う
      for (const t of lit.slice(1, -1).replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
        if (t) classes.add(t);
      }
    }
  }
  return { classes, warnings };
}

// クラス名 → そのクラスを出しうるルートの集合
function collectRouteClasses() {
  const files = walk(path.join(ROOT, "app")).filter((f) => f.endsWith(".tsx"));
  const routes = files.filter((f) => ROUTE_FILES.has(path.basename(f)));
  const warnings = [];
  const fileClasses = new Map();
  const getClasses = (f) => {
    if (!fileClasses.has(f)) {
      const r = classesInFile(f);
      warnings.push(...r.warnings);
      fileClasses.set(f, r.classes);
    }
    return fileClasses.get(f);
  };

  const classToRoutes = new Map();
  const routeToClasses = new Map();
  for (const route of routes) {
    const id = routeIdFor(route);
    // import を辿って、そのルートが描画しうる .tsx を全部集める
    const seen = new Set();
    const stack = [route];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f) || !f.endsWith(".tsx")) continue;
      seen.add(f);
      for (const dep of importsOf(f)) stack.push(dep);
    }
    // ルートは必ずルートレイアウトの中に描かれる
    const rootLayout = path.join(ROOT, "app", "layout.tsx");
    if (fs.existsSync(rootLayout)) {
      const stack2 = [rootLayout];
      while (stack2.length) {
        const f = stack2.pop();
        if (seen.has(f) || !f.endsWith(".tsx")) continue;
        seen.add(f);
        for (const dep of importsOf(f)) stack2.push(dep);
      }
    }
    const set = routeToClasses.get(id) || new Set();
    for (const f of seen) for (const c of getClasses(f)) set.add(c);
    routeToClasses.set(id, set);
    for (const c of set) {
      if (!classToRoutes.has(c)) classToRoutes.set(c, new Set());
      classToRoutes.get(c).add(id);
    }
  }
  return { classToRoutes, routeToClasses, warnings };
}

// ── 層の割り当て ───────────────────────────────────────────────
// explorer / detail は「その面**でしか**使われないクラス」だけを引き受ける。
// ここに挙げるのはルート（URLの形）であって、クラス名でもファイル名でもない。
const EXPLORER_ROUTES = new Set(["/", "/season/[year]/[season]"]);
const DETAIL_ROUTES = new Set(["/anime/[id]"]);
const LAYERS = ["base", "explorer", "detail"];

function layerForRoutes(routeSet) {
  let allExplorer = true;
  let allDetail = true;
  for (const r of routeSet) {
    if (!EXPLORER_ROUTES.has(r)) allExplorer = false;
    if (!DETAIL_ROUTES.has(r)) allDetail = false;
  }
  if (routeSet.size === 0) return "base";
  if (allExplorer) return "explorer";
  if (allDetail) return "detail";
  return "base";
}

// そのルートが埋め込むべき層。base は常に要る。
function layersForRoute(routeId) {
  if (EXPLORER_ROUTES.has(routeId)) return ["base", "explorer"];
  if (DETAIL_ROUTES.has(routeId)) return ["base", "detail"];
  return ["base"];
}

// ── CSSの分割 ─────────────────────────────────────────────────
// コメントを外したCSSを、@media の入れ子を保ったまま「ルール」に分ける。
function parseRules(css) {
  const out = [];
  (function rec(s, offset, wrapper) {
    let i = 0;
    let start = 0;
    while (i < s.length) {
      if (s[i] === "{") {
        const sel = s.slice(start, i).trim();
        let depth = 1;
        let j = i + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === "{") depth++;
          else if (s[j] === "}") depth--;
          j++;
        }
        const body = s.slice(i + 1, j - 1);
        if (/^@(media|supports)/.test(sel)) {
          rec(body, offset + i + 1, wrapper ? `${wrapper}{${sel}` : sel);
        } else {
          out.push({ sel, body, wrapper: wrapper || null, pos: offset + start });
        }
        i = j;
        start = j;
      } else i++;
    }
  })(css, 0, null);
  return out;
}

function classesOfSelector(sel) {
  return new Set((sel.match(/\.(-?[A-Za-z_][\w-]*)/g) || []).map((s) => s.slice(1)));
}

function layerForRule(rule, classToLayer) {
  const cs = classesOfSelector(rule.sel);
  if (cs.size === 0) return "base"; // :root・要素セレクタ等は全ページ共通
  let sawExplorer = false;
  let sawDetail = false;
  for (const c of cs) {
    const l = classToLayer.get(c);
    if (l === undefined || l === "base") return "base"; // 未知のクラスは安全側
    if (l === "explorer") sawExplorer = true;
    if (l === "detail") sawDetail = true;
  }
  if (sawExplorer && sawDetail) return "base";
  return sawExplorer ? "explorer" : "detail";
}

function splitCss(css, classToLayer) {
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = parseRules(noComment);
  const perLayer = Object.fromEntries(LAYERS.map((l) => [l, []]));
  for (const r of rules) perLayer[layerForRule(r, classToLayer)].push(r);

  const rendered = {};
  for (const l of LAYERS) {
    // @media ごとにまとめ直す（元の並び順は保つ）。
    let out = "";
    let openWrapper = null;
    for (const r of perLayer[l]) {
      if (r.wrapper !== openWrapper) {
        if (openWrapper) out += "}".repeat(openWrapper.split("{").length);
        openWrapper = r.wrapper;
        if (openWrapper) out += openWrapper + "{";
      }
      out += `${r.sel}{${r.body}}`;
    }
    if (openWrapper) out += "}".repeat(openWrapper.split("{").length);
    rendered[l] = out;
  }
  return { rendered, rules, perLayer };
}

// ── カスケードの順序が入れ替わる箇所を見つける ───────────────────
// base は <head>、追加層は本文の先頭。元のCSSで「追加層 → base」の順だったものは
// 出力では「base → 追加層」になる＝後から来た base が勝っていたのに負けるようになる。
// 同じ要素に当たりうる（クラス集合が交差する／片方がクラスを持たない）うえ、
// 同じプロパティを書いている組だけを挙げる。
// 宣言のプロパティ名。**!important の宣言は数えない**
// （!important は並び順に関係なく通常の宣言に勝つので、入れ替わっても結果が変わらない）。
function propsOf(body) {
  return new Set(
    body
      .split(";")
      .filter((d) => !/!\s*important/i.test(d))
      .map((d) => d.split(":")[0].trim().toLowerCase())
      .filter((p) => p && !p.startsWith("--") && !p.includes("{"))
  );
}

// セレクタ1本の詳細度 (id, class/attr/pseudo-class, element/pseudo-element)。
// **順序が問題になるのは詳細度が等しいときだけ**なので、ここが甘いと
// 誤検知だらけになって検査が読まれなくなる。
function specificity(part) {
  const s = part.replace(/::[\w-]+/g, " PSEUDOEL ").trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls =
    (s.match(/\.[-\w]+/g) || []).length +
    (s.match(/\[[^\]]*\]/g) || []).length +
    (s.match(/:(?!:)[\w-]+/g) || []).length;
  const els =
    (s.match(/(^|[\s>+~(])([a-zA-Z][\w-]*)/g) || []).length +
    (s.match(/PSEUDOEL/g) || []).length;
  return `${ids},${cls},${els}`;
}

// セレクタの「主語」＝最後の複合セレクタ（実際にスタイルが当たる要素）。
function subjectOf(part) {
  const last = part.trim().split(/[\s>+~]+/).filter(Boolean).pop() || "";
  const classes = new Set((last.match(/\.(-?[A-Za-z_][\w-]*)/g) || []).map((c) => c.slice(1)));
  const tagMatch = last.match(/^([a-zA-Z][\w-]*)/);
  return { classes, tag: tagMatch ? tagMatch[1].toLowerCase() : last.startsWith("*") ? "*" : null };
}

// セレクタの「主語より前」に出てくるクラス（＝祖先/文脈の条件）。
function contextClassesOf(part) {
  const compounds = part.trim().split(/[\s>+~]+/).filter(Boolean);
  const ctx = new Set();
  for (const c of compounds.slice(0, -1)) {
    for (const m of c.match(/\.(-?[A-Za-z_][\w-]*)/g) || []) ctx.add(m.slice(1));
  }
  return ctx;
}

// 2つの主語が同じ要素に当たりうるか。
function subjectsOverlap(a, b) {
  for (const c of a.classes) if (b.classes.has(c)) return true;
  if (a.classes.size > 0 && b.classes.size > 0) return false; // 別のクラス同士
  // 片方（または両方）がクラスを持たない＝タグ/擬似要素で判断する
  if (a.tag === "*" || b.tag === "*") return true;
  if (a.tag && b.tag) return a.tag === b.tag;
  // タグもクラスも無い（:root 等）は当たる先が限られるので重ならないとみなす
  return false;
}

function selectorParts(sel) {
  return sel.split(",").map((p) => p.trim()).filter(Boolean);
}

function findOrderConflicts(rules, classToLayer) {
  const tagged = rules
    // @keyframes / @font-face 等は必ず base に入り、順序の影響も受けない。
    .filter((r) => !r.sel.startsWith("@"))
    .map((r) => ({ ...r, layer: layerForRule(r, classToLayer) }));
  const conflicts = [];
  for (let i = 0; i < tagged.length; i++) {
    const a = tagged[i];
    if (a.layer === "base") continue;
    const pa = propsOf(a.body);
    if (pa.size === 0) continue;
    for (let j = i + 1; j < tagged.length; j++) {
      const b = tagged[j];
      if (b.layer !== "base") continue;
      // 元の並びは a(追加層) → b(base)。出力では b → a に入れ替わる。
      // **同じ @media 文脈でなければ**そもそも同時には効かない組もあるが、
      // 安全側に倒して文脈は問わない。
      const shared = [...propsOf(b.body)].filter((p) => pa.has(p));
      if (shared.length === 0) continue;
      let hit = false;
      for (const ap of selectorParts(a.sel)) {
        for (const bp of selectorParts(b.sel)) {
          if (specificity(ap) !== specificity(bp)) continue;
          if (!subjectsOverlap(subjectOf(ap), subjectOf(bp))) continue;
          // 祖先の条件がどちらにも付いていて、そのクラスが互いに素なら
          // 同じ要素には当たらない（例: `.card-title a` と `.person-season-links a`）。
          const ca = contextClassesOf(ap);
          const cb = contextClassesOf(bp);
          if (ca.size > 0 && cb.size > 0) {
            let shares = false;
            for (const c of ca) if (cb.has(c)) shares = true;
            if (!shares) continue;
          }
          hit = true;
          break;
        }
        if (hit) break;
      }
      if (hit) conflicts.push({ later: b.sel, earlier: a.sel, props: shared, layer: a.layer });
    }
  }
  return conflicts;
}

module.exports = {
  LAYERS,
  specificity,
  subjectOf,
  subjectsOverlap,
  contextClassesOf,
  EXPLORER_ROUTES,
  DETAIL_ROUTES,
  collectRouteClasses,
  layerForRoutes,
  layersForRoute,
  splitCss,
  parseRules,
  classesOfSelector,
  layerForRule,
  findOrderConflicts,
  routeIdFor,
};
