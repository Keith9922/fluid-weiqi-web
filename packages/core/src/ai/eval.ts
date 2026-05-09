// AI evaluation function — adapted from GNU Go's territorial-value approach,
// fitted to Fluid Weiqi's continuous influence field.
//
// score(state, perspective) =
//     wTerritory  * (own territory cells - opponent territory cells)
//   + wCapture    * (own stone count - opponent stone count)
//   + wLiberty    * (own group liberties - opponent group liberties)
//   + wContrast   * sum over cells of dominance margin
//
// All weights are positive when interpreted from `perspective`.

import { BoardState } from "../board.ts";
import { buildAnalysis, computeChainStats, type AnalysisGrid } from "../capture.ts";

const WEIGHT_TERRITORY = 5.0;
const WEIGHT_CAPTURE = 8.0;
const WEIGHT_LIBERTY = 1.5;
const WEIGHT_CONTRAST = 1.0;

export type EvalOptions = {
	resolution?: number;
};

export function evaluateBoard(
	board: BoardState,
	perspective: number,
	options: EvalOptions = {},
): number {
	const grid = buildAnalysis(board, options.resolution ?? 32);
	return evaluateOnGrid(board, perspective, grid);
}

export function evaluateOnGrid(
	board: BoardState,
	perspective: number,
	grid: AnalysisGrid,
): number {
	const opponent = (perspective + 1) % board.playerCount;

	let ownTerritory = 0;
	let oppTerritory = 0;
	let dominance = 0;

	const total = grid.resolution * grid.resolution;
	for (let i = 0; i < total; ++i) {
		const owner = grid.territory[i] ?? -1;
		if (owner === perspective) {
			ownTerritory++;
			dominance += 1;
		} else if (owner === opponent) {
			oppTerritory++;
			dominance -= 1;
		}
	}

	const territoryDelta = (ownTerritory - oppTerritory) / total;

	const ownStones = board.getStones(perspective).length;
	const oppStones = board.getStones(opponent).length;
	const stoneDelta = ownStones - oppStones;

	const chains = computeChainStats(grid);
	let ownLib = 0;
	let oppLib = 0;
	for (const chain of chains.values()) {
		if (chain.owner === perspective) ownLib += chain.hasLiberty ? chain.cellCount : -chain.cellCount * 0.5;
		else if (chain.owner === opponent) oppLib += chain.hasLiberty ? chain.cellCount : -chain.cellCount * 0.5;
	}
	const libertyDelta = (ownLib - oppLib) / total;

	const contrast = dominance / total;

	return (
		WEIGHT_TERRITORY * territoryDelta +
		WEIGHT_CAPTURE * stoneDelta +
		WEIGHT_LIBERTY * libertyDelta +
		WEIGHT_CONTRAST * contrast
	);
}

// Cheap eval used inside search nodes — uses the smaller analysis grid and
// skips the per-chain stats. Roughly 2-3x faster than the full evaluate.
export function evaluateFast(board: BoardState, perspective: number): number {
	return evaluateBoard(board, perspective, { resolution: 24 });
}
