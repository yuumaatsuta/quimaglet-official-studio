import * as THREE from 'three';

// obj 以下のメッシュをすべて hotspot `id` として登録する。
// ホバー時の発光を家具ごとに独立させるため、マテリアルは複製しておく。
export function tagHotspot(map, id, obj) {
  obj.traverse((child) => {
    child.userData.hotspotId = id;
    if (child.isMesh && !child.userData.noHighlight) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m) => m.clone())
        : child.material.clone();
    }
  });
  map.set(id, obj);
}

const CLICK_SLOP = 8; // px。これ以上動いたらドラッグとみなす

export function createHotspots({ camera, root, hotspots, sections, tooltip, highlightColor, onSelect }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const accent = new THREE.Color(highlightColor);
  const states = new Map();

  for (const [id, obj] of hotspots) {
    const materials = [];
    obj.traverse((child) => {
      if (!child.isMesh || child.userData.noHighlight) return;
      for (const mat of [child.material].flat()) {
        if (!mat.emissive) continue;
        materials.push({ mat, base: mat.emissive.clone(), baseIntensity: mat.emissiveIntensity });
      }
    });
    states.set(id, { amount: 0, materials, obj });
  }

  let hovered = null;
  let enabled = true;
  let pointer = null; // 最後のマウス位置
  let down = null;

  function pick(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(root, true).find((h) => !h.object.userData.noPick);
    return hit?.object.userData.hotspotId ?? null;
  }

  function setHovered(id) {
    if (id === hovered) return;
    hovered = id;
    document.body.style.cursor = id ? 'pointer' : '';
    tooltip.hidden = !id || !!hotspots.get(id)?.userData.noTooltip;
    if (id) tooltip.textContent = sections[id]?.label ?? hotspots.get(id)?.userData.hotspotLabel ?? id;
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer = { x: e.clientX, y: e.clientY };
    tooltip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  });

  addEventListener('pointerdown', (e) => {
    if (e.target.tagName !== 'CANVAS') return;
    down = { x: e.clientX, y: e.clientY };
  });

  addEventListener('pointerup', (e) => {
    if (!down || !enabled) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_SLOP) return;
    const id = pick(e.clientX, e.clientY);
    if (id) onSelect(id);
  });

  return {
    setEnabled(value) {
      enabled = value;
      if (!value) setHovered(null);
    },
    update(dt) {
      if (enabled && pointer) setHovered(pick(pointer.x, pointer.y));

      const k = 1 - Math.exp(-dt * 10);
      for (const [id, s] of states) {
        s.amount += ((id === hovered ? 1 : 0) - s.amount) * k;
        // hoverScale: ホバーで少し大きくする（光らせても目立たない物。壁の落書きなど）
        const grow = s.obj.userData.hoverScale;
        if (grow) s.obj.scale.setScalar(1 + s.amount * grow);
        for (const m of s.materials) {
          m.mat.emissive.copy(m.base).lerp(accent, s.amount * 0.3);
          m.mat.emissiveIntensity = m.baseIntensity + s.amount * 0.6;
        }
      }
    },
  };
}
