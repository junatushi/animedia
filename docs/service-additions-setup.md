# 配信サービス追加の検知 セットアップ手順（2026-08-07導入）

「Annictに配信サービスが新しく登録された」ことを毎日の差分から検知する。

## なぜやるか

毎日のSNS投稿の中身が「今日の放送」「注目作TOP5」＝**サイトを見れば分かること**しかなく、
フォローする理由もリポストする理由も生まれていない（`docs/growth-strategy-2026-08.md` 7章）。
「その日はじめて分かったこと」を出せる数少ない材料がこれ。

## いちばん大事な前提

**メール通知には繋がない。** 既存の `/api/notify` は「その日に放送がある」という
日付駆動なので1日1通に収まるが、これは**変更駆動**で、Annict側の編集回数が
そのまま届いてしまう。Annictはコミュニティ編集なので、登録ミスの取り消し・付け直しが
そのまま「イベント」に見える（2026-08-07・利用者の指摘）。

そのうえで、検知ロジック自身が次の4つを機械的に保証する（`lib/serviceAdditions.ts`。
`scripts/check.ts` の「配信サービス追加の検知」節が全部テストしている）:

| | 内容 |
|---|---|
| 1 | **消えたことは扱わない。** 行も消さないし報告もしない（Annictは配信終了を記録しないため） |
| 2 | **連続3日見えてから確定。** 1日でも途切れたら連続日数はやり直し |
| 3 | **一度報告した (作品×サービス) は永久に再報告しない** |
| 4 | **初回は種まき。** 既存の全ペアを黙って報告済みにする（初日に全件が「新規」に見えるのを防ぐ） |

同じ日に2回叩かれても二重に進まない（scheduleの遅延・再実行に強くしてある）。

## 手順

### 1. Supabaseにテーブルを作る

Supabase の SQL Editor で1回実行する。

```sql
create table if not exists service_sightings (
  work_id       integer     not null,
  service_key   text        not null,
  season        text        not null,
  work_title    text        not null,
  service_short text        not null,
  last_seen     date        not null,
  streak        integer     not null default 1,
  reported_on   date,
  primary key (work_id, service_key)
);

create index if not exists service_sightings_season_idx   on service_sightings (season);
create index if not exists service_sightings_reported_idx on service_sightings (reported_on);

-- service-role キーからのみ読み書きする（一般ユーザーには開けない）。
alter table service_sightings enable row level security;
```

RLSを有効にしたうえでポリシーを作らないので、匿名キーからは読めない。
サーバー側の service-role キー（`lib/supabase/service.ts`）だけが触れる。

### 2. 秘密鍵

既存の `NOTIFY_CRON_SECRET` をそのまま使う（`docs/notify-setup.md` で設定済み）。
新しく用意するものは無い。

### 3. 動作確認

```
curl -s -X POST -H "x-cron-secret: <NOTIFY_CRON_SECRET>" \
  https://<本番ドメイン>/api/service-additions/run
```

- 1回目は `{"seeded":true, "tracked":N, "confirmed":[]}` になる（種まき）。
- 2回目以降は `seeded:false`。**確定が出始めるのは最短で3日後**（連続3日ルール）。
- Supabase未設定なら `{"skipped":true}` を返すだけで、他の機能には影響しない。

読み出しは `GET /api/service-additions`（直近14日・最大50件）。

### 4. 自動実行

`.github/workflows/service-additions.yml` が毎日1回叩く。
cronの時刻に意味は持たせていない（この処理は「その日1回走ればよい」だけで、
JSTの日付はサーバー側で決める）。

## 使いどころ（まだ繋いでいない）

`GET /api/service-additions` は用意したが、**表示側にはまだ繋いでいない**。
どのみち導入から3日は中身が空なので、データが溜まってから次を検討する:

- 日次のSNS投稿の下書き（`scripts/lib/build-digest.js`）に1行足す
- サイト内のどこかに出す ※新しいページを作るなら、
  **sitemapに載せる前にサイト内リンクを決めること**（CLAUDE.mdの「孤立ページを作らない」）

いずれの場合も、文面は「◯◯で配信開始」と断定せず
**「配信情報に◯◯が追加されました」**にすること。Annictへの登録＝配信開始とは限らない。
