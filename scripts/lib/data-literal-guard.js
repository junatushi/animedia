"use strict";
// 「データのリテラルだけが変わったか」を、コードを実行せずに文字列だけで確かめる門番（2026-11-05導入）。
//
// なぜ要るか: 配信先の自動補完のPR（docs/coverage-autofill.md）は content/works/extraServices.ts と
// scripts/lib/coverage-acknowledged.js を書き換える。前者は本番のサーバーコードとして出荷され、
// 後者は検証スクリプトが require() する。どちらも「ファイル2つだけ」という許可リストを通っても、
// 中身に**コード**を混ぜられれば ①検証の最中に任意コードが走る（process.exit(0) で合格を偽装）
// ②マージ後にVercelの本番（秘密鍵つき）で走る、が起きる。調べる側のClaudeは外部ページを読むので
// プロンプトインジェクションを受けうる。そこで「リテラル以外は1バイトも変わっていない」
// 「リテラルの中身は文字列・数値・true/false/null・オブジェクト・配列だけ」を、
// PRのコードを一切 import / require / eval せずに確かめる。
//
// 受け入れるのは: 空白・コメント・二重/単一引用符の文字列・数値・true/false/null・
// キー位置の識別子（直後が `:`）・ { } [ ] : , だけ。それ以外は全部拒否する（許可リスト方式）。
// この検査を緩めないこと。緩めても画面には何も出ず、気づくのはコードが走った後になる。

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function lineOf(text, pos) {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c);
// JSの行終端子。行コメントはこれらのどれでも終わる（U+2028 で終わることを見落とすと、
// コメントの「続き」がコードとして実行される）。
const isLineTerminator = (c) => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";

/**
 * 緩い走査（base＝main側の版用）。文字列・コメントを読み飛ばして括弧の対応だけを見る。
 * @returns {number} リテラルの終端（閉じ括弧の次）。見つからなければ -1
 */
function findLiteralEndLenient(text, start) {
  const closers = { "{": "}", "[": "]", "(": ")" };
  const stack = [];
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && !isLineTerminator(text[i])) i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e < 0) return -1;
      i = e + 2;
      continue;
    }
    if (closers[c]) stack.push(closers[c]);
    else if (c === "}" || c === "]" || c === ")") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** 文字列リテラルの中身を復号する（キー名の検査用）。壊れた形は null。 */
function decodeString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === "u") {
      let hex;
      if (raw[i + 1] === "{") {
        const e = raw.indexOf("}", i);
        if (e < 0) return null;
        hex = raw.slice(i + 2, e);
        i = e;
      } else {
        hex = raw.slice(i + 1, i + 5);
        i += 4;
      }
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff) return null;
      out += String.fromCodePoint(cp);
    } else if (n === "x") {
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else if (n === undefined) {
      return null;
    } else {
      const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
      out += map[n] ?? n;
    }
  }
  return out;
}

/**
 * 厳しい字句解析。許可する字句以外が1つでもあれば errors に積む。
 * @returns {{ tokens: Array, errors: string[] }}
 */
