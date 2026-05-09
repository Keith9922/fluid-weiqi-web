// End-to-end smoke test: simulate two clients playing a few moves through the
// WebSocket server. Asserts the protocol round-trips correctly.
// Uses Node's built-in WebSocket (Node 22+).

const URL = process.env.URL ?? "ws://localhost:8787";

function connect(name, log) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(URL);
		const messages = [];
		ws.addEventListener("open", () => resolve({ ws, messages }));
		ws.addEventListener("error", () => reject(new Error("ws error")));
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
			messages.push(msg);
			if (log) console.log(`[${name} <-]`, msg.t, msg.t === "roomState" ? `players=${msg.players.map(p => p.connected ? p.name : "-").join(",")}` : "");
		});
	});
}

async function waitFor(messages, predicate, timeoutMs = 2000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const m = messages.find(predicate);
		if (m) return m;
		await new Promise(r => setTimeout(r, 30));
	}
	throw new Error("timeout waiting for message");
}

async function main() {
	console.log("Connecting two clients to", URL);

	const a = await connect("A", true);
	const b = await connect("B", true);

	// A creates the room.
	a.ws.send(JSON.stringify({ t: "createRoom", playerName: "Alice" }));
	const aJoined = await waitFor(a.messages, m => m.t === "roomState");
	const roomCode = aJoined.roomCode;
	console.log(`✓ Room created: ${roomCode}; A is player ${aJoined.yourPlayerIndex}`);

	// B joins.
	b.ws.send(JSON.stringify({ t: "joinRoom", roomCode, playerName: "Bob" }));
	const bJoined = await waitFor(b.messages, m => m.t === "roomState" && m.matchStarted);
	console.log(`✓ B joined as player ${bJoined.yourPlayerIndex}; matchStarted=${bJoined.matchStarted}`);

	// A places a stone at (4, 4).
	a.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 0, actionType: "place", position: { x: 4, y: 4 }, turnSeq: 0, actionSeq: 0 },
	}));
	const placed = await waitFor(a.messages, m => m.t === "actionAccepted");
	console.log(`✓ A placed; stones=${placed.snapshot.board.stones.length}, currentPlayer=${placed.snapshot.flow.currentPlayerIndex}`);

	// B places at (15, 15).
	b.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 1, actionType: "place", position: { x: 15, y: 15 }, turnSeq: 1, actionSeq: 0 },
	}));
	const placed2 = await waitFor(b.messages, m => m.t === "actionAccepted" && m.snapshot.board.stones.length === 2);
	console.log(`✓ B placed; stones=${placed2.snapshot.board.stones.length}, currentPlayer=${placed2.snapshot.flow.currentPlayerIndex}`);

	// A tries to place where it's not their turn... oh wait, it IS A's turn now (currentPlayerIndex should be 0).
	// Try a rejected move: B trying to play on A's turn.
	b.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 1, actionType: "place", position: { x: 10, y: 10 }, turnSeq: 2, actionSeq: 0 },
	}));
	const rej = await waitFor(b.messages, m => m.t === "actionRejected");
	console.log(`✓ Rejection received (expected): ${rej.reason}`);

	// Test pass.
	a.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 0, actionType: "pass", turnSeq: 2, actionSeq: 0 },
	}));
	await waitFor(a.messages, m => m.t === "actionAccepted" && m.snapshot.flow.passStates[0]);
	console.log("✓ A passed");

	b.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 1, actionType: "pass", turnSeq: 3, actionSeq: 0 },
	}));
	const ended = await waitFor(b.messages, m => m.t === "actionAccepted" && m.snapshot.flow.isEnded);
	console.log(`✓ Both passed → match ended; winner=${ended.snapshot.flow.winnerIndex}`);

	a.ws.close();
	b.ws.close();
	console.log("\nALL OK");
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
