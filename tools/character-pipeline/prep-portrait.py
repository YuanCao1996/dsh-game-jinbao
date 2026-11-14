#!/usr/bin/env python
"""把一张立绘整理成形象层能直接用的素材。

为什么需要这一步：
  - AI 出的图边缘常有半透明灰边（alpha 251~253 的雾），缩到 30~40px 会显脏；
  - 全身立绘缩到几十像素看不清，需要一个"头部特写"当小图标；
  - 我们的形象层要的是"紧贴内容的透明图 + 统一的方形画布"。

输出（默认写到 tools/desktop-release/assets/pet/）：
  static.png  全身立绘（方形、透明、最长边 1024）
  icon.png    头部特写（256×256，悬浮窗 30~40px 显示用）
  preview-*.png  叠在白底/棋盘上的检查图
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def clean_alpha(image: Image.Image, low: int = 12, high: int = 250) -> Image.Image:
    """清掉半透明雾边：几乎透明的直接抹掉，几乎不透明的补实，中间保留柔边。"""
    rgba = np.asarray(image.convert('RGBA')).astype(np.uint8).copy()
    alpha = rgba[..., 3].astype(np.int16)
    alpha[alpha <= low] = 0
    alpha[alpha >= high] = 255
    rgba[..., 3] = alpha.astype(np.uint8)
    # 全透明像素的 RGB 归零，避免缩放时把底色混进来
    rgba[rgba[..., 3] == 0] = (0, 0, 0, 0)
    return Image.fromarray(rgba, 'RGBA')


def trim(image: Image.Image, margin_ratio: float) -> tuple[Image.Image, tuple[int, int, int, int]]:
    alpha = image.getchannel('A')
    box = alpha.getbbox()
    if not box:
        raise SystemExit('图片里没有不透明内容，检查一下是不是全透明。')
    cropped = image.crop(box)
    width, height = cropped.size
    side = int(round(max(width, height) * (1 + margin_ratio * 2)))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - width) // 2, side - height - int(round(height * margin_ratio * 0.2))), cropped)
    return canvas, box


def head_crop(image: Image.Image) -> Image.Image:
    """按不透明区域估头部：取上方约 1/3 高度、以人物中心为基准裁一个方形。"""
    alpha = image.getchannel('A')
    box = alpha.getbbox()
    if not box:
        raise SystemExit('没有内容可裁头。')
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    side = int(round(height * 0.34))
    side = max(64, min(side, width))
    centre_x = (left + right) // 2
    centre_y = top + int(round(height * 0.14))
    left_c = max(box[0], centre_x - side // 2)
    top_c = max(box[1], centre_y - side // 2)
    left_c = min(left_c, image.width - side)
    top_c = min(top_c, image.height - side)
    return image.crop((left_c, top_c, left_c + side, top_c + side))


def preview(image: Image.Image, out: Path, background: tuple[int, int, int] = (255, 255, 255), tiles: bool = False) -> None:
    canvas = Image.new('RGBA', image.size, background + (255,))
    if tiles:
        step = max(8, image.width // 24)
        for y in range(0, image.height, step):
            for x in range(0, image.width, step):
                if (x // step + y // step) % 2 == 0:
                    canvas.paste((215, 215, 215, 255), (x, y, min(x + step, image.width), min(y + step, image.height)))
    canvas.alpha_composite(image)
    canvas.convert('RGB').save(out, quality=90)


def main() -> int:
    parser = argparse.ArgumentParser(description='立绘 → 形象层素材（static.png + icon.png）')
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', default='tools/desktop-release/assets/pet')
    parser.add_argument('--max', type=int, default=1024, help='全身图最长边上限')
    parser.add_argument('--icon', type=int, default=256, help='头部特写边长')
    parser.add_argument('--margin', type=float, default=0.04, help='四周留白比例')
    args = parser.parse_args()

    source = Path(args.input)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    image = Image.open(source)
    print(f'输入：{source.name} {image.mode} {image.size}')
    cleaned = clean_alpha(image)
    square, box = trim(cleaned, args.margin)
    print(f'内容框：{box} → 方形画布 {square.size}')

    if max(square.size) > args.max:
        scale = args.max / max(square.size)
        square = square.resize((max(1, int(square.width * scale)), max(1, int(square.height * scale))), Image.LANCZOS)
        print(f'全身缩到：{square.size}')

    square.save(out_dir / 'static.png', optimize=True)

    head = head_crop(cleaned)
    head = head.resize((args.icon, args.icon), Image.LANCZOS)
    head.save(out_dir / 'icon.png', optimize=True)

    preview(square, out_dir / 'preview-static.png', (250, 247, 242))
    preview(head, out_dir / 'preview-icon.png', (250, 247, 242), tiles=True)

    for name in ('static.png', 'icon.png'):
        path = out_dir / name
        print(f'  {name}: {path.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
