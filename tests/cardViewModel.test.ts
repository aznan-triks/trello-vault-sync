import { describe, expect, test } from "vitest";
import {
	ALL_CARD_VIEW_SECTIONS,
	DEFAULT_CARD_VIEW_SETTINGS,
	cardLink,
	checklistProgress,
	dueState,
	normalizeCardViewSettings,
	normalizeSectionOrder,
	sectionOverride,
	setSectionOverride,
	type CardViewSection,
	visibleSections,
} from "../src/core/cardViewModel";

const NOW = new Date("2026-10-18T12:00:00Z").getTime();

describe("cardViewModel", () => {
	test("visibleSections follows the order, the global choice, and the per-card override", () => {
		const global = { ...DEFAULT_CARD_VIEW_SETTINGS.sections };
		const order = ["title", "comments", "cover", "labels"] as const;
		expect(visibleSections(order, global, undefined)).toEqual(["title", "comments", "labels"]);
		expect(visibleSections(order, global, { comments: false, cover: true })).toEqual(["title", "cover", "labels"]);
	});

	test("checklistProgress counts complete items", () => {
		expect(checklistProgress({ checkItems: [{ state: "complete" }, { state: "incomplete" }, { state: "complete" }] })).toEqual({ done: 2, total: 3 });
	});

	test("dueState: none, complete, overdue, soon, later", () => {
		expect(dueState(null, false, NOW, 24)).toBe("none");
		expect(dueState("2026-10-18T10:00:00Z", true, NOW, 24)).toBe("complete");
		expect(dueState("2026-10-18T10:00:00Z", false, NOW, 24)).toBe("overdue");
		expect(dueState("2026-10-19T06:00:00Z", false, NOW, 24)).toBe("soon");
		expect(dueState("2026-10-25T12:00:00Z", false, NOW, 24)).toBe("later");
	});

	test("cardLink opens in the desktop app with trello://", () => {
		expect(cardLink("https://trello.com/c/x", "browser")).toBe("https://trello.com/c/x");
		expect(cardLink("https://trello.com/c/x", "desktop-app")).toBe("trello://trello.com/c/x");
	});
});

describe("normalizeCardViewSettings", () => {
	test("defaults: on, editable, cover hidden", () => {
		const s = normalizeCardViewSettings(undefined);
		expect(s.enabled && s.allowEditing && s.editable.title).toBe(true);
		expect(s.sections.cover).toBe(false);
		expect(s.sections.comments).toBe(true);
		expect(s.cacheSeconds).toBe(60);
		expect(s.commentsLimit).toBe(20);
	});

	test("an unknown section is ignored and an incomplete order is completed at the end", () => {
		expect(normalizeSectionOrder(["comments", "bogus", "title", "comments"]).slice(0, 2)).toEqual(["comments", "title"]);
		expect(normalizeSectionOrder(["comments"])).toHaveLength(ALL_CARD_VIEW_SECTIONS.length);
	});

	test("negative numbers are floored, the comment limit is capped at Trello's 1000", () => {
		const s = normalizeCardViewSettings({ cacheSeconds: -5, followDelayMs: -1, commentsLimit: 99999, dueSoonHours: -2 });
		expect([s.cacheSeconds, s.followDelayMs, s.commentsLimit, s.dueSoonHours]).toEqual([0, 0, 1000, 0]);
	});

	test("per-card overrides keep only valid booleans and drop empty entries", () => {
		const s = normalizeCardViewSettings({ perCard: { a: { comments: false, bogus: true, title: "x" }, b: {}, c: 3 } });
		expect(s.perCard).toEqual({ a: { comments: false } });
	});

	test("wrong enumerations fall back", () => {
		const s = normalizeCardViewSettings({ side: "up", openLinksIn: "x", movedCardPosition: "middle" });
		expect([s.side, s.openLinksIn, s.movedCardPosition]).toEqual(["right", "browser", "top"]);
	});
});

describe("per-card section overrides", () => {
	test("show and hide are stored, default removes them, an empty card loses its entry", () => {
		const perCard: Record<string, Partial<Record<CardViewSection, boolean>>> = {};
		setSectionOverride(perCard, "c1", "comments", "hide");
		setSectionOverride(perCard, "c1", "cover", "show");
		expect(perCard).toEqual({ c1: { comments: false, cover: true } });
		expect(sectionOverride(perCard, "c1", "comments")).toBe("hide");
		expect(sectionOverride(perCard, "c1", "cover")).toBe("show");
		expect(sectionOverride(perCard, "c1", "due")).toBe("default");
		setSectionOverride(perCard, "c1", "comments", "default");
		setSectionOverride(perCard, "c1", "cover", "default");
		expect(perCard).toEqual({});
	});
});
