/**
 * session-title — 세션 타이틀의 순수 규칙 + 저장 계약.
 *
 * `/title 지정문제` 를 치면 푸터 첫 줄 오른쪽 끝에 `✎ 지정문제` 가 붙는다.
 * statusline 푸터가 그리는 식별 줄(첫 줄)이 대상이다(우측 끝 정렬, 폭은 푸터 폭):
 * `○ idle 🤖 … ⚡…                     ✎ 지정문제`
 *
 * 두 층으로 나뉜다 — "이 세션만"의 핵심이다:
 *
 *   1) 세션 상태  pi.appendEntry("session-title", { title })  (그 세션 파일에만 남는다)
 *      → resume 해도 그 세션만 타이틀이 복원되고, 다른 세션은 영향을 받지 않는다.
 *   2) 파일 미러  ~/.pi/agent/session-titles/<key>.json  (푸터가 읽는다)
 *      → 패키지 간 import 금지 원칙에 따라 경계는 파일이다(ctx-snapshot 과 같은 계약).
 *      key = HERDR_PANE_ID ?? PI_SESSION_ID ?? pid-<pid> (ctx-snapshot.snapshotKey 와 동일식).
 *      shape: { v:1, title, at(ISO) }
 *
 * pane 재사용 오염 방지: session_start 에서 entry 를 복원하고 미러를 동기화한다 —
 * 타이틀이 없으면 키 파일을 지운다. 이전 세션이 죽으면서 남긴 파일이 다음 세션에
 * 보이지 않게 하는 장치가 이것이다. session_shutdown 에서도 키 파일을 지운다.
 *
 * 이 모듈은 파일·pi 런타임을 모른다 — 규칙과 파싱만. IO 는 extensions/ 쪽.
 */

export const TITLE_ENTRY = "session-title";
export const TITLE_DIR = "session-titles";
export const MAX_TITLE_LEN = 40;
/** 미러 정리 임계 — at/mtime 둘 다 이보다 오래되면 안 쓰는 세션으로 보고 지운다. */
export const TITLE_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** ANSI 이스케이프 + 제어문자. 위젯 폭 계산을 깨고 주입 통로가 되니 정규화에서 지운다. */
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[PX^_][^\u001b]*\u001b\\/g;
/** 결합문자·변형선택자(U+FE00–FE0F) — 폭 0. pi-tui zeroWidth와 같은 취급. */
const MARK_RE = /^\p{Mark}$/u;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * 타이틀 정규화: ANSI/제어문자 제거 → 개행·탭 포함 공백 압축 → trim → 40자 절단.
 * 빈 문자열이면 "" (해제 취급은 호출자가).
 */
export function normalizeTitle(raw: unknown): string {
	const t = String(raw ?? "")
		.replace(ANSI_RE, "")
		.replace(CONTROL_RE, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_TITLE_LEN)
		.trim();
	return t;
}

/** 세션 entries 의 마지막 "session-title" custom entry 에서 타이틀을 읽는다(없으면 ""). */
export function titleFromEntries(
	entries: ReadonlyArray<{ type?: string; customType?: string; data?: unknown }> | undefined,
): string {
	let title = "";
	for (const e of entries ?? []) {
		if (e?.type !== "custom" || e.customType !== TITLE_ENTRY) continue;
		const d = e.data as { title?: unknown } | undefined;
		title = d && typeof d === "object" ? normalizeTitle(d.title) : "";
	}
	return title;
}

/** 미러 파일 stale 판정(순수). at 파싱 실패 시 mtime 으로만 본다. 둘 다 없으면 stale 아님. */
export function isTitleFileStale(
	atIso: unknown,
	mtimeMs: number | undefined,
	nowMs = Date.now(),
	pruneAfterMs = TITLE_PRUNE_AFTER_MS,
): boolean {
	let atMs = NaN;
	if (typeof atIso === "string" && atIso) {
		const t = Date.parse(atIso);
		if (Number.isFinite(t)) atMs = t;
	}
	const mOk = typeof mtimeMs === "number" && Number.isFinite(mtimeMs);
	if (!Number.isFinite(atMs) && !mOk) return false;
	// 하나라도 임계 안이면 살아있음 — 둘 다 오래돼야 정리(시계 틀어짐에 보수적)
	if (Number.isFinite(atMs) && nowMs - atMs < pruneAfterMs) return false;
	if (mOk && nowMs - (mtimeMs as number) < pruneAfterMs) return false;
	return true;
}

