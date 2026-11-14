#!/usr/bin/env python
"""金宝形象素材链：绿幕/透明源 → 抠像 → 归一化 → 播放资源（APNG + PNG 序列）。

为什么自己写而不直接用 dsh-pet 的脚本：
  1) 我们跑在 WPF 上，播放格式不一样（他们用 webm+Chromium，我们用 PNG 序列/APNG）；
  2) 本机没有 ffmpeg，脚本要能在没有 ffmpeg 的前提下工作；
  3) 需要按我们的 UI 规格（112~192px、纸感配色、统一站立基准线）输出。

输入两种：
  A. 绿幕视频（mp4/mov）—— 需要 ffmpeg，本机没有时请先用别的工具导出帧
  B. 帧目录（png/jpg 序列）—— 推荐，任何工具都能导

输出：
  out/<动作>/
    frames/*.png      播放用序列帧（RGBA，尺寸统一）
    anim.png          APNG（网页/手机端可直接用）
    action.json       元信息（帧数/fps/尺寸/时长）

用法：
  python pipeline.py --input video/待机.mp4 --name 待机 --fps 12 --size 192
  python pipeline.py --input frames/待机/ --name 待机 --fps 12 --size 192
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FRAME_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}


def find_ffmpeg() -> str | None:
    for name in ('ffmpeg', 'ffmpeg.exe'):
        path = shutil.which(name)
        if path:
            return path
    return None


def extract_frames(video: Path, workdir: Path, fps: float) -> list[Path]:
    """从视频导出帧；没有 ffmpeg 时给出可执行的替代建议而不是静默失败。"""
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise SystemExit(
            '本机没有 ffmpeg，无法直接读取视频。\n'
            '两条路：\n'
            '  1) 用剪映/PR/PotPlayer 把视频导出成 PNG 序列，放到一个目录里，再用 --input 指向该目录；\n'
            '  2) 安装 ffmpeg 后重跑（winget install Gyan.FFmpeg）。\n'
        )
    target = workdir / 'source'
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ffmpeg, '-y', '-i', str(video), '-vf', f'fps={fps}', '-start_number', '0', str(target / '%04d.png')],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    frames = sorted(target.glob('*.png'))
    if not frames:
        raise SystemExit('视频没有解出任何帧，请检查文件是否可播放。')
    return frames


def load_frames(path: Path, fps: float, workdir: Path) -> list[tuple[Path, Image.Image]]:
    if path.is_dir():
        files = sorted(child for child in path.iterdir() if child.suffix.lower() in FRAME_EXTS)
        if not files:
            raise SystemExit(f'目录里没有图片帧：{path}')
        return [(file, Image.open(file).convert('RGBA')) for file in files]
    if path.suffix.lower() in FRAME_EXTS:
        return [(path, Image.open(path).convert('RGBA'))]
    return [(file, Image.open(file).convert('RGBA')) for file in extract_frames(path, workdir, fps)]


def chroma_key(image: Image.Image, key: tuple[int, int, int], tolerance: float, softness: float, despill: bool) -> Image.Image:
    """绿幕抠像：按 HSV 色相 + 饱和度判定，边缘做柔和过渡，最后去溢色。"""
    rgba = np.asarray(image).astype(np.float32)
    rgb = rgba[..., :3] / 255.0
    maxc = rgb.max(axis=2)
    minc = rgb.min(axis=2)
    delta = maxc - minc + 1e-6

    hue = np.zeros_like(maxc)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mask_r = (maxc == red)
    mask_g = (maxc == green)
    mask_b = (maxc == blue)
    hue[mask_r] = ((green - blue)[mask_r] / delta[mask_r]) % 6
    hue[mask_g] = ((blue - red)[mask_g] / delta[mask_g]) + 2
    hue[mask_b] = ((red - green)[mask_b] / delta[mask_b]) + 4
    hue *= 60.0
    saturation = np.where(maxc > 0, delta / np.maximum(maxc, 1e-6), 0)

    key_hue = 120.0 if key[1] >= max(key[0], key[2]) else (0.0 if key[0] >= key[2] else 240.0)
    hue_distance = np.abs(((hue - key_hue + 180) % 360) - 180)
    bare = hue_distance <= tolerance
    edge = (hue_distance > tolerance) & (hue_distance <= tolerance + softness)

    alpha = np.ones(maxc.shape, dtype=np.float32)
    alpha[bare] = 0.0
    if softness > 0:
        ramp = 1.0 - (hue_distance[edge] - tolerance) / max(softness, 1e-6)
        alpha[edge] = np.clip(ramp, 0.0, 1.0)
    # 低饱和度的近白/近黑也常是背景残留，按与键色的距离再压一次
    alpha = np.where((saturation < 0.12) & (maxc > 0.75) & bare, 0.0, alpha)

    if despill:
        # 去溢色：把绿色通道压到红蓝的较大者，避免边缘发绿
        limit = np.maximum(red, blue)
        green_fixed = np.minimum(green, limit)
        rgb[..., 1] = np.where(bare | edge, green_fixed, green)
        rgb = np.clip(rgb, 0.0, 1.0)

    out = np.zeros(rgba.shape, dtype=np.uint8)
    out[..., :3] = np.round(rgb * 255.0)
    out[..., 3] = np.round(alpha * 255.0)
    return Image.fromarray(out, 'RGBA')


def crop_and_scale(image: Image.Image, size: int, baseline: float) -> Image.Image:
    """按不透明像素裁掉空白，再等比缩放到统一画布，并把脚底对齐到 baseline。"""
    alpha = image.getchannel('A')
    box = alpha.getbbox()
    if box:
        image = image.crop(box)
    width, height = image.size
    if width == 0 or height == 0:
        return Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # 以高度为准缩放到画布的 baseline 比例，保留人物比例
    target_height = max(1, int(round(size * baseline)))
    scale = target_height / height
    target_width = max(1, int(round(width * scale)))
    if target_width > size:
        scale = size / width
        target_width = size
        target_height = max(1, int(round(height * scale)))
    resized = image.resize((target_width, target_height), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    left = (size - target_width) // 2
    top = size - target_height
    canvas.paste(resized, (left, top), resized)
    return canvas


def build(input_path: Path, out_root: Path, name: str, fps: float, size: int, baseline: float,
          key: tuple[int, int, int], tolerance: float, softness: float, despill: bool, max_frames: int | None) -> dict:
    workdir = out_root / '.work' / name
    workdir.mkdir(parents=True, exist_ok=True)
    frames = load_frames(input_path, fps, workdir)
    if max_frames:
        frames = frames[:max_frames]
    if not frames:
        raise SystemExit('没有可用帧。')

    action_dir = out_root / name
    frames_dir = action_dir / 'frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    for stale in frames_dir.glob('*.png'):
        stale.unlink()

    processed: list[Image.Image] = []
    for index, (_, image) in enumerate(frames):
        keyed = chroma_key(image, key, tolerance, softness, despill)
        placed = crop_and_scale(keyed, size, baseline)
        placed.save(frames_dir / f'{index:03d}.png', optimize=True)
        processed.append(placed)

    # APNG：网页/手机端可直接播放，省得再转一次
    processed[0].save(
        action_dir / 'anim.png', format='PNG', save_all=True, append_images=processed[1:],
        duration=int(round(1000 / fps)), loop=0, disposal=1, optimize=True,
    )

    meta = {
        'name': name,
        'frames': len(processed),
        'fps': fps,
        'size': size,
        'baseline': baseline,
        'durationMs': round(len(processed) / fps * 1000),
        'bytes': {
            'frames': sum(file.stat().st_size for file in frames_dir.glob('*.png')),
            'apng': (action_dir / 'anim.png').stat().st_size,
        },
    }
    (action_dir / 'action.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    return meta


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='金宝形象素材链：绿幕 → 抠像 → 播放资源')
    parser.add_argument('--input', required=True, help='视频文件或帧目录')
    parser.add_argument('--name', required=True, help='动作名（如 待机 / 说话 / 胜利）')
    parser.add_argument('--out', default='build', help='输出根目录，默认 build/')
    parser.add_argument('--fps', type=float, default=12)
    parser.add_argument('--size', type=int, default=192, help='画布边长，默认 192（悬浮窗显示 112）')
    parser.add_argument('--baseline', type=float, default=0.94, help='脚底对齐比例，默认 0.94')
    parser.add_argument('--key', default='0,255,0', help='键色 RGB，默认 0,255,0')
    parser.add_argument('--tolerance', type=float, default=28.0, help='色相容差（度）')
    parser.add_argument('--softness', type=float, default=22.0, help='边缘羽化宽度（度）')
    parser.add_argument('--no-despill', action='store_true', help='关闭去溢色')
    parser.add_argument('--max-frames', type=int, default=None, help='最多处理多少帧（调试用）')
    args = parser.parse_args(argv)

    key = tuple(int(part) for part in args.key.split(','))
    if len(key) != 3:
        raise SystemExit('--key 需要形如 0,255,0')

    meta = build(
        Path(args.input), Path(args.out), args.name, args.fps, args.size, args.baseline,
        key, args.tolerance, args.softness, not args.no_despill, args.max_frames,
    )
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
