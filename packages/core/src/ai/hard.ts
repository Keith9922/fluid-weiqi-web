// Hard AI — minimax with α-β pruning, iterative deepening, **free placement**.
//
// Search structure:
//   - Candidates include OFF-grid positions (half-grid + surround spots
//     around opponent stones + wedge midpoints). This lets the AI play moves
//     a snap-to-grid AI literally cannot reach — critical in Fluid Weiqi
//     where the killing position is often (x.5, y.5).
//   - Move ordering: top-K from quickPriorScore (3-surround aware).
//   - Iterative deepening: depth 2 → 3 → 4 as time allows.
//   - Leaf eval uses evaluateFast (24×24 grid).
//   - Hard time budget keeps total search ≈ 3.5 s on a 2-core box.

import type { BoardState } from "../board.ts";
import { evaluateFast } from "./eval.ts";
import { simulateMove } from "./medium.ts";
import { freePlacementCandidates, rankedCandidates, type Candidate } from "./moveGen.ts";
import type { AiDecision, AiStrategy } from "./types.ts";

const ROOT_BRANCHING = 14;
const INNER_BRANCHING = 8;
const TIME_BUDGET_MS = 3500;

export class HardAi implements AiStrategy {
	readonly level = "hard" as const;

	chooseMove(board: BoardState, playerIndex: number, stoneStrength: number): AiDecision {
		const start = Date.now();
		const opponent = (playerIndex + 1) % board.playerCount;

		let bestMove: { x: number; y: number } | null = null;
		let bestScore = -Infinity;

		// Iterative deepening 2 → 3 → 4. Higher max depth beats medium clearly.
		for (let depth = 2; depth <= 4; ++depth) {
			const result = searchRoot(board, playerIndex, opponent, depth, stoneStrength, start);
			if (result.timedOut) break;
			if (result.bestMove) {
				bestMove = result.bestMove;
				bestScore = result.bestScore;
			}
			if (Date.now() - start > TIME_BUDGET_MS * 0.6) break;
		}

		if (bestMove !== null && bestScore > -Infinity) {
			return { type: "place", position: bestMove };
		}
		return { type: "pass" };
	}
}

function rootCandidates(board: BoardState, me: number, branching: number): Candidate[] {
	// Combine snap-grid + free-placement (off-grid + surround + wedge),
	// dedupe by quantized position, sort by quickPriorScore, take top-K.
	const grid = rankedCandidates(board, me, branching);
	const free = freePlacementCandidates(board, me, branching);
	const seen = new Set<string>();
	const merged: Candidate[] = [];
	for (const c of [...grid, ...free]) {
		const k = `${(c.position.x * 10) | 0},${(c.position.y * 10) | 0}`;
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(c);
	}
	merged.sort((a, b) => b.priorScore - a.priorScore);
	return merged.slice(0, branching);
}

function searchRoot(
	board: BoardState,
	me: number,
	opp: number,
	depth: number,
	stoneStrength: number,
	startTime: number,
): { bestMove: { x: number; y: number } | null; bestScore: number; timedOut: boolean } {
	const candidates = rootCandidates(board, me, ROOT_BRANCHING);

	let bestMove: { x: number; y: number } | null = null;
	let bestScore = -Infinity;
	let alpha = -Infinity;
	const beta = Infinity;

	for (const c of candidates) {
		if (Date.now() - startTime > TIME_BUDGET_MS) {
			return { bestMove, bestScore, timedOut: true };
		}
		const sim = simulateMove(board, me, c.position, stoneStrength);
		if (!sim) continue;

		const score = -negamax(sim.board, opp, me, depth - 1, -beta, -alpha, stoneStrength, startTime);
		if (score > bestScore) {
			bestScore = score;
			bestMove = c.position;
		}
		if (score > alpha) alpha = score;
	}
	return { bestMove, bestScore, timedOut: false };
}

function negamax(
	board: BoardState,
	toMove: number,
	other: number,
	depth: number,
	alpha: number,
	beta: number,
	stoneStrength: number,
	startTime: number,
): number {
	if (depth <= 0 || Date.now() - startTime > TIME_BUDGET_MS) {
		return evaluateFast(board, toMove);
	}

	const candidates = rankedCandidates(board, toMove, INNER_BRANCHING);
	if (candidates.length === 0) {
		return evaluateFast(board, toMove);
	}

	let best = -Infinity;
	for (const c of candidates) {
		if (Date.now() - startTime > TIME_BUDGET_MS) break;
		const sim = simulateMove(board, toMove, c.position, stoneStrength);
		if (!sim) continue;

		const v = -negamax(sim.board, other, toMove, depth - 1, -beta, -alpha, stoneStrength, startTime);
		if (v > best) best = v;
		if (best > alpha) alpha = best;
		if (alpha >= beta) break; // β-cutoff
	}
	return best === -Infinity ? evaluateFast(board, toMove) : best;
}
