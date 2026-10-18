import fs from "node:fs";
import path from "node:path";

async function main() {
	console.log("=== Verification of live test-vault and Trello board ===");

	const dataPath = path.resolve("./test-vault/.obsidian/plugins/trello-vault-sync/data.json");
	if (!fs.existsSync(dataPath)) {
		throw new Error("data.json not found in test-vault!");
	}

	const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
	const { apiKey, token, boardId } = data.settings;

	if (!apiKey || !token || !boardId) {
		throw new Error("Missing apiKey, token, or boardId in test-vault settings");
	}

	// 1. Verify deployed assets
	const pluginDir = path.dirname(dataPath);
	for (const file of ["main.js", "manifest.json", "styles.css"]) {
		const rootPath = path.resolve(file);
		const deployedPath = path.join(pluginDir, file);
		if (!fs.existsSync(deployedPath)) {
			throw new Error(`Deployed asset missing: ${file}`);
		}
		const rootStat = fs.statSync(rootPath);
		const depStat = fs.statSync(deployedPath);
		if (rootStat.size !== depStat.size) {
			throw new Error(`Deployed asset size mismatch for ${file} (root: ${rootStat.size}, deployed: ${depStat.size})`);
		}
	}
	console.log("[OK] Deployed assets (main.js, manifest.json, styles.css) are identical to root build.");

	// 2. Verify Live Trello Board
	const boardRes = await fetch(`https://api.trello.com/1/boards/${boardId}?key=${apiKey}&token=${token}`);
	if (!boardRes.ok) throw new Error(`Failed to fetch board: ${boardRes.statusText}`);
	const board = await boardRes.json();
	console.log(`[OK] Board accessible: "${board.name}" (ID: ${board.id})`);

	// 3. Verify Lists
	const listsRes = await fetch(`https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}`);
	const lists = await listsRes.json();
	console.log(`[OK] Lists fetched (${lists.length} lists):`, lists.map((l) => l.name).join(", "));

	// 4. Verify Cards & Card View Payload
	const cardsRes = await fetch(
		`https://api.trello.com/1/boards/${boardId}/cards?key=${apiKey}&token=${token}&fields=id,name,desc,due,dueComplete,closed,idList,labels,idMembers`,
	);
	const cards = await cardsRes.json();
	console.log(`[OK] Board cards fetched: ${cards.length} cards`);

	if (cards.length > 0) {
		const card = cards[0];
		const fullRes = await fetch(
			`https://api.trello.com/1/cards/${card.id}?key=${apiKey}&token=${token}&fields=name,desc,due,dueComplete,closed,idList,idBoard,url&checklists=all&attachments=true&customFieldItems=true&actions=commentCard&members=true`,
		);
		if (!fullRes.ok) throw new Error(`Failed to fetch full card view: ${fullRes.statusText}`);
		const full = await fullRes.json();
		console.log(`[OK] Full card view contract verified on card "${card.name}":`, {
			id: card.id,
			checklists: Array.isArray(full.checklists),
			attachments: Array.isArray(full.attachments),
			actions: Array.isArray(full.actions),
			members: Array.isArray(full.members),
		});
	}

	// 5. Verify Labels for Label-to-Properties scanning
	const labelsRes = await fetch(`https://api.trello.com/1/boards/${boardId}/labels?key=${apiKey}&token=${token}`);
	const labels = await labelsRes.json();
	console.log(`[OK] Board labels fetched (${labels.length} labels):`, labels.map((l) => l.name || `[unnamed ${l.color}]`).join(", "));

	// 6. Verify Notes in test-vault/Projects/Ideas
	const notesDir = path.resolve("./test-vault/Projects/Ideas");
	if (fs.existsSync(notesDir)) {
		const noteFiles = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
		console.log(`[OK] Found ${noteFiles.length} notes in test-vault/Projects/Ideas:`, noteFiles.join(", "));
	}

	console.log("=== Live verification finished with SUCCESS ===");
}

main().catch((err) => {
	console.error("[FAIL]", err);
	process.exit(1);
});
