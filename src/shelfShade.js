// 升目棚の、升目の奥と隅の暗がり（環境光の遮蔽）。
// 部屋の光（窓の面光源・半球光・環境マップ）は影を落とさないので、そのままだと升目の奥まで
// 入口と同じ明るさになり、板を並べただけの平たい見た目になる。
// 升目の形は決まっているので、画素の位置から「入口からの深さ」と「近くの板までの距離」を出し、
// 奥ほど・板の合わさる隅ほど光を減らす（影の計算を増やさずに済む）。
// 棚板・仕切り・背板・本の材質に付ける。座標は部屋（ワールド）の座標
//
//   shelf: { front, back, y0, y1, rowPitch, z0, z1, colPitch, t }
//     front/back: 棚の前端・背板の前面の x、y0/y1: 棚の下端・上端、z0/z1: 両端、
//     rowPitch/colPitch: 棚板・仕切りの間隔（中心どうし）、t: 板厚
export function addShelfShade(material, shelf) {
  const s = shelf;
  const f = (v) => v.toFixed(5);
  material.customProgramCacheKey = () => 'shelfShade';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShelfPos;\nvarying vec3 vShelfNormal;')
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
          vShelfPos = (modelMatrix * sp).xyz;
          vShelfNormal = mat3(modelMatrix) * sn;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vShelfPos;
        varying vec3 vShelfNormal;
        // 板の面までの距離（板の中にいるときは大きな値）
        float shelfGap(float v, float start, float pitch) {
          float k = (v - start) / pitch;
          float d = abs(k - floor(k + 0.5)) * pitch - ${f(s.t / 2)};
          return d < -0.001 ? 1.0 : max(d, 0.0);
        }
        float shelfShade(vec3 p, vec3 n) {
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
          return ao * (1.0 - 0.6 * min(corner, 1.0));
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        {
          float sh = shelfShade(vShelfPos, normalize(vShelfNormal));
          reflectedLight.directDiffuse *= sh;
          reflectedLight.directSpecular *= sh * sh;
          reflectedLight.indirectDiffuse *= sh;
          reflectedLight.indirectSpecular *= sh * sh; // 映り込みは奥ほど強く消す（升目の中に部屋は映らない）
        }`,
      );
  };
  return material;
}
