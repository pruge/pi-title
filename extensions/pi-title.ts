/**
 * pi-title — 세션 타이틀.
 *
 *   /title 지정문제   — 이 세션의 타이틀을 정한다(푸터 첫 줄 오른쪽 끝에 `✎ 지정문제`)
 *   /title            — 현재 타이틀 표시
 *   /title clear      — 해제 (`--clear` 도 같음)
 *
 * 저장은 두 층이다:
 *   1) pi.appendEntry("session-title", { title }) — 그 세션 파일에만 남는다.
 *      resume 해도 그 세션만 복원되고 옆 세션은 영향을 받지 않는다.
 *   2) ~/.pi/agent/session-titles/<key>.json — 푸터(pi-statusline-live)가 읽는 미러
 *      (파일 경계, 패키지 간 import 금지). key = HERDR_PANE_ID ?? PI_SESSION_ID ?? pid.
 *
 * 타이틀이 길면 푸터 폭에 맞춰 잘리니 40자로 먼저 자른다(src/session-title.ts
 * normalizeTitle). ANSI/제어문자는 제거한다.
 */

import { TITLE_DIR, TITLE_ENTRY, isTitleFileStale, normalizeTitle, titleFileKey, titleFromEntries } from "../src/session-title.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GUARD_KEY = "__piTitleLoaded";

export default function (pi: ExtensionAPI) {
	const g = globalThis as any;
	if (g[GUARD_KEY]) return; // 중복 로드(전역+프로젝트) 시 먼저 뜬 것만 산다
	const instanceId = `${Date.now()}-${Math.random()}`;
	g[GUARD_KEY] = instanceId;

	// 이 세션의 타이틀 — session_start 에서 entry 로 복원, paint 가 아니라
	// 명령·복원이 이 변수만 만진다(매번 getEntries 스캔 안 함).
	let currentTitle = "";

	function mirrorPath(): string {
		return join(homedir(), ".pi", "agent", TITLE_DIR, `${titleFileKey()}.json`);
	}
	/** 미러 동기화: 있으면 쓰고 없으면(해제·타이틀 없는 세션) 지운다 — pane 재사용 오염 방지. */
	function syncMirror(): void {
		const p = mirrorPath();
		try {
			if (!currentTitle) {
				if (existsSync(p)) rmSync(p);
				return;
			}
			mkdirSync(join(homedir(), ".pi", "agent", TITLE_DIR), { recursive: true });
			const tmp = `${p}.tmp-${process.pid}`;
			writeFileSync(tmp, JSON.stringify({ v: 1, title: currentTitle, at: new Date().toISOString() }));
			renameSync(tmp, p); // 같은 파일시스템 내 교체는 원자적
		} catch { /* 미러 실패는 세션을 깨지 않는다 — entry 가 정본이다 */ }
	}
	function persist(): void {
		try { pi.appendEntry(TITLE_ENTRY, { title: currentTitle }); } catch { /* ignore */ }
		syncMirror();
	}
	/** 오래된 미러 정리 — 세션별 파일이 쌓이지 않게 at/mtime 둘 다 7일 넘은 것만 지운다.
	 *  이 세션 파일은 제외. session_start·/title 시점에 기회주의적으로, 실패해도 조용히. */
	function pruneMirrors(): void {
		try {
			const dir = join(homedir(), ".pi", "agent", TITLE_DIR);
			if (!existsSync(dir)) return;
			const mine = mirrorPath();
			let files: string[] = [];
			try { files = readdirSync(dir); } catch { return; }
			const now = Date.now();
			for (const f of files) {
				if (!f.endsWith(".json") || f.includes(".tmp-")) continue;
				const p = join(dir, f);
				if (p === mine) continue;
				try {
					const mtime = (() => { try { return statSync(p).mtimeMs; } catch { return undefined; } })();
					let at: unknown;
					try { at = (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)?.at; } catch { at = undefined; }
					if (isTitleFileStale(at, mtime, now)) rmSync(p);
				} catch { /* 개별 실패 무시 */ }
			}
		} catch { /* 정리 실패는 세션을 깨지 않는다 */ }
	}
	function statusLine(ctx: ExtensionContext): string {
		let sid = "?";
		try { sid = String(ctx.sessionManager.getSessionId()).slice(0, 8); } catch { /* ignore */ }
		return currentTitle ? `제목: ${currentTitle} (이 세션 ${sid})` : `제목 없음 (이 세션 ${sid}) — /title <text> 로 정한다`;
	}

	pi.on("session_start", async (_e, ctx) => {
		try { currentTitle = titleFromEntries(ctx.sessionManager.getEntries()); } catch { currentTitle = ""; }
		syncMirror(); // 타이틀 없는 세션이 pane 재사용 시 남의 미러를 지운다
		pruneMirrors(); // 7일 넘은 남의 미러 정리
	});

	pi.on("session_shutdown", async () => {
		try { if (g[GUARD_KEY] === instanceId) delete g[GUARD_KEY]; } catch { /* ignore */ }
		try { if (existsSync(mirrorPath())) rmSync(mirrorPath()); } catch { /* ignore */ }
	});

	pi.registerCommand("title", {
		description: "세션 타이틀 — /title <text> (푸터 첫 줄 오른쪽 끝) · /title (표시) · /title clear (해제)",
		getArgumentCompletions: (prefix: string) => {
			const items = ["clear"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const a = (args ?? "").trim();
			if (!a) {
				ctx.ui.notify(statusLine(ctx), "info");
				return;
			}
			const low = a.toLowerCase();
			if (low === "clear" || low === "--clear") {
				currentTitle = "";
				persist();
				pruneMirrors();
				ctx.ui.notify("제목 해제 — 푸터 첫 줄이 원래대로 돌아간다", "info");
				return;
			}
			const t = normalizeTitle(a);
			if (!t) {
				ctx.ui.notify("빈 제목은 안 된다 — 해제하려면 /title clear", "error");
				return;
			}
			currentTitle = t;
			persist();
			pruneMirrors();
			ctx.ui.notify(`제목: ${t} — 푸터 첫 줄 오른쪽 끝에 붙였다`, "info");
		},
	});
}
