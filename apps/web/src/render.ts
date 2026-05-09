// Three-layered board rendering:
//   1. WebGL2 fluid shader  (background influence field — see fluidShader.ts)
//   2. Canvas 2D            (grid lines, hoshi dots, stones)
//   3. Canvas 2D            (hover preview — separate so we don't redraw the world)
//
// Stones are traditional black/white. Field tints are very subtle so the
// stones remain the visual focal point.

import type { BoardSnapshot, Vec2 } from "@fluid/core";
import { FluidRenderer } from "./render/fluidShader.ts";

export const PADDING_RATIO = 0.06;

export type StoneStyle = {
	stone: string;
	stroke: string;
	highlight: string;
};

export const PLAYER_STYLES: StoneStyle[] = [
	{ stone: "#15110d", stroke: "#000",     highlight: "rgba(255,255,255,0.18)" },  // black
	{ stone: "#f6efe2", stroke: "#7a6a4a", highlight: "rgba(255,255,255,0.55)" },  // ivory
];

// ---- Public API ----------------------------------------------------------

export type BoardCanvases = {
	fluid: HTMLCanvasElement;
	overlay: HTMLCanvasElement;
	preview: HTMLCanvasElement;
};

export class BoardRenderer {
	readonly canvases: BoardCanvases;
	private fluid: FluidRenderer;
	private pixelSize: number;
	private rafId: number | null = null;
	private currentBoard: BoardSnapshot | null = null;

	constructor(canvases: BoardCanvases, pixelSize: number) {
		this.canvases = canvases;
		this.pixelSize = pixelSize;

		// Setup canvases.
		const dpr = window.devicePixelRatio || 1;
		for (const c of [canvases.overlay, canvases.preview]) {
			c.width = pixelSize * dpr;
			c.height = pixelSize * dpr;
			c.style.width = `${pixelSize}px`;
			c.style.height = `${pixelSize}px`;
			c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		this.fluid = new FluidRenderer(canvases.fluid);
		this.fluid.resize(pixelSize, pixelSize, dpr);
	}

	setBoard(board: BoardSnapshot): void {
		this.currentBoard = board;
		this.drawOverlay(board);
		this.startAnimation();
	}

	setHover(point: Vec2 | null, playerIndex: number, valid: boolean): void {
		if (!this.currentBoard) return;
		this.drawPreview(this.currentBoard, point, playerIndex, valid);
	}

	pxToBoard(p: Vec2): Vec2 {
		if (!this.currentBoard) return p;
		const lay = layout(this.pixelSize, this.currentBoard);
		return lay.pxToBoard(p);
	}

	boardToPx(p: Vec2): Vec2 {
		if (!this.currentBoard) return p;
		const lay = layout(this.pixelSize, this.currentBoard);
		return lay.boardToPx(p);
	}

	dispose(): void {
		if (this.rafId !== null) cancelAnimationFrame(this.rafId);
		this.fluid.dispose();
	}

	private startAnimation(): void {
		if (this.rafId !== null) return;
		const tick = () => {
			if (this.currentBoard) this.fluid.render(this.currentBoard);
			this.rafId = requestAnimationFrame(tick);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	private drawOverlay(board: BoardSnapshot): void {
		const ctx = this.canvases.overlay.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, this.pixelSize, this.pixelSize);

		const lay = layout(this.pixelSize, board);
		drawGrid(ctx, board, lay.boardToPx);
		drawStones(ctx, board, lay.boardToPx);
	}

	private drawPreview(
		board: BoardSnapshot,
		point: Vec2 | null,
		playerIndex: number,
		valid: boolean,
	): void {
		const ctx = this.canvases.preview.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, this.pixelSize, this.pixelSize);
		if (!point) return;

		const lay = layout(this.pixelSize, board);
		const c = lay.boardToPx(point);
		const r = stoneRadius(board, lay.boardToPx);

		const style = PLAYER_STYLES[playerIndex] ?? PLAYER_STYLES[0]!;

		ctx.globalAlpha = valid ? 0.6 : 0.4;
		ctx.fillStyle = valid ? style.stone : "#c25149";
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.fill();

		ctx.globalAlpha = 1;
		ctx.strokeStyle = valid ? style.stone : "#c25149";
		ctx.setLineDash(valid ? [] : [3, 3]);
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
	}
}

// ---- Layout & coords -----------------------------------------------------

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
		boardToPx: p => ({
			x: pad + ((p.x - min) / span) * playable,
			y: pad + ((max - p.y) / span) * playable,
		}),
		pxToBoard: p => ({
			x: min + ((p.x - pad) / playable) * span,
			y: max - ((p.y - pad) / playable) * span,
		}),
		pad,
		playable,
	};
}

function stoneRadius(board: BoardSnapshot, boardToPx: (p: Vec2) => Vec2): number {
	const a = boardToPx({ x: 0, y: 0 });
	const b = boardToPx({ x: 1, y: 0 });
	return Math.abs(b.x - a.x) * 0.46;
}

// ---- Drawing primitives --------------------------------------------------

function drawGrid(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	boardToPx: (p: Vec2) => Vec2,
): void {
	const lines = Math.floor(board.size) + 1;
	ctx.strokeStyle = "rgba(20, 14, 8, 0.38)";
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

	// Star points (hoshi) — only for standard sizes.
	const hoshi = standardHoshi(board.size);
	if (hoshi) {
		ctx.fillStyle = "rgba(20, 14, 8, 0.85)";
		for (const sx of hoshi) {
			for (const sy of hoshi) {
				const p = boardToPx({ x: sx, y: sy });
				ctx.beginPath();
				ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

function standardHoshi(size: number): number[] | null {
	if (size === 19) return [3, 9, 15];
	if (size === 13) return [3, 6, 9];
	if (size === 9)  return [2, 4, 6];
	return null;
}

function drawStones(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	boardToPx: (p: Vec2) => Vec2,
): void {
	const r = stoneRadius(board, boardToPx);
	for (const s of board.stones) {
		const c = boardToPx(s.position);
		const style = PLAYER_STYLES[s.playerIndex] ?? PLAYER_STYLES[0]!;

		// Subtle drop shadow under each stone.
		ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
		ctx.beginPath();
		ctx.arc(c.x + 1.2, c.y + 2.2, r, 0, Math.PI * 2);
		ctx.fill();

		// Main fill with radial gradient (off-center highlight = round look).
		const grad = ctx.createRadialGradient(
			c.x - r * 0.35, c.y - r * 0.45, r * 0.12,
			c.x, c.y, r,
		);
		grad.addColorStop(0, style.highlight);
		grad.addColorStop(0.35, style.stone);
		grad.addColorStop(1, style.stroke);
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.fill();

		// Crisp outline.
		ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.stroke();
	}
}
