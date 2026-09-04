import { describe, expect, test } from "vitest";
import { countSeverity } from "../src/core/countSeverity";

describe("countSeverity", () => {
	test("errors: ok at zero, error above zero", () => {
		expect(countSeverity("errors", 0)).toBe("ok");
		expect(countSeverity("errors", 1)).toBe("error");
		expect(countSeverity("errors", 5)).toBe("error");
	});

	test.each(["conflicts", "phantoms", "unlinked", "duplicates", "orphanCards", "unlinkedNotes", "misplaced"])(
		"%s: ok at zero, warn above zero",
		(key) => {
			expect(countSeverity(key, 0)).toBe("ok");
			expect(countSeverity(key, 1)).toBe("warn");
		},
	);

	test.each(["created", "adopted", "pulled", "pushed", "skipped", "renamed", "moved", "deleted", "comparedNotes", "changes"])(
		"%s is always neutral",
		(key) => {
			expect(countSeverity(key, 0)).toBe("neutral");
			expect(countSeverity(key, 42)).toBe("neutral");
		},
	);

	test("an unknown key defaults to neutral", () => {
		expect(countSeverity("somethingNew", 3)).toBe("neutral");
	});
});
