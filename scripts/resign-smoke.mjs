// E2E smoke test for the resign + win modal flow.
// Verifies: resign action accepted, match ends, winner = opponent,
// flow snapshot includes endReason + finalScore.

const URL = process.env.URL ?? "ws://localhost:8787";

function connect() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(URL);
		const messages = [];
		ws.addEventListener("open", () => resolve({ ws, messages }));
		ws.addEventListener("error", () => reject(new Error("ws error")));
		ws.addEventListener("message", ev => {
			messages.push(JSON.parse(typeof ev.data === "string" ? ev.data : ""));
		});
	});
}

function waitFor(messages, predicate, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const t0 = Date.now();
		const id = setInterval(() => {
			const m = messages.find(predicate);
			if (m) { clearInterval(id); resolve(m); }
			else if (Date.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error("timeout")); }
		}, 30);
	});
}

async function main() {
	console.log("Connecting...");
	const a = await connect();
	a.ws.send(JSON.stringify({
		t: "createAiRoom",
		playerName: "TestHuman",
		aiLevel: "easy",
		humanPlaysFirst: true,
		gameConfig: { boardSize: 9, stoneHardness: 0.25, stoneStrength: 1.0 },
	}));
	const initial = await waitFor(a.messages, m => m.t === "roomState" && m.matchStarted);
	console.log("Match started in room", initial.roomCode);

	// Place one stone
	a.ws.send(JSON.stringify({
		t: "action",
		roomCode: initial.roomCode,
		action: { playerIndex: 0, actionType: "place", position: { x: 4, y: 4 }, turnSeq: 0, actionSeq: 0 },
	}));
	await waitFor(a.messages, m => m.t === "actionAccepted");
	console.log("Placed first stone");

	// Wait for AI to respond so we're back to our turn
	await waitFor(a.messages, m => m.t === "actionAccepted" && m.snapshot.flow.currentPlayerIndex === 0, 8000);
	console.log("AI responded");

	// Now resign
	console.log("Sending resign...");
	a.ws.send(JSON.stringify({
		t: "action",
		roomCode: initial.roomCode,
		action: { playerIndex: 0, actionType: "resign", turnSeq: 999, actionSeq: 0 },
	}));
	const ended = await waitFor(a.messages, m =>
		m.t === "actionAccepted" && m.snapshot.flow.isEnded
	);
	const flow = ended.snapshot.flow;
	console.log("");
	console.log("=== resign result ===");
	console.log("isEnded:    ", flow.isEnded);
	console.log("winnerIndex:", flow.winnerIndex, "(should be 1 = AI)");
	console.log("endReason:  ", flow.endReason, "(should be 'resign')");
	console.log("finalScore: ", JSON.stringify(flow.finalScore));

	const ok = flow.isEnded && flow.winnerIndex === 1 && flow.endReason === "resign"
	  && Array.isArray(flow.finalScore) && flow.finalScore.length === 2;
	console.log("");
	console.log(ok ? "✓ RESIGN OK" : "✗ RESIGN FAILED");

	a.ws.close();
	process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
