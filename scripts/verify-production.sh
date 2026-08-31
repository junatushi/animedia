#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# 本番SSRの実地検査（2026-08-07導入）
#
#   bash scripts/verify-production.sh
#
# なぜ必要か:
#   `node scripts/check.ts` はソースコードしか見ない。ところがこのリポジトリで
#   起きた最も重い事故（docs/operations.md ⑦-10）は、**ソースは正しいのに本番の
#   HTMLだけが空**という形で2週間気づかれなかった。原因は Next.js 14 が
#   useSearchParams() を含むSuspense境界を丸ごとクライアント描画へ退避させる挙動で、
#   ブラウザで見る限り完全に正常に見える。気づくにはビルド済みのHTMLを直接取って
#   数えるしかない。
#   その「HTMLを取って数える」手順は ⑦-10 の再発防止として手順書には書かれたが、
#   実行するかどうかは作業者の裁量に委ねられていた。実際 2026-08-06〜08-07 の
#   3セッション連続で「本番HTMLの確認」が持ち越され、一度も実行されていない。
#   さらにセッションを動かす環境によっては本番ドメインへの外向き通信が遮断されて
#   おり（2026-08-07 実測: egress proxy が animedia-khaki.vercel.app をブロック）、
#   「やろうとしてもできない」ことがある。裁量に委ねる限り実行されないので、
#   GitHub Actions（本番へ到達できる）側の定期実行に移した。
#
# 何を守るか（いずれも過去に実際の事故が起きた不変条件）:
#   A. SEO用SSRページのHTMLに中身が入っている        … ⑦-10
#   B. 放送終了作品に「視聴できます」と書いていない  … ⑰／CLAUDE.md 基本ルール
#   C. 放送中作品には従来どおり断定形が出ている      … B の検査が「文字列が
#      サイト全体から消えただけ」でも通ってしまうのを防ぐ
#   D. 埋め込みに <script>・自サイト外リンクが無い    … ⑯／CLAUDE.md 基本ルール
#   E. 公開APIが airingStatus を返す                  … ⑰
#   F. 索引方針が本番に反映されている                  … ㉟
#   G. sitemapに載せたURLが200を返す                … ㊱
#      2026-08-31に、**日本語名の事前生成ページが本番で全て404**になっていた。
#      sitemapに載せていて404だったのは約2,826ページ（声優2,351/監督376/制作会社99）。
#      ローカルの `next start` では全て200を返すので手元では気づけない（⑦-10と同じ型）。
#      しかも F節は robots メタを grep するだけだったため、**404ページには robots が
#      無い → 「noindexではない」→ 合格**、という形ですり抜けていた。
#      検査そのものが「見えないと合格」になっていたのが最大の問題なので、
#      以後はHTTPコードを明示的に確かめる。
#      2026-08-25に書いてテストまで通した「過去年の声優ページを索引から外す」対応が、
#      mainへ入っておらず**6日間本番に出ていなかった**。しかも誰も気づかなかった。
#      ソースを見る検査（node scripts/check.ts）は通っていたので、
#      「直したつもりで出ていない」はソース側からは原理的に検出できない。
#      ⑦-10（HTMLが空）と同じ型の事故なので、同じ場所（本番HTMLを取って数える）で見張る。
#
# シークレット不要・本番の公開URLしか叩かない（読み取りのみ）。
# 検査対象の作品IDはリポジトリ同梱の content/archive/index.json と本番の
# /api/season から動的に決める（IDのハードコードは作品がAnnictから消えると
# 検査自体が壊れるため避ける）。
# ───────────────────────────────────────────────────────────────
set -uo pipefail

# lib/siteUrl.ts と同じ値。独自ドメイン移行時は docs/domain-migration.md の手順で
# 一緒に書き換える（ここは shell なので lib/siteUrl.ts を import できない）。
BASE="${BASE:-https://animedia-khaki.vercel.app}"
CURL="curl -sS --max-time 30 --retry 2 --retry-delay 3"

# JSONから値を取り出す小道具。**jq は使わない**（2026-08-11変更）。
# jq は GitHub Actions の ubuntu には最初から入っているが Windows の開発機には無く、
# 「CIは緑なのに手元では必ず失敗する」状態になっていた（検査対象を1件も選べずに終了）。
# Node はこのリポジトリの前提そのものなので、そちらに寄せて依存を1つ減らす。
# 取り出す中身は変えていない（scripts/lib/json-pick.js のコメント参照）。
PICK="node $(dirname "$0")/lib/json-pick.js"

NG=0
ok()   { echo "  OK   $*"; }
fail() { echo "  NG   $*"; NG=$((NG + 1)); }

