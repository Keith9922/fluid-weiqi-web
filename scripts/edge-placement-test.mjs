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

console.log("\n=== try every position on the 4 edges of an empty 13x13 ===");
let totalEdge = 0, accepted = 0;
const edgeCases = [];
for (let i = 0; i <= N; ++i) {
	for (const [x, y] of [[i, 0], [i, N], [0, i], [N, i]]) {
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
for (const [x, y] of [[0, 0], [0, N], [N, 0], [N, N]]) {
	const m = freshMatch();
	const res = tryPlace(m, 0, x, y);
	ok(`(${x}, ${y}) accepted`, res.accepted);
	if (!res.accepted) console.log(`    reason: ${res.reason}`);
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
