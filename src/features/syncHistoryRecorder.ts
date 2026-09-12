import type { CardRef } from "../core/cardRef";
import { fingerprint, type SyncAction } from "../core/syncHistory";
import type { CardRefStore, TemplateResolver, VaultGateway } from "../obsidian/gateway";

/**
 * Wraps a vault so every mutating call also emits the `SyncAction` needed to
 * invert it later — `syncNote`/`syncFolder`/`syncVault` stay unaware history
 * recording exists, since they only ever see `VaultGateway`/`CardRefStore`.
 * Explicit per-method forwarding (not `{ ...vault }`): a real `ObsidianVault`
 * keeps its methods on the prototype, which a shallow spread would drop (same
 * pitfall already documented on `main.ts::withJournal`).
 */
export function wrapWithHistoryRecorder(
	vault: VaultGateway & CardRefStore & TemplateResolver,
	onAction: (action: SyncAction) => void,
): VaultGateway & CardRefStore & TemplateResolver {
	return {
		listNotes: (folder, excludedFolders) => vault.listNotes(folder, excludedFolders),
		noteAt: (path) => vault.noteAt(path),
		read: (note) => vault.read(note),
		exists: (path) => vault.exists(path),
		readFrontmatter: (note) => vault.readFrontmatter(note),
		getCardRef: (note) => vault.getCardRef(note),
		readTemplate: (name) => vault.readTemplate(name),

		write: async (note, content) => {
			const previousContent = await vault.read(note);
			await vault.write(note, content);
			onAction({ kind: "body", path: note.path, previousContent, fingerprint: fingerprint(content) });
		},

		writeFrontmatter: async (note, mutate) => {
			const previousContent = await vault.read(note);
			await vault.writeFrontmatter(note, mutate);
			const nextContent = await vault.read(note);
			onAction({ kind: "frontmatter", path: note.path, previousContent, fingerprint: fingerprint(nextContent) });
		},

		setCardRef: async (note: Parameters<CardRefStore["setCardRef"]>[0], ref: CardRef) => {
			const previousContent = await vault.read(note);
			await vault.setCardRef(note, ref);
			const nextContent = await vault.read(note);
			onAction({ kind: "frontmatter", path: note.path, previousContent, fingerprint: fingerprint(nextContent) });
		},

		create: async (path, content) => {
			const handle = await vault.create(path, content);
			onAction({ kind: "create", path, fingerprint: fingerprint(content) });
			return handle;
		},

		rename: async (note, newPath) => {
			const previousPath = note.path;
			const handle = await vault.rename(note, newPath);
			const content = await vault.read(handle);
			onAction({ kind: "rename", path: newPath, previousPath, fingerprint: fingerprint(content) });
			return handle;
		},

		trash: async (note) => {
			const previousContent = await vault.read(note);
			const path = note.path;
			await vault.trash(note);
			onAction({ kind: "trash", path, previousContent, fingerprint: null });
		},
	};
}
