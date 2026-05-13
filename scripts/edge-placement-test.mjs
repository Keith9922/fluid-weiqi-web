// Reproduce the "can't place on the edge" bug.
// Tests every cell on the outermost ring of a 13×13 board on an empty board.

import { Match } from "../packages/core/src/index.ts";

const N = 13;
let pass = 0, fail = 0;
const ok = (label, cond) => {
	if (cond) { console.log(`  ✓ ${label}`); pass++; }
	else { console.log(`  ✗ ${label}`); fail++; }
};

function freshMatch() {
	return new Match({
		board: { playerCount: 2, size: N, stoneHardness: 0.25, defaultStrength: 1 },
		stoneStrength: 1,
	});
}

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

// New model: a size-N board has intersections at integer coords 0..N-1.
// Edges are at coord 0 and coord N-1.
const EDGE_MIN = 0;
const EDGE_MAX = N - 1;
console.log(`\n=== try every position on the 4 edges of an empty ${N}x${N} ===`);
let totalEdge = 0, accepted = 0;
const edgeCases = [];
for (let i = EDGE_MIN; i <= EDGE_MAX; ++i) {
	for (const [x, y] of [[i, EDGE_MIN], [i, EDGE_MAX], [EDGE_MIN, i], [EDGE_MAX, i]]) {
		totalEdge++;
		const m = freshMatch();
		const res = tryPlace(m, 0, x, y);
		if (res.accepted) accepted++;
		else edgeCases.push({ x, y, reason: res.reason });
	}
}
console.log(`  total edge positions tried: ${totalEdge}`);
console.log(`  accepted: ${accepted}`);
console.log(`  rejected: ${edgeCases.length}`);
if (edgeCases.length) {
	console.log("  rejections (first 8):");
	for (const e of edgeCases.slice(0, 8)) {
		console.log(`    (${e.x}, ${e.y}): ${e.reason}`);
	}
}
ok("ALL edge positions accepted on empty board", edgeCases.length === 0);

console.log("\n=== try corner positions specifically ===");
for (const [x, y] of [
	[EDGE_MIN, EDGE_MIN],
	[EDGE_MIN, EDGE_MAX],
	[EDGE_MAX, EDGE_MIN],
	[EDGE_MAX, EDGE_MAX],
]) {
	const m = freshMatch();
	const res = tryPlace(m, 0, x, y);
	ok(`(${x}, ${y}) accepted`, res.accepted);
	if (!res.accepted) console.log(`    reason: ${res.reason}`);
}

console.log("\n=== a stone past the new max edge should be REJECTED ===");
{
	const m = freshMatch();
	const res = tryPlace(m, 0, N, 5);    // coord = N (= EDGE_MAX + 1) is out of bounds
	ok(`(${N}, 5) rejected`, !res.accepted);
	if (res.accepted) console.log("    WARN: placement at coord=N should be out of bounds in new model");
}

console.log("\n=== place a stone at (5,5), then try (0,5) — adjacent to playable edge ===");
{
	const m = freshMatch();
	tryPlace(m, 0, 5, 5);
	const res = tryPlace(m, 1, 0, 5);
	ok("(0, 5) still allowed after (5,5) placed", res.accepted);
	if (!res.accepted) console.log(`    reason: ${res.reason}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
