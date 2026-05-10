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
};

export const PLAYER_STYLES: StoneStyle[] = [
	{ stone: "#0a0a0a", stroke: "#000" },        // black
	{ stone: "#f8f4ed", stroke: "#a89878" },     // ivory
];

// ---- Public API ----------------------------------------------------------

export type BoardCanvases = {
	fluid: HTMLCanvasElement;
	overlay: HTMLCanvasElement;
	preview: HTMLCanvasElement;
};

export type HoverPreview = {
	position: Vec2;
	playerIndex: number;
	strength: number;
};

export class BoardRenderer {
	readonly canvases: BoardCanvases;
	private fluid: FluidRenderer;
	private pixelSize: number;
	private rafId: number | null = null;
	private currentBoard: BoardSnapshot | null = null;
	private hoverPreview: HoverPreview | null = null;

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

	setHover(point: Vec2 | null, playerIndex: number, valid: boolean, strength = 1): void {
		if (!this.currentBoard) return;
		this.drawPreview(this.currentBoard, point, playerIndex, valid);
		// The fluid layer also gets a "what-if" stone so the level set updates
		// in real time as the cursor moves.
		this.hoverPreview = (point && valid)
			? { position: point, playerIndex, strength }
			: null;
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
			if (this.currentBoard) {
				const preview = this.hoverPreview;
				this.fluid.render(
					this.currentBoard,
					PADDING_RATIO,
					preview
						? {
							x: preview.position.x,
							y: preview.position.y,
							strength: preview.strength,
							playerIndex: preview.playerIndex,
						}
						: null,
				);
			}
			this.rafId = requestAnimationFrame(tick);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	private drawOverlay(board: BoardSnapshot): void {
		const ctx = this.canvases.overlay.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, this.pixelSize, this.pixelSize);

		const lay = layout(this.pixelSize, board);
		drawPlayableBorder(ctx, lay.pad, lay.playable);
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

function drawPlayableBorder(
	ctx: CanvasRenderingContext2D,
	pad: number,
	playable: number,
): void {
	// Dark inner frame around the playable area, matching the upstream build.
	ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
	ctx.lineWidth = 2;
	ctx.strokeRect(pad - 0.5, pad - 0.5, playable + 1, playable + 1);
}

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

// Stones are NOT drawn as 3D spheres — the visible piece is the influence
// blob rendered by the WebGL fluid shader. We just place a tiny marker
// dot at each stone's center so the player can always see exactly where
// they (or the AI) clicked, even when the stone alone has too little
// influence to form a blob.
function drawStones(
	ctx: CanvasRenderingContext2D,
	board: BoardSnapshot,
	boardToPx: (p: Vec2) => Vec2,
): void {
	const r = stoneRadius(board, boardToPx);
	const markerR = Math.max(2, r * 0.18);
	for (const s of board.stones) {
		const c = boardToPx(s.position);
		const isBlack = s.playerIndex === 0;
		ctx.fillStyle = isBlack ? "#0a0a0a" : "#f8f4ed";
		ctx.beginPath();
		ctx.arc(c.x, c.y, markerR, 0, Math.PI * 2);
		ctx.fill();
		// Thin contrast outline so the dot reads on either color blob or wood.
		ctx.strokeStyle = isBlack ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.55)";
		ctx.lineWidth = 0.8;
		ctx.beginPath();
		ctx.arc(c.x, c.y, markerR, 0, Math.PI * 2);
		ctx.stroke();
	}
}
