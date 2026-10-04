#!/usr/bin/env bash
# 現在クール＋次クールを「古くして、そのあと温める」バッチ（2026-10-01導入・重大度高）。
# .github/workflows/revalidate.yml が1日2回これを呼ぶ。
#
# 【なぜ温めが要るか】
# revalidatePath / revalidateTag は Vercel では対象を**消す**（staleにして裏で作り直すのでは
# ない）。アクセスが薄いサイトでは消えたまま数時間残り、**次に来た1人がその場生成の全額を
# 払う**。2026-10-01の本番計測で今期の4面の初回が33.8〜39.9秒になり、同じ計測の中で
# 消去対象に入っていない唯一の今期面（/service/[key]/[年]/[季節]）だけが0.77秒だった
# ＝対照群が成立している。経緯は docs/operations.md の[61]。
#
# 【YAMLに書かずスクリプトに置く理由】
# このスクリプトは「温めが効いていない」ことを検知して落ちる＝**検査**でもある。
# シェルの検査は「NGを出さなくなる」方向に壊れると毎日緑のまま無力化するので、
# scripts/verify-production.sh と同じく回帰テスト（scripts/check-warm-revalidated.js）を
# 付けられる形にしておく。YAMLの run: に書くと子プロセスとして実行できずテストが書けない。
#
# 【jq は使わない】（verify-production.sh と同じ理由）
# jq は GitHub Actions の ubuntu には入っているが Windows の開発機には無く、
# 「CIは緑なのに手元では必ず失敗する」状態を一度作っている。Node はこのリポジトリの
# 前提そのものなので scripts/lib/json-pick.js に寄せる。
#
# 環境変数:
#   BASE        … 本番のオリジン（既定は公開URL）
#   CRON_SECRET … /api/revalidate の x-cron-secret（未設定なら窓口が401を返す＝落ちる）
#
# 終了コード: 0＝全部温まった / 1＝1つ以上失敗（GitHub Actions の ::error:: も出す）

# -f はグロブ展開を止める。温め先のURLには `?` が入り、`?` はシェルのワイルドカードなので、
# たまたま一致するファイルがあると化ける。
set -u -f

BASE="${BASE:-https://animedia-khaki.vercel.app}"
BASE="${BASE%/}"
CRON_SECRET="${CRON_SECRET:-}"
PICK="node $(dirname "$0")/lib/json-pick.js"

# 窓口自身が今期のライブ取得を通るので、1クールで数十秒かかりうる。
POST_MAX_TIME="${POST_MAX_TIME:-120}"
WARM_MAX_TIME="${WARM_MAX_TIME:-180}"
HEAD_MAX_TIME="${HEAD_MAX_TIME:-60}"

FAILED=0
fail() { echo "::error::$*"; echo "  NG   $*"; FAILED=1; }
ok()   { echo "  OK   $*"; }

echo "再検証と温め: $BASE"

# **current → next の順は変えないこと。**
# 共有のキャッシュタグ（検索索引の "annict"）は今期と次クールが同じ1枚を使うため、
# 窓口は scope=current のときだけそれを古くする（app/api/revalidate/route.ts）。
# 逆順にすると2回目の古くしで1回目に温めたぶんが冷える。
# （クールのデータは2026-10-04からクールごとのタグ＝対象クールしか消さない。docs/operations.md の[63]）
for SCOPE in current next; do
  echo "── ${SCOPE} ──"

  # ① 消す（窓口が「温める先」も返す）
  BODY="$(mktemp)"
  STATUS="$(curl -s -X POST \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -o "$BODY" -w "%{http_code}" --max-time "$POST_MAX_TIME" \
    "${BASE}/api/revalidate?scope=${SCOPE}")"
  if [ "$STATUS" != "200" ]; then
    fail "再検証に失敗しました（scope=${SCOPE} status=${STATUS}）"
    rm -f "$BODY"
    continue
  fi
  ok "再検証した（scope=${SCOPE}）"

  # 温め先は**すべて応答から取る**（ここにパスもクール名も書かない。
  # 書き写すと、クールが変わった日に古い面を温め続ける）。
  DATA_URLS="$($PICK warm-data "$BODY")"
  PAGE_PATHS="$($PICK warm-pages "$BODY")"
  rm -f "$BODY"
  if [ -z "$PAGE_PATHS" ]; then
    fail "温める先が返ってきませんでした（scope=${SCOPE}）。応答に warm.pages が無い"
    continue
  fi

  # ② データ層を先に温める（ページ側の温めが軽くなる）。
  #
  # /api/season は s-maxage 付き＝**そのまま叩くと関数が走らずCDNから返り、データ層が
  # 温まらない**（成功と出るのに何もしていない、という最悪の形）。毎回違うクエリを足して
  # 必ず関数を走らせる（窓口は year / season しか読まない）。
  # 窓口が返すURLは必ず `?` を含む（app/api/revalidate/route.ts の warm.data）。
  STAMP="$(date +%s)"
  for u in $DATA_URLS; do
    S="$(curl -s -o /dev/null -w "%{http_code}" --max-time "$WARM_MAX_TIME" \
      "${BASE}${u}&_warm=${STAMP}")"
    if [ "$S" != "200" ]; then
      fail "データ層を温められませんでした（${u} status=${S}）"
    else
      ok "データ層を温めた（${u}）"
    fi
  done

  # ③ ページを温める → **もう1回取って温まったか確認する**。
  #
  # x-vercel-cache が答える:
  #   hit / stale / prerender … キャッシュから配った＝訪問者は待っていない
  #   miss / bypass           … キャッシュに無く、その場で作って待たせた
  # ここを見ないと「温めたつもりで効いていない」を黙って通す。
  for p in $PAGE_PATHS; do
    S="$(curl -s -o /dev/null -w "%{http_code}" --max-time "$WARM_MAX_TIME" "${BASE}${p}")"
    if [ "$S" != "200" ]; then
      fail "温められませんでした（${p} status=${S}）"
      continue
    fi
    CACHE="$(curl -s -o /dev/null -D - --max-time "$HEAD_MAX_TIME" "${BASE}${p}" \
      | tr -d '\r' | awk 'tolower($1)=="x-vercel-cache:"{print tolower($2)}' | tail -1)"
    case "$CACHE" in
      hit|stale|prerender) ok "温まった（${p} x-vercel-cache=${CACHE}）" ;;
      *)
        fail "温めが効いていません（${p} x-vercel-cache=${CACHE:-なし}）。訪問者がその場生成を待つ状態が残っています"
        ;;
    esac
  done
done

if [ "$FAILED" -ne 0 ]; then
  echo "再検証と温め: NGあり"
  exit 1
fi
echo "再検証と温め: 全てOK"
