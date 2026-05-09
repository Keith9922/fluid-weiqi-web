// AI smoke test: create a vs-AI room and verify the AI plays back.
// Uses Node 22+ built-in WebSocket.

const URL = process.env.URL ?? "ws://localhost:8787";

function connect(name, log = false) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(URL);
		const messages = [];
		ws.addEventListener("open", () => resolve({ ws, messages }));
		ws.addEventListener("error", () => reject(new Error("ws error")));
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
			messages.push(msg);
			if (log) console.log(`[${name} <-]`, msg.t, msg.t === "actionAccepted"
				? `stones=${msg.snapshot.board.stones.length} player=${msg.snapshot.flow.currentPlayerIndex}`
				: msg.t === "aiThinking" ? `player=${msg.playerIndex}`
				: "");
		});
	});
}

async function waitFor(messages, predicate, timeoutMs = 30000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const m = messages.find(predicate);
		if (m) return m;
		await new Promise(r => setTimeout(r, 50));
	}
	throw new Error("timeout waiting for message");
}

async function testLevel(level) {
	console.log(`\n=== Testing AI level: ${level} ===`);
	const a = await connect(level, true);

	const t0 = Date.now();
	a.ws.send(JSON.stringify({
		t: "createAiRoom",
		playerName: "Tester",
		aiLevel: level,
		humanPlaysFirst: true,
		gameConfig: { boardSize: 9, stoneHardness: 0.25, stoneStrength: 1.0 },
	}));
	const initial = await waitFor(a.messages, m => m.t === "roomState" && m.matchStarted);
	console.log(`  room ${initial.roomCode}; players: ${initial.players.map(p => p.name).join(" vs ")}`);

	// Human plays first move at (4, 4).
	a.ws.send(JSON.stringify({
		t: "action",
		roomCode: initial.roomCode,
		action: { playerIndex: 0, actionType: "place", position: { x: 4, y: 4 }, turnSeq: 0, actionSeq: 0 },
	}));
	await waitFor(a.messages, m => m.t === "actionAccepted");
	console.log(`  human moved`);

	// Wait for the AI's response (actionAccepted with player 0 = next to move).
	const aiMove = await waitFor(a.messages, (m, i, arr) => {
		if (m.t !== "actionAccepted") return false;
		// Skip the human's own actionAccepted (snapshot has player 1 to move).
		if (m.snapshot.flow.currentPlayerIndex !== 0) return false;
		return true;
	}, 30000);
	const elapsed = Date.now() - t0;
	console.log(`  AI moved (took ${elapsed}ms total since createAiRoom)`);
	console.log(`  board now has ${aiMove.snapshot.board.stones.length} stones`);

	a.ws.close();
}

async function main() {
	console.log("Connecting to", URL);
	for (const level of ["easy", "medium", "hard"]) {
		await testLevel(level);
	}
	console.log("\nALL OK");
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
