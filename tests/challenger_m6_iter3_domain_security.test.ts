import { describe, expect, test } from "vitest";
import { isTrelloUrl } from "../src/core/staleProperties";

describe("Challenger M6 Iteration 3: Advanced Domain Security & Stress Harness", () => {
	describe("1. Verified Acceptance of Mandatory Regional & Dualstack Domains", () => {
		test("accepts s3-us-west-2 regional format", () => {
			expect(isTrelloUrl("https://trello-attachments.s3-us-west-2.amazonaws.com/5a123/cover.jpg")).toBe(true);
			expect(isTrelloUrl("https://trello-backgrounds.s3-us-west-2.amazonaws.com/bg.png")).toBe(true);
		});

		test("accepts s3.eu-central-1 regional format", () => {
			expect(isTrelloUrl("https://trello-attachments.s3.eu-central-1.amazonaws.com/5a123/cover.png")).toBe(true);
			expect(isTrelloUrl("https://trello-backgrounds.s3.eu-central-1.amazonaws.com/bg.png")).toBe(true);
		});

		test("accepts s3.dualstack.us-east-1 and other dualstack endpoints", () => {
			const dualstackUrls = [
				"https://trello-attachments.s3.dualstack.us-east-1.amazonaws.com/5a123/cover.jpg",
				"https://trello-attachments.s3-dualstack.us-east-1.amazonaws.com/5a123/cover.jpg",
				"https://trello-backgrounds.s3.dualstack.us-east-1.amazonaws.com/bg.png",
				"https://trello-backgrounds.s3-dualstack.us-east-1.amazonaws.com/bg.png",
				"https://trello-attachments.s3.dualstack.eu-west-1.amazonaws.com/5a123/cover.png",
				"https://trello-attachments.s3.dualstack.ap-southeast-2.amazonaws.com/5a123/cover.jpg",
			];
			for (const url of dualstackUrls) {
				expect(isTrelloUrl(url), `Expected true for dualstack URL: ${url}`).toBe(true);
			}
		});

		test("is case-insensitive for domain names with standard scheme", () => {
			expect(isTrelloUrl("https://TRELLO-ATTACHMENTS.S3.EU-CENTRAL-1.AMAZONAWS.COM/file.jpg")).toBe(true);
			expect(isTrelloUrl("https://TRELLO.COM/c/123")).toBe(true);
		});
	});

	describe("2. Strict Rejection of Mandatory & Advanced Spoofed Domains", () => {
		test("strictly rejects mandatory spoofed domains from prompt", () => {
			// Explicitly required by challenger prompt:
			expect(isTrelloUrl("https://trello-attachments.s3-evil.amazonaws.com")).toBe(false);
			expect(isTrelloUrl("https://trello-backgrounds.s3-evil.amazonaws.com")).toBe(false);
			expect(isTrelloUrl("https://trello-attachments.s3.evil-zone.amazonaws.com")).toBe(false);
		});

		test("strictly rejects sibling, prefix, suffix, and subdomain spoofing attempts", () => {
			const spoofedUrls = [
				// Attacker controlled AWS buckets
				"https://trello-attachments.s3.evil.amazonaws.com",
				"https://trello-attachments.s3-evil-zone.amazonaws.com",
				"https://trello-backgrounds.s3.evil.amazonaws.com",
				"https://trello-backgrounds.s3-evil-zone.amazonaws.com",
				"https://trello-backgrounds.s3.evil-zone.amazonaws.com",
				"https://evil-trello-attachments.s3.amazonaws.com",
				"https://evil-trello-backgrounds.s3.amazonaws.com",
				"https://trello-attachments-fake.s3.amazonaws.com",
				"https://trello-attachments.s3.amazonaws.com.evil.com",
				"https://trello-attachments.s3.evil.s3.amazonaws.com",
				"https://trello-attachments.s3-us-west-2.evil.com",
				"https://trello-attachments.s3-fake.amazonaws.com",
				// Subdomain & userinfo injection
				"https://trello.com@evil.com/cover.jpg",
				"https://user:trello.com@evil.com/cover.jpg",
				"https://evil.com/#https://trello.com",
				"https://evil.com/?url=https://trello.com",
				"https://not-trello.com/cover.jpg",
				"https://trello.com.attacker.com/cover.jpg",
				"https://faketrello.com/cover.jpg",
				// Non-standard schemes
				"javascript:alert(1)",
				"data:image/png;base64,iVBORw0KGgo=",
				"file:///trello.com/cover.png",
				"ftp://trello.com/cover.png",
				"app://obsidian.md/icon.png",
			];

			for (const url of spoofedUrls) {
				expect(isTrelloUrl(url), `Expected false for spoofed URL: ${url}`).toBe(false);
			}
		});

		test("strictly rejects malformed, non-string, and local paths", () => {
			expect(isTrelloUrl(null)).toBe(false);
			expect(isTrelloUrl(undefined)).toBe(false);
			expect(isTrelloUrl(12345)).toBe(false);
			expect(isTrelloUrl({})).toBe(false);
			expect(isTrelloUrl([])).toBe(false);
			expect(isTrelloUrl("")).toBe(false);
			expect(isTrelloUrl("    ")).toBe(false);
			expect(isTrelloUrl("[[landscape.png]]")).toBe(false);
			expect(isTrelloUrl("assets/covers/header.jpg")).toBe(false);
			expect(isTrelloUrl("C:\\vault\\cover.png")).toBe(false);
		});
	});

	describe("3. ReDoS (Catastrophic Backtracking) & Performance Stress Harness", () => {
		test("executes in microseconds even with pathological backtracking payloads", () => {
			// Craft inputs targeting [a-z0-9]+(?:-[a-z0-9]+)+-\d+
			const pathologicalInputs = [
				// Long repeated hyphens and tokens without terminating digit
				"https://trello-attachments.s3." + "a-".repeat(100) + "b.amazonaws.com",
				"https://trello-attachments.s3-" + "abc-def-".repeat(100) + "ghi.amazonaws.com",
				"https://trello-backgrounds.s3." + "zone-".repeat(200) + "end.amazonaws.com",
				// Deep nested subdomains
				"https://" + "sub.".repeat(100) + "trello.com/cover.jpg",
				// Huge path and query string
				"https://trello.com/c/123/cover.png?" + "param=value&".repeat(500),
			];

			for (const input of pathologicalInputs) {
				const start = performance.now();
				isTrelloUrl(input);
				const duration = performance.now() - start;
				// Must evaluate well under 10ms (virtually instantaneous, no exponential backtracking)
				expect(duration).toBeLessThan(10);
			}
		});

		test("stress benchmark: 5,000 URLs evaluated in < 150ms", () => {
			const urls = [
				"https://trello-attachments.s3-us-west-2.amazonaws.com/5a123/cover.jpg",
				"https://trello-attachments.s3.eu-central-1.amazonaws.com/5a123/cover.png",
				"https://trello-attachments.s3.dualstack.us-east-1.amazonaws.com/5a123/cover.jpg",
				"https://trello-attachments.s3-evil.amazonaws.com",
				"https://trello-backgrounds.s3-evil.amazonaws.com",
				"https://trello-attachments.s3.evil-zone.amazonaws.com",
				"https://trello.com/c/12345/card",
				"assets/covers/header.jpg",
				"[[cover.png]]",
				"https://unsplash.com/photos/12345",
			];

			const start = performance.now();
			for (let i = 0; i < 500; i++) {
				for (const u of urls) {
					isTrelloUrl(u);
				}
			}
			const duration = performance.now() - start;
			expect(duration).toBeLessThan(150);
		});
	});
});
