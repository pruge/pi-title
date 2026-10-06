---
name: verify-title
description: "Drive pi-title the way a user does — build check, unit tests, session entry + file mirror contract. Use when touching extensions/ or src/, or to prove /title before a release."
---

# Verify pi-title

`/title` 자체는 pi 안에서만 치지만, 그 주변(정규화·entry 복원·taskflow 미러)은 전부 headless 로 돈다.

## Launch

No server, no build output. Working directory is the package root.

## Doctor

Read-only:

```bash
node --version  # 22+
ls extensions/pi-title.ts src/session-title.ts src/session-title.test.mjs
```

## Drive

```bash
npm run check  # esbuild, no warnings
npm test       # session-title 8
```

Then the contract checks (commands, not eyeballing):

```bash
# 정규화: 공백 압축 + 40자 + ANSI 제거
node -e "import('./src/session-title.ts').then(m => console.log(JSON.stringify(m.normalizeTitle('  a\nb  ')), m.normalizeTitle('가'.repeat(100)).length, JSON.stringify(m.normalizeTitle('\u001b[31mR\u001b[0m'))))"
# entry 복원: 마지막 session-title 이 이긴다
node -e "import('./src/session-title.ts').then(m => console.log(m.titleFromEntries([{type:'custom',customType:'session-title',data:{title:'a'}},{type:'custom',customType:'session-title',data:{title:'b'}}]))))"
# 미러 키: pane 우선, : 유지
node -e "import('./src/session-title.ts').then(m => console.log(m.titleFileKey({HERDR_PANE_ID:'w2P:p1F'})))"
```

Per-session proof inside pi (print mode, extension loaded):

```bash
FOOT=extensions/pi-title.ts
pi -p -ne -ns -np -nc -e "$FOOT" --session-id T --model <your-model> -- "/title 지정문제"
# turn 을 한 번 돌려야 entry 가 디스크에 닿는다(command-only run 은 세션 파일을 안 만든다)
pi -p -ne -ns -np -nc -e "$FOOT" --session-id T --model <your-model> -- "hi" --resume T
grep -o '"customType":"session-title","data":{[^}]*}' ~/.pi/agent/sessions/*/*T*.jsonl
cat ~/.pi/agent/session-titles/<pane-or-T>.json
```

Manual only: taskflow 위젯 줄 오른쪽 끝의 ` · ✎ 지정문제` 표시와 좁은 pane 에서의 줄바꿈.
Scripted checks cannot see pixels — say so instead of claiming coverage.

## Evidence

Proof is the terminal transcript: clean `check`, `tests 8 pass 0 fail`, the
normalize/entry/key lines above, the per-session jsonl `session-title` entry,
and the mirror file content. Keep it in `artifacts/verify-title/<run>.log` via tee.

## Cleanup

Nothing starts, nothing to kill. `~/.pi/agent/session-titles/` 의 probe 잔재와
`ctx-window.json` 같은 전역 파일을 건드렸으면 원복한다. Proof logs survive in
`artifacts/` (git-ignored).

## Helpers

No helper scripts — the drive is `npm run check`, `npm test`, and the one-liners
above, all shown literally. Do not invent a wrapper that hides them.
