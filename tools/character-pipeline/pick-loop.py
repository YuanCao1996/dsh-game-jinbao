#!/usr/bin/env python
r"""在长片里挑出最像「无缝循环」的一段，并顺手排除有水印的时间窗。

为什么需要：AI 图生视频一般给 5–10 秒，整段既长又首尾接不上；硬用会在循环处跳帧。
这个脚本按目标 fps 逐帧比「窗口首帧 vs 尾帧」的差异，挑差异最小的一段，直接吐出可执行的管线命令。

用法：
  python pick-loop.py --input D:\art\idle.mp4
  python pick-loop.py --input D:\art\idle.mp4 --window 2.0 --key 114,217,75
  python pick-loop.py --input D:\art\idle.mp4 --watermark 1057,624,1265,707
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import find_ffmpeg  # noqa: E402

SAMPLE_WIDTH = 256


def decode_all(ffmpeg: str, video: Path, fps: float, workdir: Path) -> tuple[np.ndarray, int, int, int, int]:
    """整段解成小图存内存：256 宽足够算差异，10 秒也就 120 帧。"""
    workdir.mkdir(parents=True, exist_ok=True)
    target = workdir / 'all.raw'
    cmd = [ffmpeg, '-y', '-loglevel', 'error', '-i', str(video),
           '-vf', f'fps={fps},scale={SAMPLE_WIDTH}:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', str(target)]
    subprocess.run(cmd, check=True)
    raw = target.read_bytes()
    probe = subprocess.run([ffmpeg, '-i', str(video), '-hide_banner'], capture_output=True, text=True, errors='replace').stderr
    import re
    match = re.search(r'(\d{2,5})x(\d{2,5})', probe)
    if not match:
        raise SystemExit('读不出分辨率')
    orig_w, orig_h = int(match.group(1)), int(match.group(2))
    probe_h = max(2, int(round(orig_h * SAMPLE_WIDTH / orig_w / 2)) * 2)
    frame_bytes = SAMPLE_WIDTH * probe_h * 3
    count = len(raw) // frame_bytes
    if count == 0:
        raise SystemExit('解不出帧')
    frames = np.frombuffer(raw[:count * frame_bytes], dtype=np.uint8).reshape(count, probe_h, SAMPLE_WIDTH, 3)
    target.unlink(missing_ok=True)
    return frames, probe_h, count, orig_w, orig_h


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--window', type=float, default=2.0, help='循环窗口长度（秒），默认 2')
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--key', default='', help='键色 RGB；给了就只在角色区域内比较')
    ap.add_argument('--watermark', default='', metavar='X1,Y1,X2,Y2',
                    help='水印区域（原片坐标）；给了就只推荐水印不在的时间窗')
    ap.add_argument('--mouth', default='', metavar='X1,Y1,X2,Y2',
                    help='口部区域（原片坐标）。给了就按口型活跃度排序：--prefer 决定要动还是要静')
    ap.add_argument('--prefer', default='smooth', choices=['smooth', 'mouth-open', 'mouth-closed'],
                    help='smooth=只求首尾接得上；mouth-open=挑口型最活跃那段当 talk；mouth-closed=最平静当 idle')
    ap.add_argument('--out', default='', help='输出根目录，用于打印可执行命令')
    ap.add_argument('--name', default='idle')
    args = ap.parse_args()

    video = Path(args.input)
    if not video.is_file():
        print(f'找不到文件：{video}')
        return 2
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('找不到 ffmpeg：先跑 tools/character-pipeline/fetch-ffmpeg.ps1')
        return 2

    workdir = Path.cwd() / '.check' / ('pick-' + video.stem)
    frames, probe_h, count, orig_w, orig_h = decode_all(ffmpeg, video, args.fps, workdir)
    span = count / args.fps
    print(f'整段 {count} 帧 @ {args.fps}fps = {span:.2f}s，原片 {orig_w}x{orig_h}，采样 {frames.shape[2]}x{probe_h}')

    key = None
    if args.key:
        parts = [int(p) for p in args.key.replace(' ', '').split(',')]
        if len(parts) == 3:
            key = np.array(parts, dtype=int)

    centre_mask = None
    if key is not None:
        rgb = frames[count // 2].astype(int)
        centre_mask = np.abs(rgb - key).sum(axis=2) > 45
    else:
        centre_mask = np.ones(frames.shape[1:3], dtype=bool)

    # 水印区在采样图上的坐标：按采样宽/原片宽等比缩放
    wm_slice = None
    if args.watermark:
        parts = [int(p) for p in args.watermark.replace(' ', '').split(',')]
        if len(parts) == 4:
            ratio = frames.shape[2] / max(1, orig_w)
            x0, x1 = int(parts[0] * ratio), int(parts[2] * ratio)
            y0, y1 = int(parts[1] * ratio), int(parts[3] * ratio)
            wm_slice = (slice(max(0, y0), min(frames.shape[1], y1)),
                        slice(max(0, x0), min(frames.shape[2], x1)))
            print(f'水印区换算到采样图：x {wm_slice[1].start}-{wm_slice[1].stop}, y {wm_slice[0].start}-{wm_slice[0].stop}')

    # 口部区域：给了就统计每帧「相对全片中位口型的偏离」，偏离越大越像在说话
    port_slice = None
    if args.mouth:
        parts = [int(p) for p in args.mouth.replace(' ', '').split(',')]
        if len(parts) == 4:
            ratio = frames.shape[2] / max(1, orig_w)
            x0, x1 = int(parts[0] * ratio), int(parts[2] * ratio)
            y0, y1 = int(parts[1] * ratio), int(parts[3] * ratio)
            port_slice = (slice(max(0, y0), min(frames.shape[1], y1)),
                          slice(max(0, x0), min(frames.shape[2], x1)))
            print(f'口部区换算到采样图：x {port_slice[1].start}-{port_slice[1].stop}, y {port_slice[0].start}-{port_slice[0].stop}')

    window = max(2, int(round(args.window * args.fps)))
    mouth_strength = None
    if port_slice is not None:
        region = frames[:, port_slice[0], port_slice[1], :].astype(int)
        baseline = np.median(region, axis=0)
        mouth_strength = np.abs(region - baseline).mean(axis=(1, 2, 3))

    candidates = []
    for start in range(0, count - window + 1):
        end = start + window - 1
        first = frames[start].astype(int)
        last = frames[end].astype(int)
        diff = np.abs(first - last).mean(axis=2)
        score = float(diff[centre_mask].mean()) if centre_mask.any() else float(diff.mean())
        wm_busy = 0
        if wm_slice is not None:
            for index in range(start, end + 1):
                block = frames[index][wm_slice].astype(int)
                # 水印区里明显不是背景色的像素占比
                busy = float((np.abs(block - block.astype(int).mean(axis=(0, 1))).sum(axis=2) > 60).mean())
                wm_busy = max(wm_busy, busy)
        mouth = float(mouth_strength[start:end + 1].mean()) if mouth_strength is not None else 0.0
        candidates.append((score, start, end, wm_busy, mouth))

    if not candidates:
        print(f'片子只有 {span:.2f}s，不够一个 {args.window}s 窗口')
        return 1

    clean = [c for c in candidates if c[3] < 0.02] or candidates
    pool = clean if clean else candidates

    # 排序策略：全部按"越小越好"打分。口型那一支要的是「口型活跃度高」且「首尾差小」，
    # 所以是 -口型活跃 + 0.35×首尾差；待机则是 +口型活跃 + 0.35×首尾差。
    # 注意口型活跃要取负号——写成 +口型 会挑出首尾差最大的那段，方向正好反了。
    if args.prefer == 'mouth-open' and mouth_strength is not None:
        pool = sorted(pool, key=lambda item: -item[4] + item[0] * 0.35)
        title = '口型最活跃（同时首尾接得上）'
    elif args.prefer == 'mouth-closed' and mouth_strength is not None:
        pool = sorted(pool, key=lambda item: item[4] + item[0] * 0.35)
        title = '口型最平静（同时首尾接得上）'
    else:
        pool = sorted(pool, key=lambda item: item[0])
        title = '首尾差异最小（越接近无缝循环）'

    print('')
    print(f'候选窗口（{title}）：')
    for score, start, end, busy, mouth in pool[:5]:
        mark = '' if busy < 0.02 else '  ← 有水印'
        mouth_text = f'  口型活跃 {mouth:5.2f}' if mouth_strength is not None else ''
        print(f'  --start {start / args.fps:.2f} --duration {args.window:.1f}   首尾差 {score:5.2f}{mouth_text}{mark}')

    best_score, best_start, best_end, _, best_mouth = pool[0]
    print('')
    print(f'推荐：第 {best_start / args.fps:.2f} 秒起 {args.window:.1f} 秒（首尾差 {best_score:.2f}）')
    out_part = f' --out "{args.out}"' if args.out else ' --out D:\\work\\DSH\\.tmp\\build'
    key_part = f' --key "{args.key}"' if args.key else ''
    print('')
    print('可以直接跑：')
    print(f'  python tools/character-pipeline/pipeline.py --input "{video}" --name {args.name} '
          f'--fps {args.fps:g} --size 128 --start {best_start / args.fps:.2f} --duration {args.window:.1f}'
          f'{key_part}{out_part} --focus head')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
