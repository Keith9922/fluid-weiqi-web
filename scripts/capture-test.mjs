// Capture-rule verification.
//
// Tests the threshold-based capture logic against representative scenarios
// the upstream Mac build handles correctly. Run with:
//
//   node --import tsx scripts/capture-test.mjs
//
// (tsx is in apps/server's devDependencies; the script imports the @fluid/core
// workspace package via its TS source.)

import {
	BoardState,
	buildAnalysis,
	computeChainStats,
	findCapturedStones,
	territoryOwnerAt,
} from "../packages/core/src/index.ts";

const HARDNESS = 0.25;
const STRENGTH = 1.0;

let passed = 0;
let failed = 0;

function expect(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		console.log(`  ✓ ${label}`);
		passed++;
	} else {
		console.log(`  ✗ ${label}`);
		console.log(`    expected: ${JSON.stringify(expected)}`);
		console.log(`    actual:   ${JSON.stringify(actual)}`);
		failed++;
	}
}

function makeBoard(stones) {
	const board = new BoardState({ playerCount: 2, size: 19, stoneHardness: HARDNESS, defaultStrength: STRENGTH });
	for (const s of stones) {
		board.addStone(s.player, { x: s.x, y: s.y }, STRENGTH);
	}
	return board;
}

function scenarioName(name) {
	console.log(`\n${name}`);
}

// ---- Influence sanity checks ---------------------------------------------

scenarioName("territoryOwnerAt threshold behavior");
{
	const board = makeBoard([{ player: 0, x: 5, y: 5 }]);
	const stones = board.stones;

	// At the stone center, total influence is at the upper clamp (~4),
	// well above 1 -> owned by player 0.
	expect("at stone center", territoryOwnerAt({ x: 5, y: 5 }, stones, HARDNESS), 0);

	// 2 cells away, influence is ~exp(-2.67/0.75) * threshold-clamped <<< 1
	// -> neutral.
	expect("2 cells away from single stone (neutral)",
		territoryOwnerAt({ x: 7, y: 5 }, stones, HARDNESS), -1);

	// 0.5 cells away: influence is exp(0/0.75) ≈ 1, right at threshold.
	const justInside = territoryOwnerAt({ x: 5.4, y: 5 }, stones, HARDNESS);
	expect("0.4 cells away owned by player 0", justInside, 0);
}

// ---- Capture scenarios ---------------------------------------------------

scenarioName("scenario 1: single stone, lots of empty board");
{
	const board = makeBoard([{ player: 0, x: 5, y: 5 }]);
	const captured = findCapturedStones(board, 0);
	expect("nobody captured", captured.length, 0);
}

scenarioName("scenario 2: two opposing stones placed far apart");
{
	const board = makeBoard([
		{ player: 0, x: 4, y: 4 },
		{ player: 1, x: 15, y: 15 },
	]);
	expect("captured by player 0's perspective", findCapturedStones(board, 0).length, 0);
	expect("captured by player 1's perspective", findCapturedStones(board, 1).length, 0);
}

scenarioName("scenario 3: a single black stone surrounded by white at close range");
{
	// Place a black stone, surround it tightly with white stones.
	// At hardness 0.25 + strength 1, influence reaches roughly 1 cell,
	// so white stones at distance 1 around the black should overpower.
	const board = makeBoard([
		{ player: 0, x: 9, y: 9 },                  // black target
		{ player: 1, x: 8, y: 9 }, { player: 1, x: 10, y: 9 },
		{ player: 1, x: 9, y: 8 }, { player: 1, x: 9, y: 10 },
		{ player: 1, x: 8, y: 8 }, { player: 1, x: 10, y: 10 },
		{ player: 1, x: 8, y: 10 }, { player: 1, x: 10, y: 8 },
	]);
	// Player 1 just played; check what gets captured.
	const captured = findCapturedStones(board, 1);
	const blackCaptured = captured.filter(s => s.playerIndex === 0).length;
	const whiteCaptured = captured.filter(s => s.playerIndex === 1).length;
	console.log(`    captured: ${blackCaptured} black, ${whiteCaptured} white`);
	expect("at least the lone black is captured", blackCaptured >= 1, true);
	expect("no white captured by white", whiteCaptured, 0);
}

scenarioName("scenario 4: a few stones do NOT sweep the whole board (regression)");
{
	// User report: "几颗子吃一片". Place 3 white stones on one side and one
	// black stone on the OTHER side. The black stone should NOT be captured —
	// the white stones are nowhere near it.
	const board = makeBoard([
		{ player: 1, x: 3, y: 3 },
		{ player: 1, x: 3, y: 5 },
		{ player: 1, x: 5, y: 3 },
		{ player: 0, x: 15, y: 15 },               // far away
	]);
	const captured = findCapturedStones(board, 1);
	const blackCaptured = captured.filter(s => s.playerIndex === 0).length;
	console.log(`    far-away black captured? ${blackCaptured > 0 ? "YES (BUG)" : "no (correct)"}`);
	expect("far-away stone is NOT captured", blackCaptured, 0);
}

scenarioName("scenario 5: same-color cluster forms one chain with liberty");
{
	const board = makeBoard([
		{ player: 0, x: 5, y: 5 },
		{ player: 0, x: 6, y: 5 },
		{ player: 0, x: 5, y: 6 },
		{ player: 0, x: 6, y: 6 },
	]);
	const grid = buildAnalysis(board);
	const chains = computeChainStats(grid);
	const blackChains = Array.from(chains.values()).filter(c => c.owner === 0);
	console.log(`    black chains: ${blackChains.length}, total cells: ${blackChains.reduce((a, c) => a + c.cellCount, 0)}`);
	expect("all 4 stones form ONE chain", blackChains.length, 1);
	expect("the chain has liberty", blackChains[0]?.hasLiberty, true);
}

scenarioName("scenario 6: corner stone has liberty (in-bounds neutral neighbors)");
{
	// A stone at (0,0) — its blob is a tiny disk centered on the corner.
	// Plenty of in-bounds neutral cells around the disk -> has liberty.
	const board = makeBoard([{ player: 0, x: 0, y: 0 }]);
	const captured = findCapturedStones(board, 0);
	expect("corner stone alive", captured.length, 0);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
