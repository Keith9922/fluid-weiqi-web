// Medium AI — 1-ply greedy with full GNU-Go-style evaluation.
//
// Algorithm:
//   1. Generate top-K candidates ranked by quick prior.
//   2. Simulate each: clone board, place stone, run capture/suicide check.
//   3. Evaluate post-move state with the full eval function.
//   4. Pick the highest-scoring move; pass if no legal move improves on
//      "do nothing" (rare).

import { Match } from "../match.ts";
import type { BoardState } from "../board.ts";
import { evaluateBoard } from "./eval.ts";
import { rankedCandidates } from "./moveGen.ts";
import type { AiDecision, AiStrategy } from "./types.ts";

const TOP_K_CANDIDATES = 18;

export class MediumAi implements AiStrategy {
	readonly level = "medium" as const;

	chooseMove(board: BoardState, playerIndex: number, stoneStrength: number): AiDecision {
		const candidates = rankedCandidates(board, playerIndex, TOP_K_CANDIDATES);
		const passScore = evaluateBoard(board, playerIndex);

		let bestPos = null as { x: number; y: number } | null;
		let bestScore = -Infinity;

		for (const c of candidates) {
			const sim = simulateMove(board, playerIndex, c.position, stoneStrength);
			if (!sim) continue;

			const score = evaluateBoard(sim.board, playerIndex);
			if (score > bestScore) {
				bestScore = score;
				bestPos = c.position;
			}
		}

		if (bestPos !== null && bestScore > passScore - 0.05) {
			return { type: "place", position: bestPos };
		}
		return { type: "pass" };
	}
}

// Returns a Match instance with the move applied, or null if illegal.
export function simulateMove(
	board: BoardState,
	playerIndex: number,
	position: { x: number; y: number },
	stoneStrength: number,
): Match | null {
	const sim = new Match({
		board: {
			playerCount: board.playerCount,
			size: board.size,
			stoneHardness: board.stoneHardness,
			defaultStrength: stoneStrength,
		},
		stoneStrength,
	});
	for (let p = 0; p < board.playerCount; ++p) {
		for (const s of board.getStones(p)) {
			sim.board.addStone(p, s.position, s.strength);
		}
	}
	sim.currentPlayerIndex = playerIndex;

	const result = sim.apply({
		playerIndex,
		actionType: "place",
		position,
		turnSeq: sim.turnSeq,
		actionSeq: 0,
	});

	return result.accepted ? sim : null;
}
