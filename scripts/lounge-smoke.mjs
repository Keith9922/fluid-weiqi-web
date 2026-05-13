// Lounge protocol smoke test:
//   1. Public room appears in lounge snapshot + receives live updates.
//   2. Private room does NOT appear in lounge.
//   3. Spectator joins, gets roomState with yourPlayerIndex=-1, can't act.
//   4. loungeRoomUpdate fires when a stone is placed (stage transitions).
//   5. unsubscribeLounge stops update flow.
//
// Requires the dev server to be running on ws://localhost:8787 (or URL env).

const URL = process.env.URL ?? "ws://localhost:8787";

function connect(name, log = false) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(URL);
		const messages = [];
		ws.addEventListener("open", () => resolve({ ws, messages, name }));
		ws.addEventListener("error", () => reject(new Error(`ws error (${name})`)));
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
			messages.push(msg);
			if (log) console.log(`[${name} <-]`, msg.t);
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

let pass = 0, fail = 0;
function ok(label, cond, detail) {
	if (cond) { console.log(`  ✓ ${label}`); pass++; }
	else { console.log(`  ✗ ${label}`, detail ?? ""); fail++; }
}

async function main() {
	console.log("Lounge protocol smoke against", URL);

	// Setup: three clients.
	const host = await connect("HOST");
	const observer = await connect("OBS");
	const spectator = await connect("SPEC");

	// --- Step 1: observer subscribes (empty) ---
	observer.ws.send(JSON.stringify({ t: "subscribeLounge" }));
	const initialSnap = await waitFor(observer.messages, m => m.t === "loungeSnapshot");
	console.log(`\n=== initial lounge snapshot: ${initialSnap.rooms.length} room(s) ===`);
	const initialRoomCount = initialSnap.rooms.length;

	// --- Step 2: host creates a PUBLIC room ---
	host.ws.send(JSON.stringify({
		t: "createRoom",
		playerName: "Host",
		roomName: "我的棋室",
		visibility: "public",
	}));
	const hostJoined = await waitFor(host.messages, m => m.t === "roomState");
	const roomCode = hostJoined.roomCode;
	console.log(`\n=== host created public room ${roomCode} ===`);
	ok("host got roomState", hostJoined.t === "roomState");
	ok("host's playerIndex is 0", hostJoined.yourPlayerIndex === 0);
	ok("roomName plumbed back", hostJoined.roomName === "我的棋室");
	ok("visibility plumbed back", hostJoined.visibility === "public");

	const added = await waitFor(observer.messages, m =>
		m.t === "loungeRoomUpdate" && m.kind === "added" && m.roomCode === roomCode);
	ok("observer got loungeRoomUpdate(added)", !!added);
	ok("summary has room name", added.summary?.roomName === "我的棋室");
	ok("summary stage is 'waiting'", added.summary?.stage === "waiting");

	// --- Step 3: host creates a PRIVATE room — should NOT appear in lounge ---
	const host2 = await connect("HOST2");
	host2.ws.send(JSON.stringify({
		t: "createRoom",
		playerName: "Host2",
		roomName: "私密对局",
		visibility: "private",
	}));
	await waitFor(host2.messages, m => m.t === "roomState");
	// Give the server a moment in case it would broadcast.
	await new Promise(r => setTimeout(r, 150));
	const privateLeak = observer.messages.find(m =>
		m.t === "loungeRoomUpdate" && m.summary?.roomName === "私密对局");
	ok("private room does NOT leak to lounge", !privateLeak);
	host2.ws.close();

	// --- Step 4: spectator joins via spectateRoom ---
	spectator.ws.send(JSON.stringify({
		t: "spectateRoom",
		roomCode,
		viewerName: "围观群众",
	}));
	const specState = await waitFor(spectator.messages, m => m.t === "roomState" && m.roomCode === roomCode);
	ok("spectator got roomState", !!specState);
	ok("spectator's playerIndex is -1", specState.yourPlayerIndex === -1);
	ok("spectator sees board snapshot", specState.snapshot !== null);

	const specCountUpdate = await waitFor(observer.messages, m =>
		m.t === "loungeRoomUpdate" && m.roomCode === roomCode && (m.summary?.spectatorCount ?? 0) >= 1);
	ok("observer sees spectatorCount >= 1 update", !!specCountUpdate);

	// --- Step 5: spectator's action gets rejected ---
	spectator.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 0, actionType: "place", position: { x: 4, y: 4 }, turnSeq: 0, actionSeq: 0 },
	}));
	const err = await waitFor(spectator.messages, m => m.t === "error");
	ok("spectator action rejected with 'spectators cannot act'", err.reason.includes("spectator"));

	// --- Step 6: a second player joins; stage flips to playing ---
	const player2 = await connect("P2");
	player2.ws.send(JSON.stringify({ t: "joinRoom", roomCode, playerName: "P2" }));
	await waitFor(player2.messages, m => m.t === "roomState" && m.matchStarted);
	const stagePlaying = await waitFor(observer.messages, m =>
		m.t === "loungeRoomUpdate" && m.roomCode === roomCode && m.summary?.stage === "playing");
	ok("observer sees stage→playing", !!stagePlaying);
	ok("playerCount = 2 in summary", stagePlaying.summary?.playerCount === 2);

	// --- Step 7: unsubscribe stops flow ---
	observer.ws.send(JSON.stringify({ t: "unsubscribeLounge" }));
	const tagBefore = observer.messages.length;
	// Trigger another lounge update.
	host.ws.send(JSON.stringify({
		t: "action",
		roomCode,
		action: { playerIndex: 0, actionType: "place", position: { x: 6, y: 6 }, turnSeq: 0, actionSeq: 0 },
	}));
	await waitFor(host.messages, m => m.t === "actionAccepted");
	// Allow time for any (unwanted) lounge broadcast.
	await new Promise(r => setTimeout(r, 200));
	const newLounge = observer.messages.slice(tagBefore).filter(m => m.t === "loungeRoomUpdate");
	ok("after unsubscribe, no further lounge updates", newLounge.length === 0,
		newLounge.length > 0 ? `(got ${newLounge.length})` : undefined);

	// Spectator sees the action propagate via roomState/actionAccepted (not lounge).
	const specPlaced = await waitFor(spectator.messages, m => m.t === "actionAccepted" && m.snapshot.board.stones.length >= 1);
	ok("spectator receives broadcast actionAccepted", !!specPlaced);

	// Cleanup
	host.ws.close();
	player2.ws.close();
	spectator.ws.close();
	observer.ws.close();

	console.log(`\n${pass}/${pass + fail} passed`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
