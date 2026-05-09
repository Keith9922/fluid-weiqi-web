// Influence field math, ported from
// Assets/Resources/Shaders/BoardDistribution.compute (PowerContribution, lines 61-72).
//
// At any board point P, each stone of strength s centered at C contributes:
//   r       = max(|P - C|, 0.001)
//   rNorm   = 2r / sqrt(s)
//   alpha   = 1 / (1 - min(0.99, hardness))
//   raw     = exp((1 - rNorm) * alpha)
//   raw     = clamp(raw, 0, 16)
//   power   = T * tanh(raw / T)        // smooth clamp at T = 4
//
// Per-player influence at P is the SUM of contributions from that player's stones.
// Territory at P = argmax over players (or "neutral" if all zero).

import type { StonePlacement, Vec2 } from "./types.ts";

const POWER_THRESHOLD = 4;

export function influenceFromStone(
	point: Vec2,
	stoneCenter: Vec2,
	strength: number,
	hardness: number,
): number {
	const dx = point.x - stoneCenter.x;
	const dy = point.y - stoneCenter.y;
	const r = Math.max(Math.hypot(dx, dy), 0.001);
	const rNorm = (2 * r) / Math.sqrt(strength);
	const alpha = 1 / (1 - Math.min(0.99, hardness));
	let raw = Math.exp((1 - rNorm) * alpha);
	raw = Math.min(16, Math.max(0, raw));
	return POWER_THRESHOLD * Math.tanh(raw / POWER_THRESHOLD);
}

export function influenceForPlayerAt(
	point: Vec2,
	playerStones: readonly StonePlacement[],
	hardness: number,
): number {
	let total = 0;
	for (const stone of playerStones)
		total += influenceFromStone(point, stone.position, stone.strength, hardness);
	return total;
}

// Index of the dominant player at this point, or -1 if no player has any
// influence here (territory is "neutral").
export function dominantPlayerAt(
	point: Vec2,
	stonesByPlayer: readonly (readonly StonePlacement[])[],
	hardness: number,
	neutralThreshold = 1e-4,
): number {
	let bestPlayer = -1;
	let bestValue = neutralThreshold;
	for (let p = 0; p < stonesByPlayer.length; ++p) {
		const stones = stonesByPlayer[p];
		if (!stones || stones.length === 0) continue;
		const v = influenceForPlayerAt(point, stones, hardness);
		if (v > bestValue) {
			bestValue = v;
			bestPlayer = p;
		}
	}
	return bestPlayer;
}
