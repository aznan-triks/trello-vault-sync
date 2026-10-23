import { describe, expect, test } from "vitest";
import {
	DEFAULT_SECTION_KEY,
	insertCard,
	isSeparatorCard,
	positionInSection,
	sectionOfNote,
	sectionRulesFrom,
	sectionTarget,
	splitSections,
	type SectionCard,
	type SectionRules,
} from "../src/core/sections";

const SEP_LABEL = "Separator";
const sep = (name: string, pos: number): SectionCard => ({ name, pos, labels: [{ name: SEP_LABEL }] });
const item = (name: string, pos: number): SectionCard => ({ name, pos, labels: [] });
const isSep = (card: SectionCard) => isSeparatorCard(card, SEP_LABEL);
const names = (cards: readonly SectionCard[]) => cards.map((c) => c.name);

const RULES: SectionRules = { labelName: SEP_LABEL, placement: "last", source: "auto", frontmatterKey: DEFAULT_SECTION_KEY };

describe("isSeparatorCard", () => {
	test("matches the label without caring for case or spaces", () => {
		expect(isSeparatorCard({ name: "x", labels: [{ name: " SEPARATOR " }] }, "separator")).toBe(true);
	});

	test("a card with other labels, none, or an empty setting is not a separator", () => {
		expect(isSeparatorCard({ name: "x", labels: [{ name: "Other" }] }, SEP_LABEL)).toBe(false);
		expect(isSeparatorCard({ name: "x" }, SEP_LABEL)).toBe(false);
		expect(isSeparatorCard({ name: "x", labels: [{ name: "" }] }, "")).toBe(false);
	});
});

describe("splitSections", () => {
	test("no separator: one section without a separator", () => {
		const sections = splitSections([item("a", 2), item("b", 1)], isSep);
		expect(sections).toHaveLength(1);
		expect(sections[0]?.separator).toBeNull();
		expect(names(sections[0]?.cards ?? [])).toEqual(["b", "a"]);
	});

	test("a separator at the head: no leading section without a separator", () => {
		const sections = splitSections([item("a", 2), sep("S1", 1), item("b", 3)], isSep);
		expect(sections.map((s) => s.separator?.name)).toEqual(["S1"]);
		expect(names(sections[0]?.cards ?? [])).toEqual(["a", "b"]);
	});

	test("cards before the first separator form a section nobody targets", () => {
		const sections = splitSections([item("lead", 1), sep("S1", 2), item("a", 3)], isSep);
		expect(sections.map((s) => s.separator?.name ?? null)).toEqual([null, "S1"]);
		expect(names(sections[0]?.cards ?? [])).toEqual(["lead"]);
	});

	test("a separator at the end gives an empty last section", () => {
		const sections = splitSections([sep("S1", 1), item("a", 2), sep("S2", 3)], isSep);
		expect(sections.map((s) => [s.separator?.name, names(s.cards)])).toEqual([
			["S1", ["a"]],
			["S2", []],
		]);
	});

	test("two adjacent separators: the first section is empty", () => {
		const sections = splitSections([sep("S1", 1), sep("S2", 2), item("a", 3)], isSep);
		expect(sections.map((s) => [s.separator?.name, names(s.cards)])).toEqual([
			["S1", []],
			["S2", ["a"]],
		]);
	});

	test("an empty list has no sections; a card without a pos goes last", () => {
		expect(splitSections([], isSep)).toEqual([]);
		const sections = splitSections([{ name: "nopos" }, sep("S1", 1)], isSep);
		expect(sections.map((s) => [s.separator?.name, names(s.cards)])).toEqual([["S1", ["nopos"]]]);
	});
});

describe("sectionOfNote", () => {
	const auto = { source: "auto", frontmatterKey: DEFAULT_SECTION_KEY } as const;

	test("auto: the property wins over the subfolder", () => {
		expect(sectionOfNote("World/Cities/Nord/x.md", "World", { [DEFAULT_SECTION_KEY]: "Capitals" }, auto)).toBe("Capitals");
	});

	test("auto: without the property, the first-level subfolder", () => {
		expect(sectionOfNote("World/Cities/Nord/x.md", "World", {}, auto)).toBe("Cities");
		expect(sectionOfNote("World/Cities/x.md", "World/", null, auto)).toBe("Cities");
	});

	test("a note straight in the mapped folder, or outside it, names no section", () => {
		expect(sectionOfNote("World/x.md", "World", {}, auto)).toBeNull();
		expect(sectionOfNote("Elsewhere/Cities/x.md", "World", {}, auto)).toBeNull();
		expect(sectionOfNote("World/Cities/x.md", undefined, {}, auto)).toBeNull();
	});

	test("frontmatter only: the subfolder is ignored; a blank value is no value; a number is read as text", () => {
		const rules = { source: "frontmatter", frontmatterKey: "section" } as const;
		expect(sectionOfNote("World/Cities/x.md", "World", {}, rules)).toBeNull();
		expect(sectionOfNote("World/x.md", "World", { section: "  " }, rules)).toBeNull();
		expect(sectionOfNote("World/x.md", "World", { section: " Cities 🏙️ " }, rules)).toBe("Cities 🏙️");
		expect(sectionOfNote("World/x.md", "World", { section: 2024 }, rules)).toBe("2024");
		expect(sectionOfNote("World/x.md", "World", { section: ["a"] }, rules)).toBeNull();
	});

	test("subfolder only: the property is ignored", () => {
		const rules = { source: "subfolder", frontmatterKey: DEFAULT_SECTION_KEY } as const;
		expect(sectionOfNote("World/Cities/x.md", "World", { [DEFAULT_SECTION_KEY]: "Capitals" }, rules)).toBe("Cities");
	});

	test("a mapping on the whole vault: the first folder of the path", () => {
		expect(sectionOfNote("Cities/x.md", "", {}, auto)).toBe("Cities");
		expect(sectionOfNote("x.md", "", {}, auto)).toBeNull();
	});
});

