# モデル（GLB）とテクスチャを軽くする（Blender で動かす）。
#
#   blender -b --factory-startup --python tools/compress-models.py -- model  元.glb 先.glb [三角形の数]
#   blender -b --factory-startup --python tools/compress-models.py -- texture 元.png 先.webp
#
# model:   頂点を Draco で圧縮し、中の画像を WebP（品質 90）にする。材質・階層は変えない。
#          サイトは src/gltf.js の DRACOLoader で展開する。
#          三角形の数を渡すと、その数まで減らす（形やテクスチャがよれるので、なるべく使わない。
#          ブラウン管のタワーは減らさずに圧縮だけしている）
# texture: 色・ラフネスは WebP（品質 90）、ノーマルマップ（名前に normal）は可逆の WebP
#          （ノーマルマップを非可逆にすると、凹凸の陰影がずれる）。
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
mode, src, dst = args[:3]
bpy.ops.wm.read_factory_settings(use_empty=True)

if mode == 'model':
    bpy.ops.import_scene.gltf(filepath=src)
    if len(args) > 3:
        for o in [x for x in bpy.data.objects if x.type == 'MESH']:
            bpy.context.view_layer.objects.active = o
            m = o.modifiers.new('decimate', 'DECIMATE')
            m.ratio = min(1, int(args[3]) / len(o.data.polygons))
            bpy.ops.object.modifier_apply(modifier='decimate')
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=10,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=12,
        export_draco_texcoord_quantization=14,
        export_image_format='WEBP',
        export_image_quality=90,
        export_yup=True,
        export_apply=True,
    )
elif mode == 'texture':
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = 100 if 'normal' in src else 90  # 100 は可逆
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = 'Non-Color'  # 色を変換せず、値をそのまま書く
    img.save_render(dst, scene=sc)
