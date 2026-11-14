#!/usr/bin/env python
"""生成一组合成绿幕测试帧，用来验证素材链（不需要美术资产）。

画一个会呼吸、会眨眼的小方块角色：纯绿背景 + 半透明边缘 + 溢色，专门考验抠像。
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = (512, 512)
GREEN = (0, 255, 0)
FRAMES = 24


def draw_frame(index: int) -> Image.Image:
    image = Image.new('RGB', SIZE, GREEN)
    draw = ImageDraw.Draw(image, 'RGBA')
    phase = index / FRAMES * 2 * math.pi
    bob = math.sin(phase) * 6
    cx, cy = SIZE[0] // 2, SIZE[1] // 2 + int(bob)

    # 身体：圆角方块 + 半透明边缘（模拟柔和轮廓）
    body = (cx - 110, cy - 100, cx + 110, cy + 120)
    draw.rounded_rectangle(body, radius=48, fill=(196, 122, 60, 255), outline=(150, 86, 40, 180), width=6)
    # 头顶元宝状装饰
    draw.polygon([(cx - 46, cy - 118), (cx, cy - 150), (cx + 46, cy - 118)], fill=(214, 158, 82, 255))
    # 眼睛（周期性眨眼）
    blink = index % 12 in (5, 6)
    for offset in (-42, 42):
        if blink:
            draw.line([(cx + offset - 16, cy - 20), (cx + offset + 16, cy - 20)], fill=(40, 32, 24, 255), width=6)
        else:
            draw.ellipse((cx + offset - 14, cy - 34, cx + offset + 14, cy - 6), fill=(40, 32, 24, 255))
    # 嘴
    draw.arc((cx - 26, cy + 12, cx + 26, cy + 56), start=10, end=170, fill=(40, 32, 24, 255), width=5)
    # 胳膊随呼吸摆动
    swing = int(math.sin(phase) * 14)
    draw.line([(cx - 110, cy + 10), (cx - 150, cy + 60 + swing)], fill=(196, 122, 60, 255), width=18)
    draw.line([(cx + 110, cy + 10), (cx + 150, cy + 60 - swing)], fill=(196, 122, 60, 255), width=18)
    # 故意加一点绿色溢色边缘，测试 despill
    draw.rectangle((cx - 112, cy + 118, cx + 112, cy + 126), fill=(120, 200, 100, 160))
    return image


def main(out_dir: str) -> int:
    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    for index in range(FRAMES):
        draw_frame(index).save(target / f'{index:03d}.png')
    print(f'生成 {FRAMES} 帧测试素材 → {target}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'D:/work/DSH/.tmp/test-frames'))
