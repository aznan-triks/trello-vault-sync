import { describe, expect, test } from "vitest";
import { isTrelloUrl } from "../src/core/staleProperties";

describe("Challenger M6 Iteration 2: Domain Security & isTrelloUrl Spoofing Harness", () => {
	describe("1. Legitimate Trello and S3 Storage Domains", () => {
		test("accepts global S3 attachment and background domains", () => {
			const globalDomains = [
				"https://trello-attachments.s3.amazonaws.com/5a123/cover.jpg",
				"http://trello-attachments.s3.amazonaws.com/5a123/cover.png",
				"https://trello-backgrounds.s3.amazonaws.com/bg.png",
				"http://trello-backgrounds.s3.amazonaws.com/bg.jpg",
			];
			for (const url of globalDomains) {
				expect(isTrelloUrl(url), `Expected true for global URL: ${url}`).toBe(true);
			}
		});

		test("accepts regional S3 domains with hyphens (legacy S3 format)", () => {
			const regionalHyphenDomains = [
				"https://trello-attachments.s3-us-west-2.amazonaws.com/5a123/cover.jpg",
				"https://trello-attachments.s3-eu-west-1.amazonaws.com/5a123/cover.png",
				"https://trello-attachments.s3-ap-southeast-1.amazonaws.com/5a123/cover.jpg",
				"https://trello-backgrounds.s3-us-west-2.amazonaws.com/bg.png",
				"https://trello-backgrounds.s3-eu-west-1.amazonaws.com/bg.png",
			];
			for (const url of regionalHyphenDomains) {
				expect(isTrelloUrl(url), `Expected true for regional hyphen URL: ${url}`).toBe(true);
			}
		});

		test("accepts regional S3 domains with dots (modern S3 format)", () => {
			const regionalDotDomains = [
				"https://trello-attachments.s3.us-west-2.amazonaws.com/5a123/cover.jpg",
				"https://trello-attachments.s3.eu-central-1.amazonaws.com/5a123/cover.png",
				"https://trello-attachments.s3.ap-northeast-1.amazonaws.com/5a123/cover.jpg",
				"https://trello-backgrounds.s3.eu-central-1.amazonaws.com/bg.png",
				"https://trello-backgrounds.s3.ap-southeast-2.amazonaws.com/bg.png",
			];
			for (const url of regionalDotDomains) {
				expect(isTrelloUrl(url), `Expected true for regional dot URL: ${url}`).toBe(true);
			}
		});

		test("accepts core Trello domains and subdomains", () => {
			const coreDomains = [
				"https://trello.com/c/12345/card-name",
				"https://trello.com/123/cover.png",
				"https://api.trello.com/1/cards/abc",
				"https://sub.trello.com/file.png",
				"https://deep.nested.trello.com/asset.jpg",
			];
			for (const url of coreDomains) {
				expect(isTrelloUrl(url), `Expected true for core Trello URL: ${url}`).toBe(true);
			}
		});
	});

	describe("2. Spoofed and Adversarial Domains", () => {
		test("rejects spoofed domains specified in challenge requirements", () => {
			// Requirements explicitly mandate testing these 5 spoofed domains:
			const requiredSpoofedDomains = [
				"https://trello-attachments.s3.evil.amazonaws.com",
				"https://trello-attachments.s3.evil.s3.amazonaws.com",
				"https://trello-attachments.s3-evil.amazonaws.com",
				"https://evil-trello-attachments.s3.amazonaws.com",
				"https://trello-attachments.s3.amazonaws.com.evil.com",
			];

			const failures: string[] = [];
			for (const url of requiredSpoofedDomains) {
				const recognized = isTrelloUrl(url);
				if (recognized) {
					failures.push(url);
				}
			}

			// All spoofed domains MUST be rejected (false)
			expect(failures, `Spoofed domains wrongly accepted as Trello URLs: ${failures.join(", ")}`).toEqual([]);
		});

		test("rejects spoofed background domains and sibling spoofing patterns", () => {
			const extraSpoofedDomains = [
				"https://trello-backgrounds.s3.evil.amazonaws.com",
				"https://trello-backgrounds.s3.evil.s3.amazonaws.com",
				"https://trello-backgrounds.s3-evil.amazonaws.com",
				"https://evil-trello-backgrounds.s3.amazonaws.com",
				"https://trello-backgrounds.s3.amazonaws.com.evil.com",
				"https://trello-attachments.s3.evil-zone.amazonaws.com",
				"https://trello-attachments.s3-evil-zone.amazonaws.com",
			];

			const failures: string[] = [];
			for (const url of extraSpoofedDomains) {
				if (isTrelloUrl(url)) {
					failures.push(url);
				}
			}

			expect(failures, `Extra spoofed domains wrongly accepted: ${failures.join(", ")}`).toEqual([]);
		});
	});
});
