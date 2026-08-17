// verify-production.sh がJSONから値を取り出すための小道具（2026-08-11導入）。
//
// 【なぜ要るか】
// verify-production.sh は当初 jq を使っていたが、**jq はこのリポジトリの前提に無い**。
// GitHub Actions の ubuntu-latest には最初から入っているので CI は緑のままだったが、
// Windows の開発機には入っておらず、`bash scripts/verify-production.sh` も
// `node scripts/check-verify-production.js` も**手元では必ず失敗する**状態だった
// （検査対象を1件も選べずに `NG: 配信サービスのある過去クール作品を…` で終了する）。
// CLAUDE.md も docs/operations.md も「ローカルでも実行できる」と書いているのに
// 実際には実行できず、しかも CI が緑なので気づけない、という形で放置されていた。
//
// Node はこのリポジトリの前提そのものなので、jq を Node に置き換えれば
// 依存が1つ減り、どの環境でも同じように動く。**検査の中身は一切変えていない**
// （変わっていないことは scripts/check-verify-production.js が固定する）。
//
// 使い方:
//   echo '<json>' | node scripts/lib/json-pick.js services-count
//   node scripts/lib/json-pick.js archive-candidates content/archive/index.json
//   echo '<json>' | node scripts/lib/json-pick.js top-ids
//   echo '<json>' | node scripts/lib/json-pick.js airing-status

const fs = require("node:fs");

/** 候補として出す件数。jq版の `[0:5]` と同じ。 */
const CANDIDATE_LIMIT = 5;

function readInput(file) {
  return file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
}

function main() {
  const [mode, file] = process.argv.slice(2);
  let raw;
  try {
    raw = readInput(file);
  } catch (e) {
    console.error(`json-pick: 入力を読めませんでした (${e.message})`);
    process.exitCode = 1;
    return;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    // 本番が落ちている・HTMLのエラーページが返った、などで壊れたJSONが来る。
    // ここで黙って空を返すと、呼び出し側の `[ "$(...)" != "0" ]` が真になって
    // **配信サービスの無い作品を検査対象に選んでしまう**（jq版はこうなっていた）。
    // 0 を返して「サービスは無い＝この候補は使わない」に倒す。
    console.error("json-pick: JSONとして読めませんでした");
    if (mode === "services-count") console.log("0");
    process.exitCode = 1;
    return;
  }

  switch (mode) {
    // (.services // []) | length
    case "services-count":
      console.log(String((json.services || []).length));
      return;

    // [.seasons[] | select((.workIds | length) > 0)] | last | .workIds[0:5][]
    case "archive-candidates": {
      const seasons = (json.seasons || []).filter((s) => (s.workIds || []).length > 0);
      const last = seasons[seasons.length - 1];
      if (!last) return; // 該当なし＝何も出さない（jqの `last` が null になるのと同じ扱い）
      for (const id of last.workIds.slice(0, CANDIDATE_LIMIT)) console.log(String(id));
      return;
    }

    // .items | sort_by(-(.watchers // 0)) | .[0:5][] | .id
    case "top-ids": {
      const items = [...(json.items || [])];
      items.sort((a, b) => (b.watchers || 0) - (a.watchers || 0));
      for (const it of items.slice(0, CANDIDATE_LIMIT)) console.log(String(it.id));
      return;
    }

    // .airingStatus // "missing"
    case "airing-status":
      console.log(json.airingStatus ?? "missing");
      return;

    default:
      console.error(`json-pick: 未知のモード "${mode}"`);
      process.exitCode = 1;
  }
}

main();
