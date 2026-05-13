// Capture detection, ported from Assets/Scripts/Board/BoardUtility.cs.
//
// Algorithm (matches the GPU pipeline in BoardDistribution.compute, simplified):
//  1. Sample the territory map on an N×N grid covering the playable area.
//  2. Run 4-connected component labeling on the territory map (skipping
//     neutral cells, i.e. owner == -1).
//  3. A chain has "liberty" iff one of its cells has a 4-neighbor that is
//     neutral OR out-of-bounds. (Walls do not grant liberty in the C# code,
//     but to avoid trivially capturing stones near the edge we treat the
//     out-of-bounds neighbor of an edge cell as the rendered margin which is
//     effectively neutral. This matches the visual behavior of the original.)
//  4. Chains with no liberty AND owned by a player other than `placerPlayer`
//     are captured. For each existing stone, look up the territory at the
//     stone's center; if that cell belongs to a captured chain, remove the
//     stone.

import type { BoardState } from "./board.ts";
import { territoryOwnerAt } from "./influence.ts";
import type { StonePlacement, Vec2 } from "./types.ts";

export type AnalysisGrid = {
	resolution: number;     // N (so the grid is N×N)
	cellSize: number;       // playable / N
	originX: number;        // playableMin.x
	originY: number;        // playableMin.y
	territory: Int8Array;   // length N*N; cell = playerIndex or -1 for neutral
	chainId: Int32Array;    // length N*N; component id or -1 if neutral
};

export const DEFAULT_ANALYSIS_RESOLUTION = 64;

export function buildAnalysis(
	board: BoardState,
	resolution = DEFAULT_ANALYSIS_RESOLUTION,
): AnalysisGrid {
	const min = board.playableMin;
	const max = board.playableMax;
	const span = Math.max(0.0001, max.x - min.x);
	const cellSize = span / resolution;

	const territory = new Int8Array(resolution * resolution);
	territory.fill(-1);

	const stones = board.stones;
	for (let j = 0; j < resolution; ++j) {
		for (let i = 0; i < resolution; ++i) {
			const point: Vec2 = {
				x: min.x + (i + 0.5) * cellSize,
				y: min.y + (j + 0.5) * cellSize,
			};
			// Match upstream BoardDistribution.compute / CSTerritory:
			// a cell only has an owner when total influence >= 1.0.
			territory[j * resolution + i] = territoryOwnerAt(point, stones, board.stoneHardness);
		}
	}

	const chainId = labelComponents(territory, resolution);

	return { resolution, cellSize, originX: min.x, originY: min.y, territory, chainId };
}

// 4-connected component labeling using iterative flood fill.
// Cells with territory == -1 get chainId -1.
function labelComponents(territory: Int8Array, n: number): Int32Array {
	const chainId = new Int32Array(n * n);
	chainId.fill(-1);
	let next = 0;
	const stack: number[] = [];

	for (let start = 0; start < n * n; ++start) {
		if (chainId[start] !== -1) continue;
		const owner = territory[start]!;
		if (owner < 0) continue;

		const id = next++;
		chainId[start] = id;
		stack.push(start);
		while (stack.length > 0) {
			const idx = stack.pop()!;
			const x = idx % n;
			const y = (idx - x) / n;
			const neighbors = [
				x > 0     ? idx - 1 : -1,
				x < n - 1 ? idx + 1 : -1,
				y > 0     ? idx - n : -1,
				y < n - 1 ? idx + n : -1,
			];
			for (const nIdx of neighbors) {
				if (nIdx < 0) continue;
				if (chainId[nIdx] !== -1) continue;
				if (territory[nIdx] !== owner) continue;
				chainId[nIdx] = id;
				stack.push(nIdx);
			}
		}
	}
	return chainId;
}

export type ChainStat = {
	id: number;
	owner: number;        // playerIndex
	cellCount: number;
	hasLiberty: boolean;  // touches a neutral cell (or out-of-bounds)
};

export function computeChainStats(grid: AnalysisGrid): Map<number, ChainStat> {
	const { resolution: n, territory, chainId } = grid;
	const map = new Map<number, ChainStat>();

	for (let idx = 0; idx < n * n; ++idx) {
		const id = chainId[idx]!;
		if (id < 0) continue;

		let stat = map.get(id);
		if (!stat) {
			stat = { id, owner: territory[idx]!, cellCount: 0, hasLiberty: false };
			map.set(id, stat);
		}
		stat.cellCount++;

		if (stat.hasLiberty) continue;

		// Match upstream CSAccumulateChainStats: out-of-bounds neighbors are
		// SKIPPED (they do not grant liberty). Only an in-bounds neutral
		// neighbor counts as a liberty.
		const x = idx % n;
		const y = (idx - x) / n;
		const neighbors: number[] = [];
		if (x > 0)     neighbors.push(idx - 1);
		if (x < n - 1) neighbors.push(idx + 1);
		if (y > 0)     neighbors.push(idx - n);
		if (y < n - 1) neighbors.push(idx + n);
		for (const nIdx of neighbors) {
			if (territory[nIdx]! < 0) {
				stat.hasLiberty = true;
				break;
			}
		}
	}
	return map;
}

export function chainAt(grid: AnalysisGrid, point: Vec2): number {
	let i = Math.floor((point.x - grid.originX) / grid.cellSize);
	let j = Math.floor((point.y - grid.originY) / grid.cellSize);
	// Positions BEFORE the grid origin are outside the playable area — return
	// -1 so the caller treats them as "no chain here".
	if (i < 0 || j < 0) return -1;
	// Positions exactly AT the max edge (x = playableMax) map to index =
	// resolution, which is one past the last valid cell because the grid
	// samples at (i + 0.5) * cellSize. Clamp to the last cell — the stone's
	// blob is still inside the grid coverage even if its center is right on
	// the boundary. Without this clamp, edge placements (e.g. corner of a
	// 13×13 board) were incorrectly flagged as suicide.
	if (i >= grid.resolution) i = grid.resolution - 1;
	if (j >= grid.resolution) j = grid.resolution - 1;
	return grid.chainId[j * grid.resolution + i] ?? -1;
}

// Identify stones that should be captured given a board state.
// `placerPlayer` is the player who just placed; their own chains (without
// liberty) are NOT captured here — that's the suicide check, handled in match.ts.
export function findCapturedStones(
	board: BoardState,
	placerPlayer: number,
	grid?: AnalysisGrid,
): StonePlacement[] {
	const g = grid ?? buildAnalysis(board);
	const chains = computeChainStats(g);

	const capturedChainIds = new Set<number>();
	for (const stat of chains.values()) {
		if (stat.owner === placerPlayer) continue;
		if (stat.hasLiberty) continue;
		capturedChainIds.add(stat.id);
	}

	if (capturedChainIds.size === 0) return [];

	const captured: StonePlacement[] = [];
	for (const stone of board.allStones()) {
		const id = chainAt(g, stone.position);
		if (id < 0) continue;
		if (capturedChainIds.has(id)) captured.push(stone);
	}
	return captured;
}

// Returns true iff the just-placed stone is in a chain with no liberty
// (i.e. the move is suicide). Should be called AFTER captures are removed.
export function isSuicide(
	board: BoardState,
	placedStone: StonePlacement,
): boolean {
	const grid = buildAnalysis(board);
	const chains = computeChainStats(grid);
	const id = chainAt(grid, placedStone.position);
	if (id < 0) {
		// Stone is in neutral territory — that's also suicide (its influence
		// got fully cancelled by surrounding opponents).
		return true;
	}
	const stat = chains.get(id);
	if (!stat) return true;
	return !stat.hasLiberty;
}
