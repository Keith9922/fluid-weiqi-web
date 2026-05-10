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
// Tuned for Fluid Weiqi's continuous-influence geometry, where a single
// stone's "blob" reaches ~0.5 cells and **three opponents at distance ~1
// can already capture a lone stone**. So this ranker rewards:
//   - Closing in on opponent stones (contest range ~0.9 — tighter than Go)
//   - Joining a near-own-stone "wall" so the new stone gets liberty support
//   - Slight center bias in the opening
//
// Penalties keep the AI from sitting on its own stones (occupied) or
// drifting to dead corners.
//
// Cheap — does NOT run the eval function. Bigger numbers = better move.
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
	let supportCount = 0;          // own stones at "good support" distance
	for (const s of ownStones) {
		const d = Math.hypot(s.position.x - point.x, s.position.y - point.y);
		if (d < nearestOwn) nearestOwn = d;
		if (d > 0.6 && d < 1.7) supportCount++;
	}
	if (Number.isFinite(nearestOwn)) {
		// Earlier in the game we want to spread out (~2.5 cells); after we
		// have several stones, sticking close to a friend is better
		// (a 3-stone cluster can survive a 3-stone surround).
		const ideal = ownStones.length < 4 ? 2.5 : 1.5;
		const deviation = Math.abs(nearestOwn - ideal);
		score += -0.35 * deviation;
		// Bonus per supporting friend nearby (caps at +1.5)
		score += Math.min(1.5, 0.5 * supportCount);
	} else {
		score += 1.0;
	}

	const oppStones = board.getStones(opponent);
	let nearestOpp = Infinity;
	let surroundCount = 0;         // opponents close enough to potentially capture together
	for (const s of oppStones) {
		const d = Math.hypot(s.position.x - point.x, s.position.y - point.y);
		if (d < nearestOpp) nearestOpp = d;
		if (d > 0.45 && d < 1.4) surroundCount++;
	}
	if (Number.isFinite(nearestOpp)) {
		// Push closer to opponents than traditional Go would — in Fluid Weiqi
		// the kill range is ~1 cell, not 1 liberty.
		const ideal = 0.95;
		const deviation = Math.abs(nearestOpp - ideal);
		score += -0.6 * deviation;
		// HUGE bonus when this point would be the 2nd or 3rd surround stone
		// against a single opponent — that's typically the killing blow.
		if (surroundCount >= 2) score += 1.8 * surroundCount;
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
	const seen = new Set<string>();
	for (const point of raw) {
		if (isObviouslyOccupied(board, point)) continue;
		const k = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push({ position: point, priorScore: quickPriorScore(board, playerIndex, point) });
	}
	out.sort((a, b) => b.priorScore - a.priorScore);
	return out.slice(0, topK);
}

// Free-placement candidate generator for stronger AIs. In Fluid Weiqi the
// most lethal moves are usually OFF-grid — wedging between two opponent
// stones, or stitching a 0.7-cell gap to bring an opponent chain to capture.
// This adds three classes of off-grid hot-spots on top of the standard grid:
//
//   1. Half-grid: every (x+0.5, y+0.5) intersection.
//   2. Around opponent stones: 8 points at distance ~1.0 around each enemy
//      stone (the natural "surround" positions).
//   3. Midpoints between opposing-color stones within 2.5 cells (wedge moves).
//
// We dedupe by 0.01-cell quantization and filter out obviously-occupied
// candidates. Calling this for hard / hell levels gives them access to plays
// the snap-to-grid AI literally can't find.
export function freePlacementCandidates(
	board: BoardState,
	playerIndex: number,
	topK: number,
): Candidate[] {
	const opp = (playerIndex + 1) % board.playerCount;
	const oppStones = board.getStones(opp);
	const ownStones = board.getStones(playerIndex);

	const points: Vec2[] = [];

	// (1) Half-grid sweep across the playable area (no edge avoidance — the
	// edge moves are weak by quickPriorScore but should be reachable).
	const min = board.playableMin;
	const max = board.playableMax;
	for (let y = min.y; y <= max.y + 1e-6; y += 0.5) {
		for (let x = min.x; x <= max.x + 1e-6; x += 0.5) {
			points.push({ x, y });
		}
	}

	// (2) Surround positions around every opponent stone — 8 directions at
	// distance 1.0. These are the moves that complete a 3-stone capture.
	const SURROUND_OFFSETS: Vec2[] = [
		{ x: 1.0, y: 0 }, { x: -1.0, y: 0 }, { x: 0, y: 1.0 }, { x: 0, y: -1.0 },
		{ x: 0.7, y: 0.7 }, { x: -0.7, y: 0.7 }, { x: 0.7, y: -0.7 }, { x: -0.7, y: -0.7 },
	];
	for (const s of oppStones) {
		for (const off of SURROUND_OFFSETS) {
			const p = { x: s.position.x + off.x, y: s.position.y + off.y };
			if (board.withinBounds(p)) points.push(p);
		}
	}

	// (3) Wedge midpoints — between any two opponent stones close enough that
	// a stone in the middle would split them.
	for (let i = 0; i < oppStones.length; ++i) {
		for (let j = i + 1; j < oppStones.length; ++j) {
			const a = oppStones[i]!;
			const b = oppStones[j]!;
			const dx = a.position.x - b.position.x;
			const dy = a.position.y - b.position.y;
			const d2 = dx * dx + dy * dy;
			if (d2 < 6.25 /* 2.5 ^ 2 */) {
				const mid = {
					x: (a.position.x + b.position.x) / 2,
					y: (a.position.y + b.position.y) / 2,
				};
				if (board.withinBounds(mid)) points.push(mid);
			}
		}
	}

	// Dedupe at 0.1-cell granularity, score, sort, top-K.
	const seen = new Set<string>();
	const candidates: Candidate[] = [];
	for (const p of points) {
		const k = `${(p.x * 10) | 0},${(p.y * 10) | 0}`;
		if (seen.has(k)) continue;
		seen.add(k);
		if (isObviouslyOccupied(board, p)) continue;
		candidates.push({ position: p, priorScore: quickPriorScore(board, playerIndex, p) });
	}
	candidates.sort((a, b) => b.priorScore - a.priorScore);

	// Suppress unused-var warning for ownStones — kept available for future
	// scoring tweaks (e.g., bonus for moves that connect own chains).
	void ownStones;

	return candidates.slice(0, topK);
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
