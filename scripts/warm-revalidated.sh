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
# 温まったかの確認は**1回で判定しない**（2026-10-04・重大度高）。最大 VERIFY_TRIES 回、
# 待ちを VERIFY_WAIT 秒から倍々に延ばして取り直す。理由は下の③のコメント。
# 差し替えてよいのはこの2つの**数値だけ**（回帰テストは待ちを0にする）。判断の分岐は
# テストと本番で同じ経路を通す（CLAUDE.md の基本ルール「スタブ用の抜け道を本番に残さない」）。
VERIFY_TRIES="${VERIFY_TRIES:-4}"
VERIFY_WAIT="${VERIFY_WAIT:-3}"

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

  # ③ ページを温める → **温まったか確認する**。
  #
  # 確かめたいのは「**次に来た訪問者がキャッシュから受け取れるか**」。x-vercel-cache が
  # hit / stale / prerender なら、その応答はキャッシュから出ている＝もう温まっている。
  #
  # 【2026-10-04・1回で判定しない】導入時は温めた直後に1回だけ取り直して判定していたが、
  # #198 のマージ後に**4回続けて落ちた**。中身を分けると、
  #   ・`/rankings/2027/winter`・`/exclusive/2027/winter`（次クール）が4回中3回 `miss`
  #     ……ところがローカルの本番ビルドでは同じページが MISS → HIT → HIT と正しく
  #     キャッシュされる（`s-maxage=21600`）。アプリ側は正しく、**作り直した直後の
  #     取り直しが Vercel のエッジでまだ反映されていない**形。
  #   ・`/` が `revalidated`（許可リストに無い値）……この値は、一度も消していない
  #     完全静的なページ（/about・/privacy・/studio）の初回にも出る（2026-10-03/04の
  #     速度計測の `cacheFirst`）。「その場生成した」とは言い切れない値。
  # だから「温まるまで短く待って何回か取り直し、キャッシュから出るようになったか」で
  # 判定する。**何度待っても miss / revalidated のままなら従来どおり落とす**
  # （本当にキャッシュされないページを黙って通さない）。
  for p in $PAGE_PATHS; do
    S="$(curl -s -o /dev/null -w "%{http_code}" --max-time "$WARM_MAX_TIME" "${BASE}${p}")"
    if [ "$S" != "200" ]; then
      fail "温められませんでした（${p} status=${S}）"
      continue
    fi
    CACHE=""
    CC=""
    TRIES=0
    WAIT="$VERIFY_WAIT"
    while :; do
      TRIES=$((TRIES + 1))
      HDRS="$(curl -s -o /dev/null -D - --max-time "$HEAD_MAX_TIME" "${BASE}${p}" | tr -d '\r')"
      CACHE="$(printf '%s\n' "$HDRS" | awk 'tolower($1)=="x-vercel-cache:"{print tolower($2)}' | tail -1)"
      CC="$(printf '%s\n' "$HDRS" | awk 'tolower($1)=="cache-control:"{sub(/^[^:]*:[ \t]*/, ""); print}' | tail -1)"
      case "$CACHE" in hit|stale|prerender) break ;; esac
      [ "$TRIES" -ge "$VERIFY_TRIES" ] && break
      sleep "$WAIT"
      WAIT=$((WAIT * 2))
    done
    case "$CACHE" in
      hit|stale|prerender) ok "温まった（${p} x-vercel-cache=${CACHE}・確認${TRIES}回目）" ;;
      *)
        # cache-control も出す。待っても温まらない理由が「エッジへの反映待ち」なのか
        # 「ページが動的描画になっていて、そもそもキャッシュされない」なのかで直し方が
        # まったく違い、後者は温めでは直らない（ページ側で動的になった原因を探す）。
        HINT=""
        case "$CC" in
          *no-store*|*private*) HINT="応答がキャッシュ不可（動的描画）＝温めでは直らない。ページが動的になった原因を探すこと。" ;;
        esac
        fail "温めが効いていません（${p} x-vercel-cache=${CACHE:-なし}・cache-control=${CC:-なし}・${TRIES}回確認しても温まらない）。${HINT}訪問者がその場生成を待つ状態が残っています"
        ;;
    esac
  done
done

if [ "$FAILED" -ne 0 ]; then
  echo "再検証と温め: NGあり"
  exit 1
fi
echo "再検証と温め: 全てOK"
