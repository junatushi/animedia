# content/demand/raw

配信の需要シグナル収集（`docs/demand-scan.md`）の**入力**置き場。
Claude が WebSearch で集めた生ヒットを `<YYYY-MM-DD>.jsonl`（1行1ヒット）で保存する。

1行の形:
```json
{"source":"chiebukuro","url":"https://...","title":"...","snippet":"本文抜粋","date":"2026-07-14","query":"検索クエリ"}
```

`source` は `chiebukuro` / `x` / `5ch` / `reddit` / `matome` / `web`。`date` は不明なら `null`（推測で埋めない）。

集計は `node scripts/demand-scan.js`（最新JSONLを自動選択）。出力は `content/demand/out/`。
