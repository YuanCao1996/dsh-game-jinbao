#!/usr/bin/env python
"""把合成绿幕帧序列打包成 mp4，用来验证「视频输入」这条路（不是给正式素材用的）。

用法：
  python tests/make-test-mp4.py                       # 先调 make-test-frames.py，再打包
  python tests/make-test-mp4.py --frames <帧目录> --out <输出.mp4>

为什么要有这一步：pipeline.py 的 A 路输入（mp4）一直只做过代码级检查，
没跑过真实解码。这个脚本让人造素材走一遍 ffmpeg 编码 → pipeline 解码的整链。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
sys.path.insert(0, str(TOOL))

from pipeline import find_ffmpeg  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', default=str(HERE / 'out' / 'frames'))
    ap.add_argument('--out', default=str(HERE / 'out' / 'test-green.mp4'))
    ap.add_argument('--fps', type=float, default=24)
    ap.add_argument('--skip-gen', action='store_true', help='不重新生成帧，直接打包已有目录')
    args = ap.parse_args()

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('找不到 ffmpeg：请把 ffmpeg.exe 放到 tools/character-pipeline/bin/ 或装进 PATH')
        return 2
    print(f'ffmpeg = {ffmpeg}')

    frames = Path(args.frames)
    if not args.skip_gen:
        gen = HERE / 'make-test-frames.py'
        print(f'生成合成帧 -> {frames}')
        subprocess.run([sys.executable, str(gen), str(frames)], check=True)
    if not frames.is_dir():
        print(f'帧目录不存在：{frames}')
        return 2
    pngs = sorted(frames.glob('*.png'))
    if not pngs:
        print(f'帧目录里没有 png：{frames}')
        return 2

    # 帧名可能 0 起 3 位（003.png）也可能 4 位，按第一帧推断 pattern，避免硬编码
    first = pngs[0].stem
    start_number = int(first) if first.isdigit() else 0
    pattern = frames / ('%0' + str(len(first)) + 'd.png')

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, '-y', '-loglevel', 'error',
        '-framerate', str(args.fps),
        '-start_number', str(start_number),
        '-i', str(pattern),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
        str(out),
    ]
    print(' '.join(cmd))
    subprocess.run(cmd, check=True)
    print(f'OK -> {out}  ({out.stat().st_size} bytes, {len(pngs)} 帧 @ {args.fps}fps)')
    print('下一步：python pipeline.py --input "%s" --name 自测 --fps 12 --size 192' % out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
