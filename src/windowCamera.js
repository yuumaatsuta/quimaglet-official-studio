// 画面を「部屋をのぞく窓」に見立てるための off-axis projection。
// 窓は z = bounds.windowZ（既定 0）の平面上にあり、部屋は奥の -z 側に広がっている前提。
// 窓を部屋の途中に置くと、そこより手前は目の後ろ側になり映らない。

// 部屋の開口部（幅×高さ）に収まるよう、画面の縦横比に合わせて窓の大きさを決める
// eyeHeight を渡すと、窓の中心をその高さに寄せる（開口部からはみ出さない範囲で）
export function fitWindow(bounds, aspect, crop, eyeHeight) {
  let halfW = (bounds.width / 2) * crop;
  let halfH = halfW / aspect;
  const maxHalfH = (bounds.height / 2) * crop;
  if (halfH > maxHalfH) {
    halfH = maxHalfH;
    halfW = halfH * aspect;
  }
  const bottom = bounds.floorY;
  const top = bounds.floorY + bounds.height;
  const cy = eyeHeight === undefined ? (bottom + top) / 2 : bottom + eyeHeight;
  // 窓が開口部そのもの（z = 0）のときだけ、床や天井の外が映らないよう窓を内側に収める。
  // 窓が部屋の途中にあれば、その上下も部屋の中なので目の高さを優先する
  const inside = (bounds.windowZ ?? 0) < 0;
  return {
    cx: bounds.centerX,
    cy: inside ? cy : Math.min(top - halfH, Math.max(bottom + halfH, cy)),
    cz: bounds.windowZ ?? 0,
    halfW,
    halfH,
  };
}

// 目の位置 eye（窓より手前）から窓の四隅を通る非対称な視錐台を作る。
// カメラは回転させず、射影行列だけをずらすので、窓の縁が画面の縁に固定される。
export function updateWindowCamera(camera, eye, win) {
  const n = camera.near;
  const d = Math.max(eye.z - win.cz, n * 1.01);
  const left = (n * (win.cx - win.halfW - eye.x)) / d;
  const right = (n * (win.cx + win.halfW - eye.x)) / d;
  const bottom = (n * (win.cy - win.halfH - eye.y)) / d;
  const top = (n * (win.cy + win.halfH - eye.y)) / d;

  camera.position.copy(eye);
  camera.quaternion.identity();
  camera.updateMatrixWorld();
  camera.projectionMatrix.makePerspective(left, right, top, bottom, n, camera.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
