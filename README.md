# pi-title

Per-session title for pi. `/title 지정문제` 를 치면 그 세션의 위젯 줄 오른쪽 끝에
` · ✎ 지정문제` 가 붙는다 (taskflow 위젯의 orch 줄이 대상):

```
orch(w2P:p1F) — idle (/tworkers 로 스폰·회수) · ✎ 지정문제
```

## Install

```bash
pi install github.com/pruge/pi-title
# or
pi -e github.com/pruge/pi-title
```

taskflow 위젯에 표시되려면 pi-taskflow 와 함께 로드돼 있어야 한다
(표시는 taskflow 의 paint 가 미러 파일을 읽는다).

## Commands

```
/title <text>   — 이 세션의 타이틀을 정한다 (최대 40자, 공백 압축, ANSI 제거)
/title          — 현재 타이틀 표시
/title clear    — 해제 (--clear 도 같음)
```

## How it works

Two layers — "이 세션만"이 핵심이다 (`/ctx` 의 `ctx-cap` 과 같은 패턴):

| Layer | Where | Scope |
|---|---|---|
| 타이틀 값 | `pi.appendEntry("session-title", { title })` inside the session file | just that session (resume 복원, 옆 세션 무영향) |
| 미러 | `~/.pi/agent/session-titles/<key>.json` (`{ v:1, title, at }`) | taskflow 위젯이 읽는다 (파일 경계, import 없음) |

`key = HERDR_PANE_ID ?? PI_SESSION_ID ?? pid-<pid>` — ctx-snapshot 과 같은 식.

pane 재사용 오염 방지: `session_start` 에서 entry 를 복원하고 미러를 동기화한다.
타이틀이 없으면 키 파일을 지우니, 죽은 세션이 남긴 파일이 다음 세션에 보이지
않는다. `session_shutdown` 에서도 키 파일을 지운다.

표시 형식은 첫 행에만 (`withTitleSuffix`): 타이틀 없음 → 기존 출력과 바이트 동일.
타이틀이 길면 taskflow 의 폭 클램프에서 감기니 40자로 먼저 자른다.

Standalone, zero runtime deps.