# 「含む」「含まない」の判定。HTMLは巨大なので grep -c は使わず -q で済ませる。
want()    { if grep -qF -- "$2" <<<"$1"; then ok "$3"; else fail "$3 … 「$2」が無い"; fi; }
wantnot() { if grep -qF -- "$2" <<<"$1"; then fail "$3 … 「$2」が出ている"; else ok "$3"; fi; }

echo "本番SSRの実地検査: $BASE"

# ── 検査対象の決定 ───────────────────────────────────────────
YEAR=$(TZ=Asia/Tokyo date +%Y)
MONTH=$(TZ=Asia/Tokyo date +%-m)
# lib/resolveSeasonParams.ts の seasonKeyForMonth と同じ月→クール判定
if   [ "$MONTH" -le 3 ]; then SEASON="winter"
elif [ "$MONTH" -le 6 ]; then SEASON="spring"
elif [ "$MONTH" -le 9 ]; then SEASON="summer"
else                          SEASON="autumn"
fi

# 検査する文言（「〜で視聴できます」「〜の配信情報があるのは」）は、配信サービスが
# 1件以上ある作品にしか出ない（0件の作品は「登録がなく確認できません」になる）。
# そのため候補を順に /api/work で見て、services が空でない最初の1件を選ぶ。
# 固定IDにしないのは、作品がAnnictから消えたときに検査自体が壊れるのを避けるため。
pick_with_services() {
  for id in $1; do
    if [ "$($CURL "$BASE/api/work/${id}" | $PICK services-count)" != "0" ]; then
      echo "$id"
      return 0
    fi
  done
  return 1
}

# 過去クールの候補: content/archive/index.json（配信1件以上の作品だけを持つ索引）の
# いちばん新しいクールから5件。古いクールほど作品がAnnictから消える確率が上がる。
PAST_CANDIDATES=$($PICK archive-candidates content/archive/index.json)
# 現在クールの候補: 注目度上位5件（＝いちばん見られるページなので壊れたら影響が大きい）。
CURRENT_CANDIDATES=$($CURL "$BASE/api/season?year=${YEAR}&season=${SEASON}" | $PICK top-ids)

PAST_ID=$(pick_with_services "$PAST_CANDIDATES") || {
  echo "NG: 配信サービスのある過去クール作品を見つけられませんでした（候補: $(tr '\n' ' ' <<<"$PAST_CANDIDATES")）"
  exit 1
}
CURRENT_ID=$(pick_with_services "$CURRENT_CANDIDATES") || {
  echo "NG: 配信サービスのある現在クール作品を見つけられませんでした（本番APIの応答を確認）"
  exit 1
}
echo "対象: 現在クール=${YEAR}/${SEASON} 作品#${CURRENT_ID} / 過去クール作品#${PAST_ID}"

# ── A. SEO用SSRページのHTMLに中身が入っているか（⑦-10の再発検知）──────
echo
echo "A. シーズンページのSSR（/season/${YEAR}/${SEASON}）"
SEASON_HTML=$($CURL "$BASE/season/${YEAR}/${SEASON}")
H1=$(grep -o '<h1' <<<"$SEASON_HTML" | wc -l | tr -d ' ')
LINKS=$(grep -o 'href="/anime/[0-9]*"' <<<"$SEASON_HTML" | sort -u | wc -l | tr -d ' ')
[ "$H1" -ge 1 ]      && ok "<h1> が ${H1} 個"          || fail "<h1> が 0 個（クライアント描画へ退避した疑い）"
# ⑦-10 の修正後の実測は158件。10を下回るならSuspense退避か取得失敗を疑う。
[ "$LINKS" -ge 10 ] && ok "作品ページへのリンクが ${LINKS} 件" \
                     || fail "作品ページへのリンクが ${LINKS} 件しかない（修正後の実測は158件）"

echo
echo "A2. 作品ページのSSR（/anime/${CURRENT_ID}）"
CUR_HTML=$($CURL "$BASE/anime/${CURRENT_ID}")
CH1=$(grep -o '<h1' <<<"$CUR_HTML" | wc -l | tr -d ' ')
[ "$CH1" -ge 1 ] && ok "<h1> が ${CH1} 個" || fail "<h1> が 0 個"

# ── B/C. 放送終了作品の表現（⑰）───────────────────────────────
echo
echo "B. 放送終了作品の表現（/anime/${PAST_ID}）"
PAST_HTML=$($CURL "$BASE/anime/${PAST_ID}")
want    "$PAST_HTML" "の配信情報があるのは" "事実（配信情報がある）だけを述べている"
wantnot "$PAST_HTML" "で視聴できます"       "現在形の断定をしていない"
wantnot "$PAST_HTML" "もう配信されていません" "逆向きの未確認の断定もしていない"
want    "$PAST_HTML" "配信情報の取得日"     "取得日と書いている（確認日ではない）"
wantnot "$PAST_HTML" "配信情報の確認日"     "「確認日」と書いていない"
want    "$PAST_HTML" "の配信先を貼る"       "埋め込みの案内が出ている"

