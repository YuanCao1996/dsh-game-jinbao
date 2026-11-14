#!/usr/bin/env python
"""把透明立绘合到纯绿幕上，做成「图生视频」可用的首帧图。

为什么需要这一步：
  图生视频工具（可灵/即梦/Runway…）基本不接受透明背景，直接喂透明 PNG
  出来的是它们自己编的背景（渐变、房间、光斑），抠像会烂。
  先把角色按我们的构图垫在 #00FF00 上，生成出来的动作片才能一张参数抠干净。

用法：
  python make-greenplate.py                              # 用 assets/pet/static.png
  python make-greenplate.py --input 立绘.png --out 首帧
  python make-greenplate.py --ratio both                 # 方形 + 16:9 都出
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

GREEN = (0, 255, 0)
DEFAULT_INPUT = Path(__file__).resolve().parent.parent / 'desktop-release' / 'assets' / 'pet' / 'static.png'
RATIOS = {'1:1': (1024, 1024), '16:9': (1920, 1080), '9:16': (1080, 1920)}


def load_character(path: Path) -> Image.Image:
    image = Image.open(path)
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    bbox = image.getbbox()
    if not bbox:
        raise SystemExit(f'{path} 是全透明的，没有可用的角色像素')
    return image.crop(bbox)


def place(character: Image.Image, canvas_size: tuple[int, int], height_ratio: float, baseline: float) -> Image.Image:
    """按 pipeline.py 同一套构图规则摆位：高度占比 + 脚底基准线，水平居中。"""
    width, height = canvas_size
    target_h = max(1, int(round(height * height_ratio)))
    scale = target_h / character.height
    target_w = max(1, int(round(character.width * scale)))
    resized = character.resize((target_w, target_h), Image.LANCZOS)

    canvas = Image.new('RGB', canvas_size, GREEN)
    left = (width - target_w) // 2
    bottom = int(round(height * baseline))
    top = bottom - target_h
    # 越界就裁，别让角色被贴到画外
    canvas.paste(resized, (left, top), resized)
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default=str(DEFAULT_INPUT))
    ap.add_argument('--out', default='', help='输出前缀；默认 tools/character-pipeline/firstframe/greenplate')
    ap.add_argument('--ratio', default='1:1', choices=['1:1', '16:9', '9:16', 'both'])
    ap.add_argument('--height', type=float, default=0.82, help='角色占画布高度比例（默认 0.82，规格 0.70-0.90）')
    ap.add_argument('--baseline', type=float, default=0.94, help='脚底对齐比例（默认 0.94）')
    args = ap.parse_args()

    src = Path(args.input)
    if not src.is_file():
        raise SystemExit(f'找不到立绘：{src}')
    character = load_character(src)
    print(f'输入 {src.name}  角色裁切后 {character.width}x{character.height}')

    out_prefix = Path(args.out) if args.out else Path(__file__).resolve().parent / 'firstframe' / 'greenplate'
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    ratios = ['1:1', '16:9'] if args.ratio == 'both' else [args.ratio]
    for ratio in ratios:
        size = RATIOS[ratio]
        plate = place(character, size, args.height, args.baseline)
        suffix = '' if len(ratios) == 1 else '-' + ratio.replace(':', 'x')
        target = out_prefix.with_name(out_prefix.name + suffix + '.png')
        plate.save(target)
        print(f'  {ratio:5s} -> {target}  ({size[0]}x{size[1]}, 角色高 {int(size[1]*args.height)}px)')

    print('')
    print('下一步：把这张图作为「首帧」喂给图生视频，提示词见 VIDEO-PROMPTS.md')
    print('生成后：python pipeline.py --input 动作.mp4 --name idle --fps 12 --size 192')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
