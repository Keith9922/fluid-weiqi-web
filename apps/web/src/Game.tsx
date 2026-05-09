// Game screen — renders the board, handles input, displays player/turn UI.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchActionRequest, MatchSnapshot, RoomPlayerInfo, Vec2 } from "@fluid/core";
import { layout, render, setupCanvases } from "./render.ts";

export type GameProps = {
	roomCode: string;
	myPlayerIndex: number;
	players: RoomPlayerInfo[];
	snapshot: MatchSnapshot;
	matchStarted: boolean;
	rejection: string | null;
	onAction: (req: MatchActionRequest) => void;
	onLeave: () => void;
};

const BOARD_PX = 640;

export function Game(props: GameProps) {
	const { snapshot, myPlayerIndex, matchStarted, players, rejection, onAction, onLeave, roomCode } = props;
	const board = snapshot.board;
	const flow = snapshot.flow;

	const baseRef = useRef<HTMLCanvasElement | null>(null);
	const previewRef = useRef<HTMLCanvasElement | null>(null);
	const inputRef = useRef<HTMLCanvasElement | null>(null);

	const [hover, setHover] = useState<Vec2 | null>(null);
	const [shiftHeld, setShiftHeld] = useState(false);
	const myTurn = matchStarted && !flow.isEnded && flow.currentPlayerIndex === myPlayerIndex;

	// Init canvases on mount.
	useEffect(() => {
		if (!baseRef.current || !previewRef.current) return;
		setupCanvases(baseRef.current, previewRef.current, BOARD_PX);
	}, []);

	// Re-render base whenever the board changes.
	useEffect(() => {
		if (!baseRef.current || !previewRef.current) return;
		render({
			canvas: baseRef.current,
			previewCanvas: previewRef.current,
			board,
			pixelSize: BOARD_PX,
			hover: null,
			hoverPlayer: null,
			hoverValid: true,
			currentPlayerIndex: flow.currentPlayerIndex,
		});
	}, [board, flow.currentPlayerIndex]);

	// Re-render preview when hover/turn changes.
	useEffect(() => {
		if (!baseRef.current || !previewRef.current) return;
		const canPreview = myTurn && hover !== null && inBounds(hover, board);
		render({
			canvas: baseRef.current,
			previewCanvas: previewRef.current,
			board,
			pixelSize: BOARD_PX,
			hover: canPreview ? hover : null,
			hoverPlayer: myPlayerIndex,
			hoverValid: canPreview,
			currentPlayerIndex: flow.currentPlayerIndex,
		});
	}, [hover, myTurn, board, myPlayerIndex, flow.currentPlayerIndex]);

	// Track Shift key for free placement.
	useEffect(() => {
		const onDown = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
		const onUp = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);
		return () => {
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
		};
	}, []);

	const lay = useMemo(() => layout(BOARD_PX, board), [board]);

	function eventToBoardPoint(e: React.MouseEvent<HTMLCanvasElement>): Vec2 | null {
		const rect = e.currentTarget.getBoundingClientRect();
		const px = ((e.clientX - rect.left) / rect.width) * BOARD_PX;
		const py = ((e.clientY - rect.top) / rect.height) * BOARD_PX;
		return lay.pxToBoard({ x: px, y: py });
	}

	function snapPoint(p: Vec2): Vec2 {
		if (shiftHeld) return p;
		return { x: Math.round(p.x), y: Math.round(p.y) };
	}

	const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!myTurn) return;
		const raw = eventToBoardPoint(e);
		if (!raw) return;
		setHover(snapPoint(raw));
	};

	const handleLeave = () => setHover(null);

	const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!myTurn) return;
		const raw = eventToBoardPoint(e);
		if (!raw) return;
		const point = snapPoint(raw);
		if (!inBounds(point, board)) return;

		onAction({
			playerIndex: myPlayerIndex,
			actionType: "place",
			position: point,
			turnSeq: flow.turnSeq,
			actionSeq: 0,
		});
	};

	const handlePass = () => {
		if (!myTurn) return;
		onAction({
			playerIndex: myPlayerIndex,
			actionType: "pass",
			turnSeq: flow.turnSeq,
			actionSeq: 0,
		});
	};

	return (
		<div className="game">
			<div className="game-info">
				<span className="muted">房间</span>
				<strong style={{ letterSpacing: "0.15em", fontSize: "1.05rem" }}>{roomCode}</strong>
				{players.map((p, i) => (
					<span
						key={i}
						className={`player-chip${flow.currentPlayerIndex === i && matchStarted && !flow.isEnded ? " active" : ""}`}
						data-player={i}
					>
						<span className="dot" />
						{p.connected ? p.name : "(待加入)"}
						{i === myPlayerIndex && <span className="muted"> · 你</span>}
					</span>
				))}
			</div>

			{!matchStarted && (
				<div className="banner">
					等另一个玩家加入：把房间码 <kbd>{roomCode}</kbd> 发给对手，或在新标签页打开本站点击"加入"。
				</div>
			)}

			{flow.isEnded && (
				<div className="banner">
					{flow.winnerIndex === null
						? "对局结束 · 平局"
						: `对局结束 · ${players[flow.winnerIndex]?.name ?? `Player ${flow.winnerIndex + 1}`} 胜`}
				</div>
			)}

			{rejection && <div className="error">{rejection}</div>}

			<div className="game-board">
				<canvas ref={baseRef} />
				<canvas ref={previewRef} className="preview" />
				<canvas
					ref={inputRef}
					className="input"
					width={BOARD_PX}
					height={BOARD_PX}
					style={{ width: BOARD_PX, height: BOARD_PX }}
					onMouseMove={handleMove}
					onMouseLeave={handleLeave}
					onClick={handleClick}
				/>
			</div>

			<div className="game-controls">
				<button className="btn secondary" onClick={handlePass} disabled={!myTurn}>
					Pass
				</button>
				<button className="btn danger" onClick={onLeave}>
					离开房间
				</button>
				<span className="shrug">
					左键落子（吸附） · 按住 <kbd>Shift</kbd> 自由落子
				</span>
			</div>
		</div>
	);
}

function inBounds(p: Vec2, board: { size: number; shrinkMargin: number }): boolean {
	return (
		p.x >= board.shrinkMargin &&
		p.x <= board.size - board.shrinkMargin &&
		p.y >= board.shrinkMargin &&
		p.y <= board.size - board.shrinkMargin
	);
}
