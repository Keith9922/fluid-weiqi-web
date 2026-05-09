// Hell AI — MCTS (Monte Carlo Tree Search) with heuristic-guided rollouts.
//
// Variant: PUCT-style selection (UCB1 with prior) — lighter than Pachi but
// strictly stronger than uniform-random rollouts.
//
//   - Tree expansion: child priors come from quickPriorScore.
//   - Selection: UCB1 with prior:  Q + cP * P * sqrt(N) / (1 + n)
//     where N is parent visit count, n is child visit count, P is prior.
//   - Rollout: short heuristic playout (8-12 plies), each ply picks the best
//     of 3 random candidates by quickPriorScore. NOT full game length to keep
//     simulations fast (~5-10ms each). Final value = sign of evaluateFast at
//     the rollout end.
//   - Time budget: 8 seconds, ~2000-3000 simulations on a 2-core box.

import type { BoardState } from "../board.ts";
import { evaluateFast } from "./eval.ts";
import { simulateMove } from "./medium.ts";
import { quickPriorScore, rankedCandidates } from "./moveGen.ts";
import type { AiDecision, AiStrategy } from "./types.ts";

const TIME_BUDGET_MS = 8000;
const MAX_SIMULATIONS = 4000;
const ROOT_BRANCHING = 14;
const INNER_BRANCHING = 8;
const ROLLOUT_PLIES = 10;
const ROLLOUT_CANDIDATES = 3;
const C_PUCT = 1.4;

type Node = {
	board: BoardState;
	playerToMove: number;
	priorPlayer: number;       // who made the move that led here (root has -1)
	visits: number;
	valueSum: number;          // accumulated value from `priorPlayer`'s perspective
	prior: number;             // policy prior of the move from parent
	move: { x: number; y: number } | null;
	children: Node[] | null;   // null = unexpanded
	parent: Node | null;
};

export class HellAi implements AiStrategy {
	readonly level = "hell" as const;

	chooseMove(board: BoardState, playerIndex: number, stoneStrength: number): AiDecision {
		const start = Date.now();
		const opponent = (playerIndex + 1) % board.playerCount;

		const root: Node = {
			board: cloneBoard(board),
			playerToMove: playerIndex,
			priorPlayer: -1,
			visits: 0,
			valueSum: 0,
			prior: 1,
			move: null,
			children: null,
			parent: null,
		};

		expand(root, ROOT_BRANCHING, playerIndex, opponent, stoneStrength);

		if (!root.children || root.children.length === 0) {
			return { type: "pass" };
		}

		let sims = 0;
		while (sims < MAX_SIMULATIONS && Date.now() - start < TIME_BUDGET_MS) {
			const leaf = select(root);
			let value: number;
			if (leaf.visits === 0) {
				value = rollout(leaf.board, leaf.playerToMove, playerIndex, stoneStrength);
			} else {
				expand(leaf, INNER_BRANCHING, playerIndex, opponent, stoneStrength);
				if (leaf.children && leaf.children.length > 0) {
					const child = leaf.children[0]!;
					value = rollout(child.board, child.playerToMove, playerIndex, stoneStrength);
					backpropagate(child, value);
					sims++;
					continue;
				}
				value = evaluateFast(leaf.board, playerIndex) > 0 ? 1 : -1;
			}
			backpropagate(leaf, value);
			sims++;
		}

		// Pick the most-visited root child.
		let bestChild: Node | null = null;
		let bestVisits = -1;
		for (const c of root.children) {
			if (c.visits > bestVisits) {
				bestVisits = c.visits;
				bestChild = c;
			}
		}

		if (bestChild && bestChild.move) {
			return { type: "place", position: bestChild.move };
		}
		return { type: "pass" };
	}
}

function expand(node: Node, branching: number, _me: number, _opp: number, stoneStrength: number): void {
	if (node.children !== null) return;

	const candidates = rankedCandidates(node.board, node.playerToMove, branching);
	const children: Node[] = [];

	// Softmax-ish prior: higher quick scores → larger prior probability.
	let priorSum = 0;
	const priorRaw = candidates.map(c => Math.exp(c.priorScore));
	for (const p of priorRaw) priorSum += p;
	if (priorSum < 1e-9) priorSum = 1;

	for (let i = 0; i < candidates.length; ++i) {
		const c = candidates[i]!;
		const sim = simulateMove(node.board, node.playerToMove, c.position, stoneStrength);
		if (!sim) continue;

		const child: Node = {
			board: sim.board,
			playerToMove: (node.playerToMove + 1) % node.board.playerCount,
			priorPlayer: node.playerToMove,
			visits: 0,
			valueSum: 0,
			prior: (priorRaw[i] ?? 0) / priorSum,
			move: c.position,
			children: null,
			parent: node,
		};
		children.push(child);
	}

	node.children = children;
}

function select(node: Node): Node {
	let cur = node;
	while (cur.children !== null && cur.children.length > 0) {
		// Pick the child with highest UCB1+prior.
		let best: Node = cur.children[0]!;
		let bestScore = -Infinity;
		const sqrtParent = Math.sqrt(cur.visits + 1);
		for (const child of cur.children) {
			const q = child.visits === 0 ? 0 : child.valueSum / child.visits;
			const u = C_PUCT * child.prior * sqrtParent / (1 + child.visits);
			const score = q + u;
			if (score > bestScore) {
				bestScore = score;
				best = child;
			}
		}
		cur = best;
		if (cur.visits === 0) return cur; // expand on next call
	}
	return cur;
}

function rollout(
	startBoard: BoardState,
	startPlayer: number,
	perspective: number,
	stoneStrength: number,
): number {
	let board = cloneBoard(startBoard);
	let toMove = startPlayer;

	for (let ply = 0; ply < ROLLOUT_PLIES; ++ply) {
		// Sample a few candidates and pick the best by quick prior — much
		// stronger than uniform random.
		let bestMove: { x: number; y: number } | null = null;
		let bestScore = -Infinity;
		for (let i = 0; i < ROLLOUT_CANDIDATES; ++i) {
			const x = randInt(0, board.size);
			const y = randInt(0, board.size);
			const s = quickPriorScore(board, toMove, { x, y });
			if (s > bestScore) {
				bestScore = s;
				bestMove = { x, y };
			}
		}
		if (!bestMove) break;

		const sim = simulateMove(board, toMove, bestMove, stoneStrength);
		if (sim) {
			board = sim.board;
		}
		toMove = (toMove + 1) % board.playerCount;
	}

	return Math.tanh(evaluateFast(board, perspective) * 2);
}

function backpropagate(node: Node, value: number): void {
	let cur: Node | null = node;
	let v = value;
	while (cur !== null) {
		cur.visits++;
		cur.valueSum += v;
		v = -v;
		cur = cur.parent;
	}
}

function cloneBoard(board: BoardState): BoardState {
	return board.clone();
}

function randInt(lo: number, hi: number): number {
	return lo + Math.random() * (hi - lo);
}