echo
echo "C. 放送中作品の表現（/anime/${CURRENT_ID}）"
# B が「サイト全体から文字列が消えただけ」でも通ってしまうのを防ぐ対の検査。
want    "$CUR_HTML" "で視聴できます"        "放送中の作品には従来どおり断定形が出ている"
wantnot "$CUR_HTML" "の配信情報があるのは"  "放送中の作品に終了作品向けの表現が出ていない"

# ── D. 埋め込み（他人のサイトで表示される）──────────────────────
echo
echo "D. 埋め込み（/embed/anime/${PAST_ID}）"
EMBED_HTML=$($CURL "$BASE/embed/anime/${PAST_ID}")
wantnot "$EMBED_HTML" "<script" "<script> を含まない"
want    "$EMBED_HTML" "ref=embed" "リンクに ?ref=embed が付いている"
# リンク先は自サイト配下だけ（アフィリエイトリンクを他人のサイトに撒かない）。
EXTERNAL=$(grep -o 'href="[^"]*"' <<<"$EMBED_HTML" \
  | sed 's/^href="//; s/"$//' \
  | grep -v "^${BASE}" || true)
if [ -z "$EXTERNAL" ]; then
  ok "リンク先が全て自サイト配下"
else
  fail "自サイト外へのリンクがある: $(tr '\n' ' ' <<<"$EXTERNAL")"
fi

# ── E. 公開API（⑰）─────────────────────────────────────────
echo
echo "E. 公開API（/api/work/{id}）"
PAST_JSON=$($CURL "$BASE/api/work/${PAST_ID}")
CUR_JSON=$($CURL "$BASE/api/work/${CURRENT_ID}")
PAST_STATUS=$($PICK airing-status <<<"$PAST_JSON")
CUR_STATUS=$($PICK airing-status <<<"$CUR_JSON")
[ "$PAST_STATUS" = "finished" ] && ok "過去作の airingStatus=finished" \
  || fail "過去作の airingStatus が ${PAST_STATUS}（finished のはず）"
[ "$CUR_STATUS" = "airing" ] && ok "今期作の airingStatus=airing" \
  || fail "今期作の airingStatus が ${CUR_STATUS}（airing のはず）"
# 公開API＝CORS許可が仕様（/developers に明記）。消えると二次利用側が黙って壊れる。
CORS=$($CURL -o /dev/null -D - "$BASE/api/work/${PAST_ID}" \
  | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)
[ -n "$CORS" ] && ok "CORSヘッダあり（${CORS}）" || fail "CORSヘッダが無い（公開APIの仕様）"

# ── F. 索引方針が本番に反映されているか（㉟の再発検知）──────────────
#
# 「今年のクールは索引に載せる／過去年は出演作の多い声優だけ」という規則
# （lib/personPage.ts の shouldIndexPersonSeasonPage）が本番に出ているかを、
# 本番のHTMLとsitemapから直接確かめる。ソース側の検査では出ていないことが分からない。
#
# 対象の声優はハードコードしない（索引が変わると検査自体が壊れる）。
# 本番のsitemapに /person/{名}/{過去年}/{季} が1件でも載っていれば、それは
# 「閾値を通った＝索引に載せると決めた」ページなので index であるべき。
# 逆に sitemap に載っていない過去年の声優ページは noindex であるべき。
echo
echo "F. 索引方針（過去年の声優ページ）"
SITEMAP=$($CURL "$BASE/sitemap.xml")
THIS_YEAR=$(date -u +%Y)

# sitemapに載っている「過去年」の声優ページを1件取る（今年ぶんは除く）。
INDEXED_PERSON=$(tr ">" "\n" <<<"$SITEMAP" | grep -oE "https?://[^<]*/person/[^<]*" \
  | grep -v "/${THIS_YEAR}/" | head -1)
if [ -n "$INDEXED_PERSON" ]; then
  # **必ずHTTPコードを先に見る**。404にはrobotsメタが無いので、
  # 「noindexでない＝合格」と誤判定してしまう（2026-08-31に実際にすり抜けた）。
  CODE=$($CURL -o /dev/null -w "%{http_code}" "$INDEXED_PERSON")
  H=$($CURL "$INDEXED_PERSON")
  if [ "$CODE" != "200" ]; then
    fail "sitemapに載っている過去年の声優ページが ${CODE}: ${INDEXED_PERSON}"
  elif grep -qi 'name="robots"[^>]*content="[^"]*noindex' <<<"$H"; then
    fail "sitemapに載っている過去年の声優ページが noindex: ${INDEXED_PERSON}"
  else
    ok "sitemapに載っている過去年の声優ページは 200＋index（${INDEXED_PERSON##*/person/}）"
  fi
