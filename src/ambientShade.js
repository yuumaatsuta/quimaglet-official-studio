// 隅・奥・接地面の暗がり（環境光の遮蔽）を、材質の中で形から計算して足す。
// 部屋の光（窓の面光源・半球光・環境マップ）は影を落とさないので、そのままだと
// 壁と床の角、棚の下の壁、升目の奥、本の足元まで同じ明るさになり、物が浮いて見える。
// 部屋と棚の形は決まっているので、画素の位置と面の向きから、近くの面までの距離を出して光を減らす
// （影を描く処理は増えない）。座標は部屋（ワールド）の座標

// 材質の光の計算の最後に、shade(p, n) の値（0〜1）を掛ける
function addShade(material, key, glsl, uniforms = {}) {
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShadePos;\nvarying vec3 vShadeNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 sp = vec4(transformed, 1.0);
          vec3 sn = objectNormal;
          #ifdef USE_INSTANCING
            sp = instanceMatrix * sp;
            sn = mat3(instanceMatrix) * sn;
          #endif
          vShadePos = (modelMatrix * sp).xyz;
          vShadeNormal = mat3(modelMatrix) * sn;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vShadePos;\nvarying vec3 vShadeNormal;\n${glsl}`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        {
          float sh = shade(vShadePos, normalize(vShadeNormal));
          reflectedLight.directDiffuse *= sh;
          reflectedLight.directSpecular *= sh * sh;
          reflectedLight.indirectDiffuse *= sh;
          reflectedLight.indirectSpecular *= sh * sh; // 暗がりには部屋も映らない
        }`,
      );
  };
  return material;
}

const f = (v) => v.toFixed(5);

// 部屋の躯体（コンクリートの壁・天井・床）。
//   room: { x0, x1, z0, z1, y1 }：左右の壁・奥の壁と手前・天井の高さ（床は 0）。右は窓なので数えない
//   block: { x0, x1, y0, y1, top }：左の壁の出っ張り（コンクリートの棚と、その上の木の棚）。
//     x1 が出の先端、y0 がコンクリートの棚の下面、y1 が木の棚の上面、top より手前（z > top）には木の棚がない
//   occluders: { min, max, strength }：大きな物（ソファ・タワー）の外形。uniform（{ value: 配列 }）で渡す。
//     周りの床と壁を、物に近いほど・物の方を向いている面ほど暗くする。strength は Vector2（x: 床、y: 壁）
export function addRoomShade(material, { room: r, block: b, occluders: o }) {
  const n = o.min.value.length;
  return addShade(
    material,
    'roomShade',
    `uniform vec3 occMin[${n}];
    uniform vec3 occMax[${n}];
    uniform vec2 occStrength[${n}];
    float shade(vec3 p, vec3 n) {
      if (p.x < ${f(r.x0 - 0.01)} || p.x > ${f(r.x1 + 0.01)} || p.z < ${f(r.z0 - 0.01)} || p.z > ${f(r.z1 + 0.01)}
        || p.y < -0.01 || p.y > ${f(r.y1 + 0.01)}) return 1.0;
      // 壁と床・天井の合わさる角。自分が載っている面の向きの面は数えない
      float c = (1.0 - abs(n.x)) * exp(-(p.x - ${f(r.x0)}) / 0.5)
              + (1.0 - abs(n.z)) * exp(-(p.z - ${f(r.z0)}) / 0.5)
              + (1.0 - abs(n.y)) * exp(-p.y / 0.5)
              + (1.0 - abs(n.y)) * exp(-(${f(r.y1)} - p.y) / 0.5);
      float s = 1.0 / (1.0 + 0.9 * c);
      // 左の壁の出っ張りの下と上の壁。出っ張りが上（下）からの光を遮る
      if (n.x > 0.5 && p.x < ${f(b.x0 + 0.01)}) {
        float below = ${f(b.y0)} - p.y;
        if (below > 0.0) s *= 1.0 - 0.72 * exp(-below / 0.3);
        float above = p.y - ${f(b.y1)};
        if (above > 0.0 && p.z < ${f(b.top)}) s *= 1.0 - 0.5 * exp(-above / 0.15);
      }
      // 出っ張りの下面。壁際ほど暗い
      if (n.y < -0.5 && p.x < ${f(b.x1 + 0.01)} && abs(p.y - ${f(b.y0)}) < 0.01) {
        s *= mix(0.35, 0.6, clamp((p.x - ${f(b.x0)}) / ${f(b.x1 - b.x0)}, 0.0, 1.0));
      }
      // 大きな物の周り。物のいちばん近い点までの距離で、背の高い物ほど遠くまで暗くする
      for (int i = 0; i < ${n}; i++) {
        float k = n.y > 0.5 ? occStrength[i].x : occStrength[i].y;
        if (k <= 0.0) continue;
        vec3 v = clamp(p, occMin[i], occMax[i]) - p;
        float d = length(v);
        if (d < 0.004) continue; // 物の真下・物の中
        float facing = clamp(dot(n, v / d) * 0.5 + 0.5, 0.0, 1.0);
        float reach = 0.12 + 0.3 * min(occMax[i].y - occMin[i].y, 2.0);
        s *= 1.0 - k * facing * exp(-d / reach);
      }
      return s;
    }`,
    { occMin: o.min, occMax: o.max, occStrength: o.strength },
  );
}

