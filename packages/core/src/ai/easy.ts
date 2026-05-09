// Easy AI — weighted random with basic safety filter.
// Picks from a random sample of grid points, excluding edge corners and
// obviously suicidal moves. Faithful spirit of the original LaoSong AI.

import type { BoardState } from "../board.ts";
import { gridCandidates, isFullyLegal, isObviouslyOccupied } from "./moveGen.ts";
import type { AiDecision, AiStrategy } from "./types.ts";

const SAMPLE_SIZE = 12;

export class EasyAi implements AiStrategy {
	readonly level = "easy" as const;

	chooseMove(board: BoardState, playerIndex: number, stoneStrength: number): AiDecision {
		const candidates = gridCandidates(board, { avoidEdgeMargin: 1 });
		// Shuffle a small subset.
		shuffleInPlace(candidates);

		for (let i = 0; i < Math.min(SAMPLE_SIZE, candidates.length); ++i) {
			const c = candidates[i];
			if (!c) continue;
			if (isObviouslyOccupied(board, c)) continue;
			if (isFullyLegal(board, playerIndex, c, stoneStrength)) {
				return { type: "place", position: c };
			}
		}

		// Fallback to scanning the whole grid for any legal point.
		for (const c of candidates) {
			if (isFullyLegal(board, playerIndex, c, stoneStrength)) {
				return { type: "place", position: c };
			}
		}
		return { type: "pass" };
	}
}

function shuffleInPlace<T>(arr: T[]): void {
	for (let i = arr.length - 1; i > 0; --i) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = arr[i]!;
		arr[i] = arr[j]!;
		arr[j] = tmp;
	}
}
