// 重い準備の合間に、いったんブラウザへ順番を返す（読み込み画面の表示や入力を止めないため）。
// 1 回の処理が長いと、その間は画面が固まる。区切って待てば、間に画面を描ける
export function nextTask() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
