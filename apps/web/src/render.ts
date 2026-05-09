// Canvas 2D rendering of the board.
//
// Draws (in order):
//   1. Wood-color base
//   2. Influence field at low resolution, upscaled with smoothing
//   3. Grid lines
//   4. Stones
//   5. Hover preview
//
// The field is the most expensive part: ~64*64 = 4096 sample evaluations,
// each summing across all stones. For typical mid-game stone counts this is
// fine on JS. We re-render the whole canvas on each state change.

import type { BoardSnapshot, StonePlacement, Vec2 } from "@fluid/core";
import { influenceForPlayerAt } from "@fluid/core";

export const PLAYER_COLORS = [
	{ stone: "#d65a50", field: [0xe5, 0x6a, 0x55] as [number, number, number] },
	{ stone: "#4a8ec0", field: [0x52, 0x9b, 0xcf] as [number, number, number] },
];

const FIELD_RES = 96;          // sample resolution
const PADDING_RATIO = 0.05;    // visual padding around the playable area

export type RenderInputs = {
	canvas: HTMLCanvasElement;
	previewCanvas: HTMLCanvasElement;
	board: BoardSnapshot;
	pixelSize: number;            // CSS pixels (canvas is square)
	hover: Vec2 | null;
	hoverPlayer: number | null;
	hoverValid: boolean;
	currentPlayerIndex: number;
};

