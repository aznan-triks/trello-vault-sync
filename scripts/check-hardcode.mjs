// Automates the §8 CONTEXT.md greps that `tsc`/`vitest`/esbuild can't catch:
// a hardcoded "trello_xxx" frontmatter key outside its single DEFAULT_ constant,
// and an isolation-breaking import into a layer that must stay Obsidian-free.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function tsFilesUnder(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
		else if (path.endsWith(".ts")) out.push(path);
	}
	return out;
}

const ALL_SRC_FILES = tsFilesUnder("src");
const errors = [];

// A "trello_xxx" string literal may only appear once per key: on the line that
// defines its DEFAULT_..._KEY/DEFAULT_CHECKLIST_HEADING constant in src/core/.
// Anywhere else, the key must be threaded through settings, never re-typed.
const TRELLO_KEY_LITERAL = /"trello_[a-z_]+"/;
const DEFAULT_CONST_LINE = /^export const DEFAULT_[A-Z_]+ = "trello_[a-z_]+";$/;

for (const file of ALL_SRC_FILES) {
	const isCore = file.startsWith(join("src", "core"));
	readFileSync(file, "utf8")
		.split("\n")
		.forEach((line, index) => {
			if (!TRELLO_KEY_LITERAL.test(line)) return;
			if (isCore && DEFAULT_CONST_LINE.test(line.trim())) return;
			errors.push(`${file}:${index + 1}: hardcoded Trello frontmatter key — thread it through settings instead: ${line.trim()}`);
		});
}

const OBSIDIAN_IMPORT = /from "obsidian"/;
const OBSIDIAN_API_USAGE = /\bTFile\b|\bapp\.vault\b|\bapp\.workspace\b/;

for (const file of ALL_SRC_FILES) {
	const content = readFileSync(file, "utf8");
	if ((file.startsWith(join("src", "core")) || file.startsWith(join("src", "trello"))) && OBSIDIAN_IMPORT.test(content)) {
		errors.push(`${file}: imports "obsidian" — src/core/ and src/trello/ must stay testable in plain Node (CONTEXT.md §1.2).`);
	}
	if (file.startsWith(join("src", "features")) && OBSIDIAN_API_USAGE.test(content)) {
		errors.push(`${file}: references TFile/app.vault/app.workspace — src/features/ must depend on VaultGateway/TrelloClient only (CONTEXT.md §1.2).`);
	}
}

if (errors.length > 0) {
	console.error(`check-hardcode: ${errors.length} violation(s) of CONTEXT.md §1.4/§1.2/§8:\n`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}

console.log("check-hardcode: no hardcoded Trello frontmatter key, no layer-isolation violation.");
