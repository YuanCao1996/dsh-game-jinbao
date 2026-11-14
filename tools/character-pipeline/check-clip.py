#!/usr/bin/env python
r"""给 AI 生成的动作视频做体检：进抠像管线之前先挡掉最常见的几类废片。

挡什么（都是实测会遇到的坑）：
  1) 背景不是纯绿      —— 图生视频工具会偷偷加渐变/光斑/阴影，抠像必留残渣
  2) 角色跑出画幅      —— 有位移的镜头没法循环，抠完边缘会被切平
  3) 时长/帧率不对     —— 超过 3 秒基本接不上首尾
  4) 绿背景占比不合适  —— 角色太大/太小，说明构图和首帧不一致

用法：
  python check-clip.py --input D:\art\idle.mp4
  python check-clip.py --input D:\art\idle.mp4 --fix-hint
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import find_ffmpeg  # noqa: E402

PROBE_FRAMES = 6        # 均匀抽几帧看，没必要全解码
MAX_SECONDS = 3.5
MIN_GREEN_SHARE = 0.35  # 绿背景占比下限（角色最多占 65%）
MAX_GREEN_SHARE = 0.92  # 绿背景占比上限（角色不能小到看不见）


def probe(ffmpeg: str, video: Path) -> dict:
    """用 ffmpeg -i 的 stderr 拿时长/分辨率/帧率，避免依赖 ffprobe。"""
    proc = subprocess.run([ffmpeg, '-i', str(video), '-hide_banner'],
                          capture_output=True, text=True, errors='replace')
    text = proc.stderr
    info: dict = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('Duration:'):
            stamp = line.split('Duration:')[1].split(',')[0].strip()
            h, m, s = stamp.split(':')
            info['seconds'] = int(h) * 3600 + int(m) * 60 + float(s)
        if 'Video:' in line and 'x' in line:
            import re
            match = re.search(r'(\d{2,5})x(\d{2,5})', line)
            if match:
                info['width'] = int(match.group(1))
                info['height'] = int(match.group(2))
            fps = re.search(r'([\d.]+) fps', line)
            if fps:
                info['fps'] = float(fps.group(1))
    return info


def sample_frames(ffmpeg: str, video: Path, seconds: float, workdir: Path, size: tuple[int, int]) -> list[np.ndarray]:
    """按时间点抽帧，让 ffmpeg 直接吐 rgb24 裸数据，尺寸自己算——不依赖 ffprobe 也不解析容器。"""
    workdir.mkdir(parents=True, exist_ok=True)
    source_w, source_h = size
    probe_w = 320
    probe_h = max(2, int(round(source_h * probe_w / max(1, source_w) / 2)) * 2)
    expected = probe_w * probe_h * 3
    frames = []
    total = PROBE_FRAMES
    for index in range(total):
        t = seconds * (0.05 + 0.9 * index / (total - 1)) if total > 1 else seconds / 2
        target = workdir / f'probe{index:02d}.raw'
        cmd = [ffmpeg, '-y', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', str(video),
               '-frames:v', '1', '-vf', f'scale={probe_w}:{probe_h}',
               '-f', 'rawvideo', '-pix_fmt', 'rgb24', str(target)]
        subprocess.run(cmd, check=False)
        if not target.is_file():
            continue
        raw = target.read_bytes()
        if len(raw) < expected:
            continue
        frames.append(np.frombuffer(raw[:expected], dtype=np.uint8)
                      .reshape(probe_h, probe_w, 3).astype(int))
    return frames


def analyse_frame(array: np.ndarray) -> dict:
    red, green, blue = array[..., 0], array[..., 1], array[..., 2]
    # 绿幕判定：绿明显压过红蓝
    is_green = (green > 90) & (green - red > 60) & (green - blue > 60)
    share = float(is_green.mean())
    # 角色包围盒：非绿区域的上下左右边界
    mask = ~is_green
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if rows.size and cols.size:
        box = (int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1]))
    else:
        box = None
    return {'green': share, 'box': box, 'shape': array.shape[:2]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--fix-hint', action='store_true', help='失败时多给一点怎么改')
    args = ap.parse_args()

    video = Path(args.input)
    if not video.is_file():
        print(f'找不到文件：{video}')
        return 2
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('找不到 ffmpeg：先跑 tools/character-pipeline/fetch-ffmpeg.ps1')
        return 2

    info = probe(ffmpeg, video)
    seconds = info.get('seconds', 0.0)
    print(f'文件 {video.name}  {info.get("width")}x{info.get("height")}  {seconds:.2f}s  {info.get("fps", "?")}fps')

    problems: list[str] = []
    if seconds <= 0.3:
        problems.append('读不出时长，文件可能不完整')
    elif seconds > MAX_SECONDS:
        problems.append(f'时长 {seconds:.1f}s 偏长（建议 ≤3s），循环动作越长越容易接不上')

    workdir = Path(video).parent / '.check'
    size = (info.get('width') or 0, info.get('height') or 0)
    if not size[0] or not size[1]:
        problems.append('读不出分辨率，文件可能有问题')
        frames = []
    else:
        frames = sample_frames(ffmpeg, video, seconds or 2.0, workdir, size)
    if not frames:
        problems.append('抽不出帧，请换一个工具重新导出')
    else:
        results = [analyse_frame(f) for f in frames]
        shares = [r['green'] for r in results]
        low = min(shares)
        box_edges = [r['box'] for r in results if r['box']]
        print(f'抽 {len(results)} 帧：绿背景占比 最低 {low:.0%} / 最高 {max(shares):.0%}')

        if low < MIN_GREEN_SHARE:
            problems.append(f'绿背景占比只有 {low:.0%}（要 ≥{MIN_GREEN_SHARE:.0%}）：角色太大或背景不纯')
        if max(shares) > MAX_GREEN_SHARE:
            problems.append(f'绿背景占比高到 {max(shares):.0%}：角色太小，和首帧构图不一致，抠出来会虚')
        if min(shares) < 0.97 * max(shares) and len(shares) > 2:
            problems.append(f'绿背景占比在帧间波动 {min(shares):.0%}→{max(shares):.0%}：可能有光斑/阴影/运镜')

        if box_edges:
            height, width = results[0]['shape']
            left = min(b[0] for b in box_edges)
            top = min(b[1] for b in box_edges)
            right = max(b[2] for b in box_edges)
            bottom = max(b[3] for b in box_edges)
            print(f'角色包围盒（采样分辨率 {width}x{height}）：x {left}-{right}, y {top}-{bottom}')
            margin = 3
            if left <= margin or top <= margin or right >= width - 1 - margin or bottom >= height - 1 - margin:
                problems.append('角色贴边或出画：机位要固定，角色全程完整留在画面内')

        # 首尾帧相似度：决定循环会不会跳
        if len(frames) >= 2:
            first, last = frames[0].astype(int), frames[-1].astype(int)
            if first.shape == last.shape:
                diff = float(np.abs(first - last).mean())
                print(f'首尾帧平均像素差 {diff:.1f}（越小越容易循环）')
                if diff > 30:
                    problems.append(f'首尾帧差得较多（{diff:.0f}/255）：循环处会跳，建议重新生成而不是拼接')

    print('')
    if problems:
        print(f'体检不通过（{len(problems)} 项）：')
        for item in problems:
            print(f'  - {item}')
        if args.fix_hint:
            print('')
            print('怎么改：')
            print('  · 背景不纯 → 首帧必须用 make-greenplate.py 出的图，负面提示词加「渐变背景/光斑/阴影」')
            print('  · 角色出画 → 提示词强调「固定机位、不要推拉摇移」，运动幅度调小')
            print('  · 首尾接不上 → 时长改 2 秒、动作幅度调小，重新生成整段（不要拼接）')
            print('  · 角色太小 → 删掉提示词里的「远景/全身小」类描述，保持和首帧一致的构图')
        return 1

    print('体检通过，可以进抠像管线：')
    print(f'  python tools/character-pipeline/pipeline.py --input "{video}" --name <状态名> --fps 12 --size 192')
    meta = workdir / 'report.json'
    meta.write_text(json.dumps({'file': str(video), 'info': info}, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
