#!/usr/bin/env python
r"""把某一帧的一块区域「冻」到整段帧上，做出源片里没有的状态。

为什么需要：AI 生成的整段片子里口型一直在动，找不到"闭嘴待机"。
但镜头是固定的（实测耳机质心在整段里抖动不到 1.5px），所以可以把最闭那一帧的
嘴部区域羽化贴回其余帧——头发照样摆，嘴不动，等于凭空得到一段闭嘴待机。

用法：
  python freeze-region.py --frames in/ --patch closed.png --box 632,106,684,142 --out out/
  可选 --feather 6（边缘羽化像素）、--from 21（默认取第 0 帧作补丁）

注意：只适合机位固定、被冻区域周围没有大位移的镜头。贴完请肉眼过一遍。
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def feather_mask(size: tuple[int, int], feather: int) -> Image.Image:
    """中间 255、边缘按 feint 渐变，避免贴块有一圈硬边。"""
    width, height = size
    mask = Image.new('L', (width, height), 255)
    if feather <= 0:
        return mask
    draw = np.full((height, width), 255, dtype=np.uint8)
    ramp = max(1, feather)
    for offset in range(ramp):
        value = int(round(255 * (offset + 1) / (ramp + 1)))
        draw[offset, :] = np.minimum(draw[offset, :], value)
        draw[height - 1 - offset, :] = np.minimum(draw[height - 1 - offset, :], value)
        draw[:, offset] = np.minimum(draw[:, offset], value)
        draw[:, width - 1 - offset] = np.minimum(draw[:, width - 1 - offset], value)
    mask = Image.fromarray(draw, 'L')
    return mask.filter(ImageFilter.GaussianBlur(max(0.5, feather / 3)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True, help='要处理的帧目录（原地不改，输出到 --out）')
    ap.add_argument('--patch', required=True, help='提供该区域的源图（一般就是这一帧里最闭的那张）')
    ap.add_argument('--box', required=True, metavar='X1,Y1,X2,Y2', help='区域框（原片坐标）')
    ap.add_argument('--out', required=True)
    ap.add_argument('--feather', type=int, default=6, help='边缘羽化像素，默认 6')
    args = ap.parse_args()

    src_dir = Path(args.frames)
    if not src_dir.is_dir():
        raise SystemExit(f'找不到帧目录：{src_dir}')
    parts = [int(p) for p in args.box.replace(' ', '').split(',')]
    if len(parts) != 4:
        raise SystemExit('--box 需要形如 632,106,684,142')
    x1, y1, x2, y2 = parts

    patch_image = Image.open(args.patch).convert('RGBA')
    if not (0 <= x1 < x2 <= patch_image.width and 0 <= y1 < y2 <= patch_image.height):
        raise SystemExit(f'区域框超出图片范围（图 {patch_image.size}）')
    patch = patch_image.crop((x1, y1, x2, y2))
    mask = feather_mask(patch.size, args.feather)

    out_dir = Path(args.out)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    files = sorted(p for p in src_dir.iterdir() if p.suffix.lower() == '.png')
    if not files:
        raise SystemExit(f'目录里没有 png：{src_dir}')
    for file in files:
        frame = Image.open(file).convert('RGBA')
        frame.paste(patch, (x1, y1), mask)
        frame.save(out_dir / file.name)
    print(f'已冻结 {len(files)} 帧的区域 {args.box}（羽化 {args.feather}px）→ {out_dir}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
