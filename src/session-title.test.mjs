// session-title 계약 테스트. Run: node src/session-title.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
	TITLE_ENTRY, MAX_TITLE_LEN, TITLE_PRUNE_AFTER_MS, isTitleFileStale, normalizeTitle, titleFromEntries, sanitizeKey, titleFileKey, withTitleSuffix,
	displayWidth, titleRightAligned,
} from "./session-title.ts";

test("normalizeTitle — 공백 압축 + 개행/탭 제거", () => {
	assert.equal(normalizeTitle("  지정문제  "), "지정문제");
	assert.equal(normalizeTitle("a\nb\tc"), "a b c");
	assert.equal(normalizeTitle("a   b"), "a b");
});

test("normalizeTitle — 40자 절단", () => {
	assert.equal(MAX_TITLE_LEN, 40);
	const long = "가".repeat(100);
	assert.equal(normalizeTitle(long).length, 40);
	// 절단 후 끝 공백은 trim
	assert.equal(normalizeTitle("x".repeat(39) + "  y"), "x".repeat(39));
});

test("normalizeTitle — ANSI/제어문자 제거", () => {
	assert.equal(normalizeTitle("\u001b[31m빨강\u001b[0m 타이틀"), "빨강 타이틀");
	assert.equal(normalizeTitle("a\u0000b\u001fc"), "a b c");
});

test("normalizeTitle — 빈 입력은 빈 문자열", () => {
	for (const bad of ["", "   ", "\n\t", null, undefined]) {
		assert.equal(normalizeTitle(bad), "", `should be empty: ${JSON.stringify(bad)}`);
	}
});

test("titleFromEntries — 마지막 session-title entry 가 이긴다", () => {
	const entries = [
		{ type: "custom", customType: TITLE_ENTRY, data: { title: "첫번째" } },
		{ type: "message", customType: "x", data: {} },
		{ type: "custom", customType: "ctx-cap", data: { released: true } },
		{ type: "custom", customType: TITLE_ENTRY, data: { title: "두번째" } },
	];
	assert.equal(titleFromEntries(entries), "두번째");
});

test("titleFromEntries — 없거나 깨지면 빈 문자열", () => {
	assert.equal(titleFromEntries(undefined), "");
	assert.equal(titleFromEntries([]), "");
	assert.equal(titleFromEntries([{ type: "custom", customType: TITLE_ENTRY, data: null }]), "");
	assert.equal(titleFromEntries([{ type: "custom", customType: TITLE_ENTRY, data: { title: "  " } }]), "");
});

test("sanitizeKey + titleFileKey — pane 우선, : 유지", () => {
	assert.equal(sanitizeKey("w2P:p1F"), "w2P:p1F");
	assert.equal(sanitizeKey("a/b c"), "a-b-c");
	assert.equal(titleFileKey({ HERDR_PANE_ID: "w2P:p1F", PI_SESSION_ID: "sess" }), "w2P:p1F");
	assert.equal(titleFileKey({ PI_SESSION_ID: "sess/1" }), "sess-1");
	assert.equal(titleFileKey({}), `pid-${process.pid}`);
});

test("withTitleSuffix — 첫 행에만, 없으면 원본 유지", () => {
	const rows = ["orch(w2P:p1F) — idle (/tworkers 로 스폰·회수)", "둘째 줄"];
	assert.deepEqual(
		withTitleSuffix(rows, "지정문제"),
		["orch(w2P:p1F) — idle (/tworkers 로 스폰·회수) · ✎ 지정문제", "둘째 줄"],
	);
	// 빈 타이틀/빈 행은 입력과 동일
	assert.equal(withTitleSuffix(rows, "")[0], rows[0]);
	assert.equal(withTitleSuffix(rows, "   ")[0], rows[0]);
	assert.deepEqual(withTitleSuffix([], "지정문제"), []);
	// 원본 배열을 바꾸지 않는다
	const src = ["a"];
	withTitleSuffix(src, "t");
	assert.deepEqual(src, ["a"]);
});

test("withTitleSuffix + width — 우측 끝 정렬", () => {
	const rows = ["orch(w2P:p1F) — idle", "둘째 줄"];
	const out = withTitleSuffix(rows, "지정문제", 40);
	assert.equal(out.length, 2);
	assert.equal(out[1], "둘째 줄");
	assert.ok(out[0].endsWith("✎ 지정문제"));
	assert.equal(displayWidth(out[0]), 40);
	// width 생략은 기존 이어붙이기(하위 호환)
	assert.equal(withTitleSuffix(rows, "지정문제")[0], "orch(w2P:p1F) — idle · ✎ 지정문제");
});

test("titleRightAligned — taskflow 쪽과 같은 식", () => {
	assert.equal(titleRightAligned("ab", "t", 10), "ab     ✎ t");
	assert.equal(displayWidth(titleRightAligned("가", "나", 10)), 10);
	assert.equal(titleRightAligned("abcdef", "t", 5), "abcdef · ✎ t");
	assert.equal(displayWidth("✎ 지정문제"), 10); // ✎ 1 + 공백 1 + 4*2
	assert.equal(displayWidth("✎\uFE0F"), 1); // 변형선택자 0칸 — pi visibleWidth와 동일
	assert.equal(displayWidth("★ 가"), 4); // 2 + 1 + 2 (실제로 Wide인 기호)
});

test("isTitleFileStale — at/mtime 둘 다 7일 넘을 때만 정리", () => {
	const now = Date.now();
	const old = new Date(now - TITLE_PRUNE_AFTER_MS - 1000).toISOString();
	const fresh = new Date(now - 1000).toISOString();
	assert.equal(isTitleFileStale(old, now - TITLE_PRUNE_AFTER_MS - 1000, now), true);
	assert.equal(isTitleFileStale(old, now - 1000, now), false); // mtime 최근이면 유지
	assert.equal(isTitleFileStale(fresh, now - TITLE_PRUNE_AFTER_MS - 1000, now), false); // at 최근이면 유지
	assert.equal(isTitleFileStale("깨진날짜", undefined, now), false); // 판단 불가면 유지
	assert.equal(isTitleFileStale(undefined, undefined, now), false);
});
