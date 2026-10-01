// 「無くてもページが成立する取得」に時間上限を付ける共通部品（2026-10-01導入・重大度高）。
//
// 【なぜ必要になったか】
// 2026-10-01の本番計測で、今期の4面の初回が33.8〜39.9秒かかった（TTFBは234〜250msで正常、
// 待ちは全部HTML本文の側＝App Routerはストリーミングで返すので、その場生成の待ちは
// responseStart には出ない。scripts/lib/measure-page.js の注記）。
// 内訳は「今期のクール一括取得（lib/getSeasonData.ts）が作品数に比例した往復を含む」こと。
// 同じ計測の中で、/api/revalidate の消去対象に入っていない唯一の今期面
// （/service/[key]/[年]/[季節]）だけが0.77秒だった＝対照群が成立している。
//
// 【この部品の役割】
// 作品ページ（app/anime/[id]/page.tsx）は、本文に要らない付随情報（声優リンクの可否判定と
// 関連作品）のためだけにクール全体を取っていた。つまり**作品1枚のコールドコストが
// クール全体と同額**で、作品数が増えるほど悪化する形だった。
// 付随情報は取得に失敗しても省略してよい（元から try/catch で握っている）ので、
// 「失敗」と同じ扱いで**間に合わなかったとき**にも諦められるようにする。
//
// 【外さないこと】
// 上限を外すと、画面は1ピクセルも変わらないまま作品ページの初回だけが数十秒に戻る。
// 増えるのは待ち時間とFluid Active CPUだけで、**画面を見ても気づけない**。
// 逆戻りは `node scripts/check.ts` の「クール全体の取得に時間上限がある」節が禁じる。
//
// 返り値は「間に合わなかった／失敗した」をどちらも `null` にする（呼び出し側は
// どちらでも同じ劣化を選ぶため、区別する意味が無い）。
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 元の promise の失敗を**必ず拾う**（拾わないと、上限を先に迎えた回で
  // unhandled rejection になりサーバーのログが汚れる／実行環境によっては落ちる）。
  const settled = p.catch(() => null);
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([settled, timeout]).finally(() => {
    // タイマーを残すとサーバーレス関数の凍結が上限ぶん遅れる（I/O待ちと違い
    // Active CPU には出ないが、応答を返したあとも関数が生きる）。
    if (timer !== undefined) clearTimeout(timer);
  });
}

// 付随情報の取得に許す時間。
// **本文に要る取得には使わない**（一覧ページの中身そのものは諦められない）。
// 200msでは温まったキャッシュの読み出し（実測で数十ms）に対して余裕が無く、
// 2000msでは目標（LCP 2秒未満）をこれ単独で使い切る。その間を採る。
export const INCIDENTAL_FETCH_TIMEOUT_MS = 800;
