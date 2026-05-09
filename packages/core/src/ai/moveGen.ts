// Candidate move generator.
//
// Given a board state, produces a (possibly filtered, possibly ranked) list
// of grid points that an AI might want to evaluate. The continuous nature of
// Fluid Weiqi means the action space is uncountable; we discretize to a
// `step` grid (default 1.0 — same as snap-to-grid in the UI), which gives
// ~size² candidates on a `size`-board.

import { BoardState } from "../board.ts";
import { Match } from "../match.ts";
import type { Vec2 } from "../types.ts";

export type Candidate = {
	position: Vec2;
	priorScore: number;     // a quick heuristic ranking (not the full eval)
};

export type MoveGenOptions = {
	step?: number;          // grid spacing (default 1)
	avoidEdgeMargin?: number; // skip the outermost N grid lines (default 0)
	includeOffGrid?: boolean; // include positions slightly off the integer grid (default false)
};

// Generate raw grid candidates inside the playable area.
export function gridCandidates(
	board: BoardState,
	options: MoveGenOptions = {},
): Vec2[] {
	const step = options.step ?? 1;
	const margin = options.avoidEdgeMargin ?? 0;
	const min = board.playableMin;
	const max = board.playableMax;

	const startX = min.x + margin * step;
	const endX = max.x - margin * step;
	const startY = min.y + margin * step;
	const endY = max.y - margin * step;

	const out: Vec2[] = [];
	for (let y = startY; y <= endY + 1e-6; y += step) {
		for (let x = startX; x <= endX + 1e-6; x += step) {
			out.push({ x, y });
		}
	}
	return out;
}

// Quick heuristic scoring used to RANK candidates before evaluating them.
// Prefers points that are: not adjacent to existing same-color stones (spread),
// near-but-not-on opponent stones (contest), and central (slightly).
// This is intentionally cheap — DO NOT call the full evaluate function here.
export function quickPriorScore(
	board: BoardState,
	playerIndex: number,
	point: Vec2,
): number {
	const center = board.size / 2;
	const dCenter = Math.hypot(point.x - center, point.y - center);
	const centralBonus = -dCenter / board.size;

	const opponent = (playerIndex + 1) % board.playerCount;
	let score = centralBonus;

	const ownStones = board.getStones(playerIndex);
	let nearestOwn = Infinity;
	for (const s of ownStones) {
		const d = Math.hypot(s.position.x - point.x, s.position.y - point.y);
		if (d < nearestOwn) nearestOwn = d;
	}
	if (Number.isFinite(nearestOwn)) {
		// Want spacing ~3 cells from own stones in opening.
		const ideal = 3.0;
		const deviation = Math.abs(nearestOwn - ideal);
		score += -0.4 * deviation;
	} else {
		score += 1.0;
	}

	const oppStones = board.getStones(opponent);
	let nearestOpp = Infinity;
	for (const s of oppStones) {
		const d = Math.hypot(s.position.x - point.x, s.position.y - point.y);
		if (d < nearestOpp) nearestOpp = d;
	}
	if (Number.isFinite(nearestOpp)) {
		// Want to contest at ~2 cells from opponents.
		const ideal = 2.0;
		const deviation = Math.abs(nearestOpp - ideal);
		score += -0.5 * deviation;
	}

	return score;
}

// Quick legality filter: skip occupied points (within a small radius).
const MIN_DISTANCE_TO_EXISTING = 0.4;

export function isObviouslyOccupied(board: BoardState, point: Vec2): boolean {
	for (const s of board.allStones()) {
		const dx = s.position.x - point.x;
		const dy = s.position.y - point.y;
		if (dx * dx + dy * dy < MIN_DISTANCE_TO_EXISTING * MIN_DISTANCE_TO_EXISTING) {
			return true;
		}
	}
	return false;
}

// Generate, filter, score, and sort candidates. Returns top-K by prior.
export function rankedCandidates(
	board: BoardState,
	playerIndex: number,
	topK: number,
	options: MoveGenOptions = {},
): Candidate[] {
	const raw = gridCandidates(board, options);
	const out: Candidate[] = [];
	for (const point of raw) {
		if (isObviouslyOccupied(board, point)) continue;
		out.push({ position: point, priorScore: quickPriorScore(board, playerIndex, point) });
	}
	out.sort((a, b) => b.priorScore - a.priorScore);
	return out.slice(0, topK);
}

// Test whether a move is fully legal (occupancy + suicide). Expensive — only
// call after pre-filtering. Mutates a clone, not the original.
export function isFullyLegal(
	board: BoardState,
	playerIndex: number,
	point: Vec2,
	stoneStrength: number,
): boolean {
	if (!board.withinBounds(point)) return false;
	if (isObviouslyOccupied(board, point)) return false;

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
		position: point,
		turnSeq: sim.turnSeq,
		actionSeq: 0,
	});
	return result.accepted;
}
