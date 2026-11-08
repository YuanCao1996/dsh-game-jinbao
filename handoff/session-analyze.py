"""单局 DSH session 解析（由 handoff/analyze-session.mjs 上传到服务器执行）。

参数：from_ms to_ms <state-dsh/data 目录>
输出：每回合的步数、模型耗时、工具调用与耗时、结束原因、最终回答摘要。
"""
import ast
import glob
import json
import os
import sys
from collections import Counter

from datetime import datetime


def load(path):
    rows = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    return rows


def data_of(row):
    raw = row.get('data')
    if isinstance(raw, dict):
        return raw
    try:
        return ast.literal_eval(raw)
    except Exception:
        return {}


def text_of(message):
    parts = []
    for block in message.get('content') or []:
        if isinstance(block, dict) and block.get('type') == 'text':
            parts.append(str(block.get('text') or ''))
    return ''.join(parts)


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000).strftime('%H:%M:%S')


def main():
    from_ms, to_ms = float(sys.argv[1]), float(sys.argv[2])
    root = sys.argv[3]
    files = []
    for path in glob.glob(root + '/*/*/_no-cwd/*/session.v4.jsonl'):
        mtime = os.path.getmtime(path) * 1000
        if from_ms <= mtime <= to_ms:
            files.append((mtime, path))
    files.sort()

    print('')
    print('-- DSH session（服务器）--')
    print('命中会话 %d 个' % len(files))

    tool_ok, tool_bad, tool_ms = Counter(), Counter(), {}
    sessions = []
    for mtime, path in files:
        rows = load(path)
        if not rows:
            continue
        sid = os.path.basename(os.path.dirname(path))
        created, model, schemas = None, '?', 0
        turn_start = turn_end = None
        steps = {}
        calls = {}
        answer = ''
        reason = ''
        failed = []
        for row in rows:
            kind = row.get('type')
            payload = data_of(row)
            when = int(row.get('time') or 0)
            if kind == 'session':
                created = int(row.get('createdAt') or when)
            elif kind == 'request/context':
                model = payload.get('model') or model
            elif kind == 'request/header':
                tools = (payload.get('header') or {}).get('tools') or []
                schemas = max(schemas, len(tools))
            elif kind == 'turn/start':
                turn_start = when
            elif kind == 'turn/end':
                turn_end = when
                reason = str((payload.get('reason') or {}).get('kind') or '')
            elif kind == 'step/start':
                steps[payload.get('step')] = {'start': when, 'model': None, 'tools': []}
            elif kind == 'tool/call':
                calls[payload.get('callId')] = {'name': payload.get('name'), 'at': when}
            elif kind == 'tool/result':
                call_id = payload.get('toolCallId') or (payload.get('message') or {}).get('toolCallId')
                info = calls.get(call_id) or {}
                name = info.get('name') or '?'
                text = text_of(payload.get('message') or {})
                low = text.lower()
                spent = when - info['at'] if info.get('at') else 0
                bad = False
                for marker in ('"ok":false', '"success":false', 'unavailable', '[tool error'):
                    if marker in low:
                        bad = True
                if bad:
                    tool_bad[name] += 1
                    failed.append(name)
                else:
                    tool_ok[name] += 1
                tool_ms[name] = max(tool_ms.get(name, 0), spent)
            elif kind == 'assistant/message':
                message = payload.get('message') or {}
                text = text_of(message)
                if text.strip():
                    answer = text.strip()
                step = payload.get('step')
                if step in steps:
                    steps[step]['model'] = when
        for step, info in steps.items():
            if info['model'] and info['start']:
                info['model_ms'] = info['model'] - info['start']
            else:
                info['model_ms'] = None
        sessions.append({'id': sid, 'at': created or int(mtime), 'model': model, 'schemas': schemas,
                         'total': (turn_end - turn_start) if (turn_start and turn_end) else None,
                         'steps': steps, 'answer': answer, 'reason': reason, 'failed': failed})

    for item in sorted(sessions, key=lambda x: x['at']):
        total = ('%d.%ds' % (item['total'] // 1000, item['total'] % 1000 // 100)) if item['total'] else '?'
        print('  %s %s 总%d 步=%d 工具schema=%d 模型=%s%s' % (
            stamp(item['at']), item['id'][:8], 0 if not item['total'] else item['total'] // 1000,
            len(item['steps']), item['schemas'], item['model'],
            ('  结束:' + item['reason']) if item['reason'] else ''))
        for step in sorted(item['steps']):
            info = item['steps'][step]
            model_ms = item['steps'][step].get('model_ms')
            print('      步%d 模型%s' % (step, ('%dms' % model_ms) if model_ms else '-'))
        tail = item['answer'].replace('\n', ' ')[:88]
        if tail:
            print('        回答: ' + tail)
        if item['failed']:
            print('        失败工具: ' + ','.join(item['failed']))

    print('')
    print('-- 工具调用合计 --')
    print('  成功:', dict(tool_ok) or '无')
    print('  失败:', dict(tool_bad) or '无')
    for name, spent in sorted(tool_ms.items(), key=lambda kv: -kv[1])[:5]:
        print('  最慢 %s %dms' % (name, spent))


main()