function tokenizeStrict(text, start, end) {
  const tokens = [];
  const errors = [];
  const structural = []; // 許可外の「文字」以外の字句エラー（閉じていない文字列など）
  const sig = []; // データでない字句（許可外の文字・値の位置の識別子）を出現順に並べたもの
  const err = (pos, msg, isStructural = true) => {
    const m = `${lineOf(text, pos)}行目: ${msg}`;
    errors.push(m);
    if (isStructural) structural.push(m);
  };
  let i = start;
  while (i < end) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < end && !isLineTerminator(text[i])) i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e < 0 || e + 2 > end) {
        err(i, "閉じていないブロックコメント /* があります");
        return { tokens, errors, structural, sig };
      }
      i = e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let closed = false;
      while (j < end) {
        const d = text[j];
        if (d === "\\") {
          if (isLineTerminator(text[j + 1] ?? "")) {
            err(j, "文字列の中の行継続（バックスラッシュ＋改行）は使えません");
            return { tokens, errors, structural, sig };
          }
          j += 2;
          continue;
        }
        if (isLineTerminator(d)) break;
        if (d === q) {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        err(i, `閉じていない文字列リテラル（${q}）があります（文字列の中で改行できません）`);
        return { tokens, errors, structural, sig };
      }
      const raw = text.slice(i + 1, j);
      const value = decodeString(raw);
      if (value === null) err(i, `文字列リテラルのエスケープが不正です: ${text.slice(i, j + 1).slice(0, 40)}`);
      tokens.push({ type: "string", value: value ?? "", pos: i });
      i = j + 1;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /^-?\d+(\.\d+)?/.exec(text.slice(i, end));
      if (!m) {
        err(i, "数値でない `-` があります（演算子は使えません）");
        i++;
        continue;
      }
      const after = text[i + m[0].length] ?? "";
      if (/[A-Za-z0-9_$.]/.test(after)) {
        err(i, `数値リテラルの形が許可外です（整数か小数だけ）: ${text.slice(i, i + m[0].length + 3)}`);
      }
      tokens.push({ type: "number", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < end && isIdPart(text[j])) j++;
      tokens.push({ type: "word", value: text.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ("{}[]:,".includes(c)) {
      tokens.push({ type: "punct", value: c, pos: i });
      i++;
      continue;
    }
    const label = c === "`" ? "バッククォート（テンプレートリテラル）" : `\`${c}\`（U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}）`;
    err(i, `許可されていない文字 ${label} があります（データのリテラルには文字列・数値・true/false/null・{} []・: , だけ使えます）`, false);
    sig.push({ pos: i, text: c });
    i++;
  }
  // キー位置でも true/false/null でもない識別子は「コード」とみなす
  tokens.forEach((t, k) => {
    if (t.type !== "word") return;
    const next = tokens[k + 1];
    const isKey = next && next.type === "punct" && next.value === ":";
    if (!isKey && t.value !== "true" && t.value !== "false" && t.value !== "null") sig.push({ pos: t.pos, text: t.value });
  });
  sig.sort((a, b) => a.pos - b.pos);
  return { tokens, errors, structural, sig };
}

/** トークン列を文法どおりに読む。リテラル全体を過不足なく消費しなければ errors。 */
function parseTokens(tokens, text, rootKind) {
  const errors = [];
  let p = 0;
  let abort = false;
  const err = (tok, msg) => {
    errors.push(`${lineOf(text, tok ? tok.pos : text.length)}行目: ${msg}`);
    abort = true;
  };
  const show = (t) => (t ? `\`${t.value}\`` : "（終端）");
  const checkKey = (name, tok) => {
    if (FORBIDDEN_KEYS.has(name)) err(tok, `キー名 \`${name}\` は使えません（プロトタイプ汚染の経路になるため）`);
  };

  function value() {
    const t = tokens[p];
    if (!t) return err(null, "値が途中で終わっています");
    if (t.type === "string" || t.type === "number") {
      p++;
      return;
    }
    if (t.type === "word") {
      if (t.value === "true" || t.value === "false" || t.value === "null") {
        p++;
        return;
      }
      return err(t, `値の位置に識別子 \`${t.value}\` があります（変数・関数・式は使えません。文字列は引用符で囲んでください）`);
    }
    if (t.type === "punct" && t.value === "{") return object();
    if (t.type === "punct" && t.value === "[") return array();
    return err(t, `値の位置に ${show(t)} があります`);
  }
  function object() {
    p++; // {
    for (;;) {
      const t = tokens[p];
      if (!t) return err(null, "オブジェクトが閉じていません");
      if (t.type === "punct" && t.value === "}") {
        p++;
        return;
      }
      if (t.type === "word" || t.type === "string" || t.type === "number") {
        checkKey(t.value, t);
        p++;
        const colon = tokens[p];
        if (!colon || colon.type !== "punct" || colon.value !== ":") {
          return err(colon || t, `キー ${show(t)} の直後は \`:\` である必要があります（見つかったもの: ${show(colon)}）`);
        }
        p++;
        value();
        if (abort) return;
        const sep = tokens[p];
        if (sep && sep.type === "punct" && sep.value === ",") {
          p++;
          continue;
        }
        if (sep && sep.type === "punct" && sep.value === "}") continue;
        return err(sep || t, `オブジェクトのメンバーの後に ${show(sep)} があります（\`,\` か \`}\` のはず）`);
      }
      return err(t, `オブジェクトの中に ${show(t)} があります（キーのはず。展開 \`...\`・計算キー \`[..]\`・メソッドは使えません）`);
    }
  }
  function array() {
    p++; // [
    for (;;) {
      const t = tokens[p];
      if (!t) return err(null, "配列が閉じていません");
      if (t.type === "punct" && t.value === "]") {
        p++;
        return;
      }
      value();
      if (abort) return;
      const sep = tokens[p];
      if (sep && sep.type === "punct" && sep.value === ",") {
        p++;
        continue;
      }
      if (sep && sep.type === "punct" && sep.value === "]") continue;
      return err(sep || t, `配列の要素の後に ${show(sep)} があります（\`,\` か \`]\` のはず）`);
    }
  }

  const first = tokens[0];
  if (!first || first.type !== "punct" || first.value !== rootKind) {
    err(first, `リテラルの最上位は \`${rootKind}\` である必要があります`);
    return errors;
  }
  value();
  if (!abort && p !== tokens.length) err(tokens[p], `リテラルの閉じ括弧の後に ${show(tokens[p])} が残っています`);
  return errors;
}

/** キー位置（直後が `:`）の識別子・文字列が禁止名でないか。 */
function forbiddenKeyErrors(tokens, text) {
  const errors = [];
  tokens.forEach((t, k) => {
    const next = tokens[k + 1];
    if ((t.type === "word" || t.type === "string") && next && next.type === "punct" && next.value === ":" && FORBIDDEN_KEYS.has(t.value)) {
      errors.push(`${lineOf(text, t.pos)}行目: キー名 \`${t.value}\` は使えません（プロトタイプ汚染の経路になるため）`);
    }
  });
  return errors;
}

/**
 * @param {{ base: string, head: string, marker: string }} args
 *   base/head … ファイル全文。marker … データのリテラルの開始を示す、そのままの文字列
 *   （例: `const ACKNOWLEDGED = `）。マーカーの直後からがリテラル。
 * @returns {{ ok: boolean, errors: string[] }}
 */
function checkDataOnlyChange({ base, head, marker }) {
  const errors = [];
  if (typeof base !== "string" || typeof head !== "string" || !marker) {
    return { ok: false, errors: ["検査の入力が不正です（base・head・marker が必要）"] };
  }
  const locate = (text, label) => {
    const first = text.indexOf(marker);
    if (first < 0) {
      errors.push(`${label}にデータの開始位置 \`${marker.trim()}\` が見つかりません`);
      return -1;
    }
    if (text.indexOf(marker, first + 1) >= 0) {
      errors.push(`${label}にデータの開始位置 \`${marker.trim()}\` が2か所以上あります（${lineOf(text, first)}行目ほか）`);
      return -1;
    }
    return first + marker.length;
  };
  const bs = locate(base, "変更前（main）の版");
  const hs = locate(head, "変更後（PR）の版");
  if (bs < 0 || hs < 0) return { ok: false, errors };

  const baseRoot = base[bs];
  if (baseRoot !== "{" && baseRoot !== "[") {
    return { ok: false, errors: ["変更前の版でマーカーの直後が `{` でも `[` でもありません（検査の前提が崩れています）"] };
  }
  const be = findLiteralEndLenient(base, bs);
  if (be < 0) return { ok: false, errors: ["変更前の版でリテラルの終端が見つかりません（括弧が対応していません）"] };

  // 1) リテラルの外側は1バイトも変えてはいけない（import の追加・関数の書き換え・リテラルの後ろへのコードを塞ぐ）
  if (head.slice(0, hs) !== base.slice(0, bs)) {
    errors.push(`データのリテラルより前の部分が変更されています（${lineOf(head, 0)}〜${lineOf(head, hs)}行目の範囲。import・定義・コメントも含め、リテラルの外は変えられません）`);
  }
  if (head[hs] !== baseRoot) {
    errors.push(`${lineOf(head, hs)}行目: リテラルの最上位が \`${baseRoot}\` ではありません（変更前は \`${baseRoot}\`）`);
    return { ok: false, errors };
  }
  const he = findLiteralEndLenient(head, hs);
  if (he < 0) {
    errors.push(`${lineOf(head, hs)}行目から始まるリテラルの括弧が閉じていません`);
    return { ok: false, errors };
  }
  if (head.slice(he) !== base.slice(be)) {
    errors.push(`データのリテラルより後ろの部分が変更されています（${lineOf(head, he)}行目以降。リテラルの外は変えられません）`);
  }

  // 2) リテラルの中は許可した字句だけ
  const headLex = tokenizeStrict(head, hs, he);
  const baseLex = tokenizeStrict(base, bs, be);
  // 変更前（main）のリテラルにコードがあるなら、比べる土台が無いので**自動では通さない**（人の確認へ）。
  // 2026-11-05に extraServices.ts の `(...).map(...)` 2件を素のデータへ書き換えたので、
  // main は常にデータだけのはず。ここに来たら誰かが手でコードを混ぜた＝人が見るべき状況。
  if (baseLex.sig.length > 0 || baseLex.structural.length > 0) {
    errors.push(
      "変更前（main）の版のリテラルにデータ以外の字句があります。比べる土台が無いので自動では通しません（main 側をデータだけに直してください）"
    );
    return { ok: false, errors };
  }
  // 変更後も全部が許可した字句・文法でなければならない
  errors.push(...headLex.errors);
  if (headLex.errors.length === 0) errors.push(...parseTokens(headLex.tokens, head, baseRoot));

  return { ok: errors.length === 0, errors };
}

module.exports = { checkDataOnlyChange };