describe("positionInSection", () => {
	// S1 (10): a (20), b (30) | S2 (40): c (50) | S3 (60): empty
	const sections = () =>
		splitSections([sep("S1", 10), item("a", 20), item("b", 30), sep("S2", 40), item("c", 50), sep("S3", 60)], isSep);

	test("first: halfway between the separator and the section's first card", () => {
		expect(positionInSection(sections(), "S1", "first")).toBe(15);
		expect(positionInSection(sections(), "S2", "first")).toBe(45);
	});

	test("last: halfway between the section's last card and the next separator", () => {
		expect(positionInSection(sections(), "S1", "last")).toBe(35);
		expect(positionInSection(sections(), "S2", "last")).toBe(55);
	});

	test("an empty section sits between its separator and the next", () => {
		const gap = splitSections([sep("S1", 10), sep("S2", 40), item("c", 50)], isSep);
		expect(positionInSection(gap, "S1", "first")).toBe(25);
		expect(positionInSection(gap, "S1", "last")).toBe(25);
	});

	test("the last section: last is the bottom of the list, first goes after the separator", () => {
		expect(positionInSection(sections(), "S3", "last")).toBe("bottom");
		expect(positionInSection(sections(), "S3", "first")).toBe("bottom");
		const filled = splitSections([sep("S1", 10), item("a", 20)], isSep);
		expect(positionInSection(filled, "S1", "last")).toBe("bottom");
		expect(positionInSection(filled, "S1", "first")).toBe(15);
	});

	test("a separator that is the very first card of the list", () => {
		const head = splitSections([sep("S1", 1), item("a", 2)], isSep);
		expect(positionInSection(head, "S1", "first")).toBe(1.5);
	});

	test("the name is compared like a note name: case, spaces and forbidden characters", () => {
		const emoji = splitSections([sep("Villes 🏙️", 10), sep("Légion: Anti-démons", 20), item("a", 30)], isSep);
		expect(positionInSection(emoji, "villes 🏙️ ", "first")).toBe(15);
		expect(positionInSection(emoji, "Légion- Anti-démons", "first")).toBe(25);
	});

	test("no separator by that name: null; no usable pos: bottom", () => {
		expect(positionInSection(sections(), "Nope", "last")).toBeNull();
		expect(positionInSection(splitSections([sep("S1", 10)], isSep), "S1", "first")).toBe("bottom");
		expect(positionInSection(splitSections([sep("S1", 10), { name: "nopos" }], isSep), "S1", "first")).toBe("bottom");
	});
});

describe("sectionTarget", () => {
	const sections = splitSections([sep("Cities", 10), item("a", 20), sep("Races", 30)], isSep);

	test("a note in the subfolder of an existing section", () => {
		expect(sectionTarget(sections, "World/Cities/x.md", "World", {}, RULES)).toEqual({ pos: 25, section: "Cities", missing: null });
	});

	test("a note whose section does not exist: the bottom, and the name to report", () => {
		expect(sectionTarget(sections, "World/Ghosts/x.md", "World", {}, RULES)).toEqual({ pos: "bottom", section: null, missing: "Ghosts" });
	});

	test("a note naming no section: the bottom, nothing to report", () => {
		expect(sectionTarget(sections, "World/x.md", "World", {}, RULES)).toEqual({ pos: "bottom", section: null, missing: null });
	});
});

describe("insertCard", () => {
	test("files the card in the section its pos falls in, ahead of the next placement", () => {
		const sections = splitSections([sep("S1", 10), item("a", 20), sep("S2", 40)], isSep);
		insertCard(sections, item("new", 30));
		expect(names(sections[0]?.cards ?? [])).toEqual(["a", "new"]);
		expect(positionInSection(sections, "S1", "last")).toBe(35);
		expect(positionInSection(sections, "S1", "first")).toBe(15);
	});

	test("a card at the bottom lands in the last section; none yet starts one", () => {
		const sections = splitSections([sep("S1", 10), sep("S2", 40)], isSep);
		insertCard(sections, item("new", 99));
		expect(names(sections[1]?.cards ?? [])).toEqual(["new"]);
		insertCard(sections, { name: "nopos" });
		expect(names(sections[1]?.cards ?? [])).toEqual(["new", "nopos"]);
		const empty = splitSections<SectionCard>([], isSep);
		insertCard(empty, item("first", 1));
		expect(empty).toEqual([{ separator: null, cards: [item("first", 1)] }]);
	});
});

describe("sectionRulesFrom", () => {
	const settings = { separatorLabelName: " Separator ", separatorPlacement: "first", sectionSource: "subfolder", sectionFrontmatterKey: "k" } as const;

	test("empty label: the feature is off", () => {
		expect(sectionRulesFrom({ ...settings, separatorLabelName: "  " })).toBeNull();
	});

	test("a label: the rules, label trimmed", () => {
		expect(sectionRulesFrom(settings)).toEqual({ labelName: "Separator", placement: "first", source: "subfolder", frontmatterKey: "k" });
	});
});
