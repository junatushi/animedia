// PostToolUse hook: lib/services.ts が編集されたら配信判定の回帰テスト（scripts/check.ts）を自動実行する。
// 失敗時は exitCode 2 で Claude にエラー内容をフィードバックし、編集の見直しを促す。
// 注意: process.exit() はパイプ先への stdout/stderr が flush されず消えることがある（Windows）ため、
// exitCode を設定して自然終了させる。
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {
    return; // 入力が読めない時は安全側（編集をブロックしない）
  }
  const filePath = String((input.tool_input && input.tool_input.file_path) || "");
  if (!/lib[\\/]services\.ts$/i.test(filePath)) return;

  const { spawnSync } = require("child_process");
  const cwd = input.cwd || process.cwd();
  const r = spawnSync(process.execPath, ["scripts/check.ts"], { encoding: "utf8", cwd });
  if (r.status === 0) {
    console.log("check.ts OK（lib/services.ts 編集後の自動回帰テスト）");
    return;
  }
  console.error(
    "lib/services.ts 編集後の check.ts が失敗しました。変更を見直してください。\n" +
      (r.stdout || "") +
      (r.stderr || "")
  );
  process.exitCode = 2;
});
