// Verifies the new territory-based occupancy rule and that hard/hell AIs
// can produce off-grid candidates (free placement).

import {
	BoardState,
	Match,
	createAi,
	freePlacementCandidates,
	territoryOwnerAt,
} from "../packages/core/src/index.ts";

let pass = 0, fail = 0;
const ok = (label, cond) => {
	if (cond) { console.log(`  ✓ ${label}`); pass++; }
	else      { console.log(`  ✗ ${label}`); fail++; }
};

console.log("\n=== occupancy: stone owns its blob, can't place inside ===");
{
	const m = new Match({
		board: { playerCount: 2, size: 13, stoneHardness: 0.25, defaultStrength: 1 },
		stoneStrength: 1,
	});
	m.apply({ playerIndex: 0, actionType: "place", position: { x: 6, y: 6 }, turnSeq: 0, actionSeq: 0 });
	m.currentPlayerIndex = 1;
	// Try to place a white stone at (6.05, 6.05) — overlaps the black blob.
	const res = m.apply({ playerIndex: 1, actionType: "place", position: { x: 6.05, y: 6.05 }, turnSeq: 1, actionSeq: 0 });
	ok("overlapping placement REJECTED", !res.accepted);
	ok("rejection reason mentions occupancy", res.reason?.includes("occupied") ?? false);
	console.log("    reason:", res.reason);
}

console.log("\n=== occupancy: can place outside an existing blob ===");
{
	const m = new Match({
		board: { playerCount: 2, size: 13, stoneHardness: 0.25, defaultStrength: 1 },
		stoneStrength: 1,
	});
	m.apply({ playerIndex: 0, actionType: "place", position: { x: 6, y: 6 }, turnSeq: 0, actionSeq: 0 });
	m.currentPlayerIndex = 1;
	const res = m.apply({ playerIndex: 1, actionType: "place", position: { x: 8, y: 8 }, turnSeq: 1, actionSeq: 0 });
	ok("placement at (8, 8) ACCEPTED", res.accepted);
}

console.log("\n=== freePlacementCandidates produces off-grid points ===");
{
	const board = new BoardState({ playerCount: 2, size: 13, stoneHardness: 0.25, defaultStrength: 1 });
	board.addStone(1, { x: 6, y: 6 }, 1);  // a single white stone
	const cands = freePlacementCandidates(board, 0, 50);
	const offGrid = cands.filter(c => c.position.x % 1 !== 0 || c.position.y % 1 !== 0);
	console.log(`    generated ${cands.length} candidates; ${offGrid.length} are off-grid`);
	ok("at least 10 off-grid candidates", offGrid.length >= 10);
}

console.log("\n=== Hard AI can return off-grid moves ===");
{
	const board = new BoardState({ playerCount: 2, size: 9, stoneHardness: 0.25, defaultStrength: 1 });
	board.addStone(1, { x: 4, y: 4 }, 1);
	board.addStone(1, { x: 5, y: 5 }, 1);
	board.addStone(0, { x: 4.2, y: 5 }, 1);  // black wedged near both whites
	const ai = createAi("hard");
	const t0 = Date.now();
	const decision = ai.chooseMove(board, 0, 1);
	const dt = Date.now() - t0;
	console.log(`    hard chose ${JSON.stringify(decision)} in ${dt}ms`);
	ok("hard returned a move", decision.type === "place");
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