/** 파일명에 못 쓰는 문자(/ 등)는 - 로. pane 의 : 은 살린다(w2P:p1F). */
export function sanitizeKey(k: string): string {
	return String(k ?? "").replace(/[^A-Za-z0-9_.:#-]/g, "-").slice(0, 128) || "unknown";
}

/** 이 세션의 미러 파일 키. taskflow 읽기 쪽과 같은 값이어야 매칭된다. */
export function titleFileKey(env: NodeJS.ProcessEnv = process.env): string {
	const k = env.HERDR_PANE_ID?.trim() || env.PI_SESSION_ID?.trim() || `pid-${process.pid}`;
	return sanitizeKey(k);
}

/**
 * 행에 타이틀. 첫 행에만 붙인다 — 전 행에 반복하면 시끄러우므로 하나로 충분하다.
 * 타이틀이 없거나 행이 없으면 입력을 그대로 돌려준다(바이트 동일).
 *
 * width 를 주면 우측 끝 정렬(`row + 공백 + ✎ title` 이 width 칸).
 * 실제 표시는 푸터(pi-statusline-live)가 맡고 같은 식을 복제해 갖고 있다
 * (패키지 간 import 금지). 좁으면 이어붙이기로 폴백.
 * width 생략 시 기존 이어붙이기(하위 호환).
 */
export function withTitleSuffix(rows: string[], title: string, width?: number): string[] {
	const t = normalizeTitle(title);
	if (!t || !rows.length) return rows;
	if (typeof width === "number" && width > 0) {
		return [titleRightAligned(rows[0], t, width), ...rows.slice(1)];
	}
	return [`${rows[0]} · ✎ ${t}`, ...rows.slice(1)];
}

/** ANSI 제거(폭 계산용). 위 stripAnsi 용 ANSI_RE 와 같은 식. */
export function stripAnsiForWidth(s: string): string {
	return s.replace(ANSI_RE, "");
}

/**
 * 터미널이 2칸으로 그리는 코드포인트 — pi-tui `visibleWidth`와 맞춘 범위.
 * `0x2600–0x27BF`(Misc Symbols/Dingbats)는 East Asian Width가 Ambiguous이라
 * pi는 1칸으로 센다(`visibleWidth("✎ t") === 3`). 예전엔 이 구간을 2칸으로 잡아
 * `✎ 지정문제`를 11칸으로 계산해 우측 끝 정렬이 한 칸 어긋났다.
 * 남긴 것은 실제로 Wide인 것뿐: 별/원, 지역 표시기(iso 국가 이모지), 피코그래프.
 */
function isWide2(codePoint: number): boolean {
	return (codePoint >= 0x2B50 && codePoint <= 0x2B55) ||
		(codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF) ||
		(codePoint >= 0x1F000 && codePoint <= 0x1FAFF);
}
/** 표시 폭 — 한글·CJK·이모지는 2칸, 결합문자·변형선택자(U+FE0F)는 0칸. pi-tui와 같은 규칙. */
export function displayWidth(s: string): number {
	const t = stripAnsiForWidth(s);
	let w = 0;
	for (const ch of t) {
		const c = ch.codePointAt(0) ?? 0;
		if (MARK_RE.test(ch)) continue;
		w += c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a ||
			(c >= 0x2e80 && c <= 0xa4cf) ||
			(c >= 0xac00 && c <= 0xd7a3) ||
			(c >= 0xf900 && c <= 0xfaff) ||
			(c >= 0xfe30 && c <= 0xfe4f) ||
			(c >= 0xff00 && c <= 0xff60) ||
			(c >= 0xffe0 && c <= 0xffe6) ||
			(c >= 0x20000 && c <= 0x3fffd) ||
			isWide2(c)) ? 2 : 1;
	}
	return w;
}

/**
 * 타이틀 우측 끝 정렬 — `row + 공백 + ✎ title` 이 width 칸에 딱 맞는다.
 * 안 맞으면(좁으면) 이어붙이기 `${row} · ✎ title` 로 폴백.
 */
export function titleRightAligned(row: string, title: string, width: number): string {
	const suffix = `✎ ${title}`;
	const gap = width - displayWidth(row) - displayWidth(suffix);
	if (gap < 1) return row ? `${row} · ${suffix}` : suffix;
	return row + " ".repeat(gap) + suffix;
}
