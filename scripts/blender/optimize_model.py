# 重い OBJ（Tripo などの生成モデル）を Web 用の軽い GLB に変換する。
#
#   blender -b -P scripts/blender/optimize_model.py -- 入力.obj 出力.glb [目標ポリゴン数] [テクスチャ px]
#
# - ポリゴンを目標数まで減らす（Decimate / Collapse）
# - テクスチャを縮小して JPEG で埋め込む
# - 位置・回転・大きさはそのまま（配置はサイト側で行う）

import glob
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst = argv[0], argv[1]
target_tris = int(argv[2]) if len(argv) > 2 else 60000
tex_size = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for obj in meshes:
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    ratio = min(1.0, target_tris / max(tris, 1))
    print(f"[optimize] {obj.name}: {tris} tris -> ratio {ratio:.4f}")
    if ratio < 1.0:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[optimize] {obj.name}: now {tris} tris")

# MTL の PBR 指定は読み込まれないことがあるので、OBJ と同じフォルダの
# *basecolor* / *roughness* / *metallic* / *normal* からマテリアルを組み直す
def find_texture(keyword):
    for path in glob.glob(os.path.join(os.path.dirname(os.path.abspath(src)), "*")):
        name = os.path.basename(path).lower()
        if keyword in name and name.rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp"):
            return path
    return None


def build_material():
    mat = bpy.data.materials.new("model")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    def image_node(path, non_color):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(path)
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        return node

    if path := find_texture("basecolor"):
        links.new(image_node(path, False).outputs["Color"], bsdf.inputs["Base Color"])
    if path := find_texture("roughness"):
        links.new(image_node(path, True).outputs["Color"], bsdf.inputs["Roughness"])
    if path := find_texture("metallic"):
        links.new(image_node(path, True).outputs["Color"], bsdf.inputs["Metallic"])
    if path := find_texture("normal"):
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(image_node(path, True).outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    print(f"[optimize] material textures: {[i.name for i in bpy.data.images]}")
    return mat


material = build_material()
for obj in meshes:
    obj.data.materials.clear()
    obj.data.materials.append(material)

for img in bpy.data.images:
    if img.size[0] > tex_size or img.size[1] > tex_size:
        print(f"[optimize] image {img.name}: {img.size[0]}x{img.size[1]} -> {tex_size}")
        img.scale(tex_size, tex_size)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_apply=True,
    export_yup=True,
)
print(f"[optimize] wrote {dst}")