else
  # 過去年ぶんが1件も載っていないのは、規則が「今期のみ」に戻った可能性が高い。
  # 2026-08-25にその粒度で実装して、1.0位・6.6位のページまで落としたことがある。
  fail "sitemapに過去年の声優ページが1件も無い（索引方針が今期のみに戻っていないか）"
fi

# sitemapに載っていない過去年の声優ページが noindex になっていること。
# 対象はリポジトリ同梱の索引から「閾値に届かない人」を1人選ぶ（本番には依存しない）。
THIN_PERSON=$(node -e '
const fs=require("fs");
const idx=JSON.parse(fs.readFileSync("content/archive/people.json","utf8")).people;
const src=fs.readFileSync("lib/personPage.ts","utf8");
const m=src.match(/PERSON_PAGE_INDEX_MIN_TOTAL_WORKS\s*=\s*(\d+)/);
const th=m?Number(m[1]):50;
const year=new Date().getUTCFullYear();
const cour=new Map();
for(const [n,ws] of Object.entries(idx)) for(const w of ws){const k=n+"|"+w[2]+"|"+w[3];cour.set(k,(cour.get(k)||0)+1);}
for(const [k,c] of cour){const [n,y,s]=k.split("|");
  if(c>=2 && Number(y)<year && (idx[n]||[]).length<th){
    process.stdout.write("/person/"+encodeURIComponent(n)+"/"+y+"/"+s); break; }}
')
if [ -n "$THIN_PERSON" ]; then
  H=$($CURL "${BASE}${THIN_PERSON}")
  if grep -qi 'name="robots"[^>]*content="[^"]*noindex' <<<"$H"; then
    ok "閾値に届かない過去年の声優ページは noindex（${THIN_PERSON##*/person/}）"
  else
    fail "閾値に届かない過去年の声優ページが index のまま: ${THIN_PERSON}（対応が本番に出ていない可能性）"
  fi
  # sitemapにも載っていないこと（ページ側とsitemapがズレると noindex のURLを申告することになる）。
  if grep -q "${THIN_PERSON}<" <<<"$SITEMAP"; then
    fail "noindexのページをsitemapが申告している: ${THIN_PERSON}"
  else
    ok "noindexのページはsitemapにも無い"
  fi
else
  ok "閾値に届かない過去年の声優が索引に居ない（検査対象なし）"
fi

# 次クールが載っていること（㉟。需要の山は年4回しか来ない）。
NEXT_SEASON=$(node -e '
const order=["winter","spring","summer","autumn"];
const now=new Date();
const m=now.getUTCMonth()+1;
const cur=m<=3?"winter":m<=6?"spring":m<=9?"summer":"autumn";
const i=order.indexOf(cur);
const y=now.getUTCFullYear();
process.stdout.write(i===3?(y+1)+"/winter":y+"/"+order[i+1]);
')
if grep -q "/season/${NEXT_SEASON}<" <<<"$SITEMAP"; then
  ok "次クール（${NEXT_SEASON}）がsitemapに載っている"
else
  fail "次クール（${NEXT_SEASON}）がsitemapに無い（9月・12月・3月・6月の山を逃す）"
fi

# ── G. sitemapに載せたURLが200を返すか（㊱の再発検知）────────────────
#
# 面ごとに1件ずつ抜き取って叩く。**日本語名を必ず含める**（2026-08-31の障害は
# 非ASCIIの名前だけに出たので、ASCII名だけ見ていると全て緑になる）。
echo
echo "G. sitemapのURLが生きているか"
for KIND in person director studio anime season; do
  # 日本語名（パーセントエンコードを含む）を優先して選ぶ。無ければ何でもよい。
  URL=$(tr ">" "\n" <<<"$SITEMAP" | grep -oE "https?://[^<]*/${KIND}/[^<]*" \
    | grep "%E" | head -1)
  [ -z "$URL" ] && URL=$(tr ">" "\n" <<<"$SITEMAP" \
    | grep -oE "https?://[^<]*/${KIND}/[^<]*" | head -1)
  if [ -z "$URL" ]; then
    fail "sitemapに /${KIND}/ のURLが1件も無い"
    continue
  fi
  CODE=$($CURL -o /dev/null -w "%{http_code}" "$URL")
  if [ "$CODE" = "200" ]; then
    ok "/${KIND}/ が200（${URL##*/${KIND}/}）"
  else
    fail "sitemapに載せた /${KIND}/ が ${CODE}: ${URL}"
  fi
done
echo
if [ "$NG" -gt 0 ]; then
  echo "NG ${NG} 件。docs/operations.md の ⑦-10 / ⑯ / ⑰ / ㉟ / ㊱ を確認してください。"
  exit 1
fi
echo "全て OK"
