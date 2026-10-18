import { stripTrelloProperties } from "../core/trelloProperties";
import type { NoteHandle, VaultGateway } from "../obsidian/gateway";

/** Removes this plugin's Trello properties from a note; returns the removed keys. Dry-run only reports. */
export async function unlinkNote(
	vault: Pick<VaultGateway, "readFrontmatter" | "writeFrontmatter">,
	note: NoteHandle,
	keys: readonly string[],
	dryRun: boolean,
): Promise<string[]> {
	const frontmatter = vault.readFrontmatter(note) ?? {};
	const present = keys.filter((key) => key in frontmatter);
	if (present.length === 0 || dryRun) return present;
	let removed: string[] = [];
	await vault.writeFrontmatter(note, (fm) => {
		removed = stripTrelloProperties(fm, keys);
	});
	return removed;
}
