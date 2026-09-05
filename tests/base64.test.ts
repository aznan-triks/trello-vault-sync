import { describe, expect, test } from "vitest";
import { arrayBufferToBase64 } from "../src/core/base64";

describe("arrayBufferToBase64", () => {
	test("encodes bytes the same way Buffer.from(...).toString('base64') would", () => {
		const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
		expect(arrayBufferToBase64(bytes.buffer)).toBe("SGVsbG8=");
	});

	test("returns an empty string for an empty buffer", () => {
		expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
	});
});