// 升目棚の、升目の奥・隅・本の足元の暗がり。棚板・仕切り・背板・本の材質に付ける
//   shelf: { front, back, y0, y1, rows, rowPitch, z0, z1, colPitch, t, contact }
//     front/back: 棚の前端・背板の前面の x、y0/y1: 棚の下端・上端、z0/z1: 両端、
//     rowPitch/colPitch: 棚板・仕切りの間隔（中心どうし）、t: 板厚、
//     contact: { value: テクスチャ }：棚板の上の、本が接している所（棚の段ごとに縦に並べる。studioRoom.js の shelfContactTexture）
export function addShelfShade(material, s) {
  return addShade(
    material,
    'shelfShade',
    `uniform sampler2D shelfContact;
    // 板の面までの距離（板の中にいるときは大きな値）
    float shelfGap(float v, float start, float pitch) {
      float k = (v - start) / pitch;
      float d = abs(k - floor(k + 0.5)) * pitch - ${f(s.t / 2)};
      return d < -0.001 ? 1.0 : max(d, 0.0);
    }
    float shade(vec3 p, vec3 n) {
      float depth = ${f(s.front)} - p.x; // 入口からの深さ
      if (depth < 0.0 || p.y < ${f(s.y0 + s.t * 0.5)} || p.y > ${f(s.y1 - s.t * 0.5)}
        || p.z < ${f(s.z0 + s.t * 0.5)} || p.z > ${f(s.z1 - s.t * 0.5)}) return 1.0;
      float full = ${f(s.front - s.back)};
      // 奥ほど、部屋の見える範囲（升目の口）が狭くなる
      float ao = 1.0 - 0.68 * pow(clamp(depth / full, 0.0, 1.0), 0.75);
      // 板の合わさる隅。自分が載っている面の向きの板は数えない
      float dy = shelfGap(p.y, ${f(s.y0 + s.t / 2)}, ${f(s.rowPitch)});
      float dz = shelfGap(p.z, ${f(s.z0 + s.t / 2)}, ${f(s.colPitch)});
      float dx = max(p.x - ${f(s.back)}, 0.0);
      float corner = (1.0 - abs(n.y)) * exp(-dy / 0.035)
                   + (1.0 - abs(n.z)) * exp(-dz / 0.035)
                   + (1.0 - abs(n.x)) * exp(-dx / 0.045);
      // 入口近くは部屋の光が回り込むので、隅の暗がりは浅い
      corner *= mix(0.25, 1.0, smoothstep(0.0, 0.12, depth));
      float sh = ao * (1.0 - 0.6 * min(corner, 1.0));

      // 棚板に接する所（本の背の下端・仕切りの足元）は、入口でも暗い
      float k = (p.y - ${f(s.y0 + s.t / 2)}) / ${f(s.rowPitch)};
      float aboveBoard = (k - floor(k)) * ${f(s.rowPitch)} - ${f(s.t / 2)};
      if (aboveBoard > -0.001) sh *= 1.0 - 0.45 * (1.0 - abs(n.y)) * exp(-max(aboveBoard, 0.0) / 0.012);
      // 棚板の上の、本の足元の影
      if (n.y > 0.5 && aboveBoard < 0.003) {
        float row = floor(k + 0.5);
        vec2 uv = vec2((p.z - ${f(s.z0)}) / ${f(s.z1 - s.z0)}, (row + clamp(depth / full, 0.0, 1.0)) / ${f(s.rows)});
        sh *= 1.0 - 0.75 * texture2D(shelfContact, uv).r;
      }
      return sh;
    }`,
    { shelfContact: s.contact },
  );
}
