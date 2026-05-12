// Reproduce: can stones be placed on the outer edge of the board?
// In real Go, the outermost ring IS valid placement, so positions like
// (0, 0), (size-1, 0), (0, size-1), (size-1, size-1) should all work.

import { Match } from "../packages/core/src/index.ts";

function newMatch(size) {
	return new Match({
		board: { playerCount: 2, size, stoneHardness: 0.25, defaultStrength: 1 },
		stoneStrength: 1,
	});
}

let pass = 0, fail = 0;
const ok = (label, cond) => {
	if (cond) { console.log(`  ✓ ${label}`); pass++; }
	else      { console.log(`  ✗ ${label}`); fail++; }
};

function tryPlace(m, player, x, y) {
	m.currentPlayerIndex = player;
	return m.apply({
		playerIndex: player,
		actionType: "place",
		position: { x, y },
		turnSeq: m.turnSeq,
		actionSeq: 0,
	});
}

console.log("\n=== 13x13: integer edge positions ===");
{
	for (const [x, y] of [[0, 0], [12, 0], [0, 12], [12, 12], [0, 6], [12, 6], [6, 0], [6, 12]]) {
		const m = newMatch(13);
		const res = tryPlace(m, 0, x, y);
		ok(`place at (${x}, ${y})`, res.accepted);
		if (!res.accepted) console.log(`    reason: ${res.reason}`);
	}
}

console.log("\n=== 13x13: position 13 (the off-by-one boundary in current code) ===");
{
	const m = newMatch(13);
	const res = tryPlace(m, 0, 13, 6);
	console.log(`    position 13 accepted=${res.accepted} reason=${res.reason ?? "ok"}`);
}

console.log("\n=== 13x13: slightly-outside imprecise mobile taps ===");
{
	// These simulate a user who tapped the edge but their finger landed
	// 0.3–0.7 cells off (about 8–18px on a 414px-wide phone). With strict
	// withinBounds these would be rejected, leaving the user unable to
	// place on the edge.
	for (const [x, y] of [[-0.3, 6], [-0.6, 6], [13.3, 6], [13.6, 6], [6, -0.3], [6, 13.3]]) {
		const m = newMatch(13);
		const res = tryPlace(m, 0, x, y);
		console.log(`    place at (${x}, ${y}): ${res.accepted ? "ACCEPTED" : `REJECTED (${res.reason})`}`);
	}
}

console.log("\n=== 19x19: integer edge positions ===");
{
	for (const [x, y] of [[0, 0], [18, 0], [0, 18], [18, 18]]) {
		const m = newMatch(19);
		const res = tryPlace(m, 0, x, y);
		ok(`place at (${x}, ${y})`, res.accepted);
		if (!res.accepted) console.log(`    reason: ${res.reason}`);
	}
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
