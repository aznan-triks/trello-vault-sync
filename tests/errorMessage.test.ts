import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/core/errorMessage";

describe("errorMessage", () => {
	it("returns the message of an Error instance", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("returns the message of an Error subclass", () => {
		class CustomError extends Error {}
		expect(errorMessage(new CustomError("custom boom"))).toBe("custom boom");
	});

	it("stringifies a non-Error thrown value", () => {
		expect(errorMessage("just a string")).toBe("just a string");
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});