export function setupCanvases(canvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement, pixelSize: number): void {
	const dpr = window.devicePixelRatio || 1;
	for (const c of [canvas, previewCanvas]) {
		c.width = pixelSize * dpr;
		c.height = pixelSize * dpr;
		c.style.width = `${pixelSize}px`;
		c.style.height = `${pixelSize}px`;
		c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
}

export function render(inputs: RenderInputs): void {
	drawBase(inputs);
	drawPreview(inputs);
}

function drawBase(inputs: RenderInputs): void {
	const { canvas, board, pixelSize } = inputs;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.clearRect(0, 0, pixelSize, pixelSize);

	// Wood base.
	ctx.fillStyle = "#3a2f24";
	ctx.fillRect(0, 0, pixelSize, pixelSize);

	const { boardToPx, pad, playable } = layout(pixelSize, board);

	// Inner playable area background (slightly different shade so the margin
	// is distinguishable).
	ctx.fillStyle = "#4a3d2f";
	ctx.fillRect(pad, pad, playable, playable);

	drawInfluenceField(ctx, board, pad, playable);
	drawGrid(ctx, board, boardToPx);
	drawStones(ctx, board, boardToPx);
}

function drawInfluenceField(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	pad: number,
	playable: number,
): void {
	const offscreen = document.createElement("canvas");
	offscreen.width = FIELD_RES;
	offscreen.height = FIELD_RES;
	const offCtx = offscreen.getContext("2d");
	if (!offCtx) return;

	const img = offCtx.createImageData(FIELD_RES, FIELD_RES);
	const data = img.data;

	const minX = board.shrinkMargin;
	const minY = board.shrinkMargin;
	const span = Math.max(0.0001, board.size - 2 * board.shrinkMargin);
	const cellSize = span / FIELD_RES;

	const stonesByPlayer: StonePlacement[][] = Array.from(
		{ length: board.playerCount },
		() => [],
	);
	for (const s of board.stones) {
		const list = stonesByPlayer[s.playerIndex];
		if (list) list.push(s);
	}

	for (let j = 0; j < FIELD_RES; ++j) {
		for (let i = 0; i < FIELD_RES; ++i) {
			const point: Vec2 = {
				x: minX + (i + 0.5) * cellSize,
				y: minY + (j + 0.5) * cellSize,
			};

			let bestPlayer = -1;
			let bestValue = 1e-4;
			let secondValue = 0;
			for (let p = 0; p < board.playerCount; ++p) {
				const v = influenceForPlayerAt(point, stonesByPlayer[p] ?? [], board.stoneHardness);
				if (v > bestValue) {
					secondValue = bestValue;
					bestValue = v;
					bestPlayer = p;
				} else if (v > secondValue) {
					secondValue = v;
				}
			}

			// Y is flipped because the canvas pixel grid runs top-down.
			const dst = ((FIELD_RES - 1 - j) * FIELD_RES + i) * 4;

			if (bestPlayer < 0) {
				data[dst]     = 0x4a;
				data[dst + 1] = 0x3d;
				data[dst + 2] = 0x2f;
				data[dst + 3] = 255;
				continue;
			}

			const color = PLAYER_COLORS[bestPlayer]?.field ?? [200, 200, 200];
			// The "confidence" of the territory is how much it dominates the
			// runner-up. Strong domination -> saturated color. Tied -> faded.
			const dominance = 1 - secondValue / Math.max(bestValue, 1e-6);
			const intensity = Math.min(1, 0.25 + 0.55 * dominance);
			data[dst]     = mix(0x4a, color[0], intensity);
			data[dst + 1] = mix(0x3d, color[1], intensity);
			data[dst + 2] = mix(0x2f, color[2], intensity);
			data[dst + 3] = 255;
		}
	}

	offCtx.putImageData(img, 0, 0);

	const prevSmoothing = ctx.imageSmoothingEnabled;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(offscreen, pad, pad, playable, playable);
	ctx.imageSmoothingEnabled = prevSmoothing;
}

function drawGrid(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	boardToPx: (p: Vec2) => Vec2,
): void {
	const lines = Math.floor(board.size) + 1;
	ctx.strokeStyle = "rgba(20, 14, 8, 0.45)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let i = 0; i < lines; ++i) {
		const a = boardToPx({ x: i, y: 0 });
		const b = boardToPx({ x: i, y: board.size });
		ctx.moveTo(a.x + 0.5, a.y);
		ctx.lineTo(b.x + 0.5, b.y);
		const c = boardToPx({ x: 0, y: i });
		const d = boardToPx({ x: board.size, y: i });
		ctx.moveTo(c.x, c.y + 0.5);
		ctx.lineTo(d.x, d.y + 0.5);
	}
	ctx.stroke();

	// Star points (hoshi) on standard 19×19 boards.
	if (board.size === 19) {
		const stars = [3, 9, 15];
		ctx.fillStyle = "rgba(20, 14, 8, 0.8)";
		for (const sx of stars) {
			for (const sy of stars) {
				const p = boardToPx({ x: sx, y: sy });
				ctx.beginPath();
				ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

function drawStones(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	boardToPx: (p: Vec2) => Vec2,
): void {
	for (const s of board.stones) {
		const c = boardToPx(s.position);
		const r = stoneRadius(board, c, boardToPx);
		const color = PLAYER_COLORS[s.playerIndex]?.stone ?? "#888";

		const grad = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, r * 0.1, c.x, c.y, r);
		grad.addColorStop(0, "rgba(255,255,255,0.35)");
		grad.addColorStop(0.4, color);
		grad.addColorStop(1, shadeHex(color, -25));
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.stroke();
	}
}

function drawPreview(inputs: RenderInputs): void {
	const { previewCanvas, hover, hoverPlayer, hoverValid, board, pixelSize } = inputs;
	const ctx = previewCanvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, pixelSize, pixelSize);
	if (!hover || hoverPlayer === null) return;

	const { boardToPx } = layout(pixelSize, board);
	const c = boardToPx(hover);
	const r = stoneRadius(board, c, boardToPx);

	const color = hoverValid
		? PLAYER_COLORS[hoverPlayer]?.stone ?? "#aaa"
		: "#c25149";

	ctx.globalAlpha = hoverValid ? 0.55 : 0.35;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
	ctx.fill();

	ctx.globalAlpha = 1;
	ctx.strokeStyle = hoverValid ? color : "#c25149";
	ctx.setLineDash(hoverValid ? [] : [3, 3]);
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
	ctx.stroke();
	ctx.setLineDash([]);
}

// ---- Coordinate conversions ----------------------------------------------

export function layout(pixelSize: number, board: BoardSnapshot): {
	boardToPx: (p: Vec2) => Vec2;
	pxToBoard: (p: Vec2) => Vec2;
	pad: number;
	playable: number;
} {
	const pad = pixelSize * PADDING_RATIO;
	const playable = pixelSize - 2 * pad;
	const min = board.shrinkMargin;
	const max = board.size - board.shrinkMargin;
	const span = Math.max(0.0001, max - min);

	return {
		boardToPx: (p: Vec2) => ({
			x: pad + ((p.x - min) / span) * playable,
			y: pad + ((max - p.y) / span) * playable,
		}),
		pxToBoard: (p: Vec2) => ({
			x: min + ((p.x - pad) / playable) * span,
			y: max - ((p.y - pad) / playable) * span,
		}),
		pad,
		playable,
	};
}

function stoneRadius(
	board: BoardSnapshot,
	_center: Vec2,
	boardToPx: (p: Vec2) => Vec2,
): number {
	const a = boardToPx({ x: 0, y: 0 });
	const b = boardToPx({ x: 1, y: 0 });
	const cellPx = Math.abs(b.x - a.x);
	return cellPx * 0.46;
	void board;
}

function mix(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

function shadeHex(hex: string, deltaPct: number): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m || !m[1]) return hex;
	const v = parseInt(m[1], 16);
	const r = clamp((v >> 16) & 0xff, 0, 255);
	const g = clamp((v >> 8) & 0xff, 0, 255);
	const b = clamp(v & 0xff, 0, 255);
	const f = 1 + deltaPct / 100;
	return `rgb(${clamp(r * f, 0, 255) | 0}, ${clamp(g * f, 0, 255) | 0}, ${clamp(b * f, 0, 255) | 0})`;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}
