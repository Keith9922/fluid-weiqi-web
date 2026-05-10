// Game screen — renders the board, handles input, displays player/turn UI.
// Uses the new BoardRenderer (WebGL fluid + Canvas2D overlay).

import { useEffect, useMemo, useRef, useState } from "react";
import {
	BoardState,
	buildAnalysis,
	type GameConfig,
	type MatchActionRequest,
	type MatchSnapshot,
	type RoomPlayerInfo,
	type Vec2,
} from "@fluid/core";
import { AI_LABELS } from "@fluid/core";
import { BoardRenderer, PLAYER_STYLES } from "./render.ts";
import { TouchLoupe } from "./TouchLoupe.tsx";
import { Tutorial, shouldShowTutorial } from "./Tutorial.tsx";
import { WinModal, type WinModalOutcome } from "./WinModal.tsx";
import { detectDevice } from "./device.ts";

export type GameProps = {
	roomCode: string;
	myPlayerIndex: number;
	players: RoomPlayerInfo[];
	snapshot: MatchSnapshot;
	matchStarted: boolean;
	gameConfig: GameConfig;
	rejection: string | null;
	aiThinking: boolean;
	captureToast: { id: number; count: number } | null;
	onCaptureToastDone: () => void;
	onAction: (req: MatchActionRequest) => void;
	onLeave: () => void;
};

const BOARD_PX = 640;

export function Game(props: GameProps) {
	const {
		snapshot, myPlayerIndex, matchStarted, players, gameConfig,
		rejection, aiThinking, captureToast, onCaptureToastDone,
		onAction, onLeave, roomCode,
	} = props;
	const board = snapshot.board;
	const flow = snapshot.flow;

	// Real-time territory percentage from the same analysis grid the engine
	// uses for capture (downsampled influence sum, threshold = 1).
	const territory = useMemo(() => {
		if (board.stones.length === 0) return { p0: 0, p1: 0, neutral: 100 };
		const liveBoard = BoardState.fromSnapshot(board);
		const grid = buildAnalysis(liveBoard, 48);
		let p0 = 0, p1 = 0, total = grid.territory.length;
		for (let i = 0; i < total; ++i) {
			const owner = grid.territory[i] ?? -1;
			if (owner === 0) p0++;
			else if (owner === 1) p1++;
		}
		return {
			p0: (p0 / total) * 100,
			p1: (p1 / total) * 100,
			neutral: ((total - p0 - p1) / total) * 100,
		};
	}, [board]);

	// Capture toast auto-dismiss
	useEffect(() => {
		if (!captureToast) return;
		const t = setTimeout(onCaptureToastDone, 2500);
		return () => clearTimeout(t);
	}, [captureToast, onCaptureToastDone]);

	const fluidRef = useRef<HTMLCanvasElement | null>(null);
	const overlayRef = useRef<HTMLCanvasElement | null>(null);
	const previewRef = useRef<HTMLCanvasElement | null>(null);
	const inputRef = useRef<HTMLCanvasElement | null>(null);
	const rendererRef = useRef<BoardRenderer | null>(null);

	const [hover, setHover] = useState<Vec2 | null>(null);
	const [shiftHeld, setShiftHeld] = useState(false);
	const [touchDragging, setTouchDragging] = useState(false);
	const [touchLoupePx, setTouchLoupePx] = useState<{ x: number; y: number } | null>(null);
	const [showTutorial, setShowTutorial] = useState(() => shouldShowTutorial());
	const [confirmResign, setConfirmResign] = useState(false);
	const [winModalDismissed, setWinModalDismissed] = useState(false);
	const touchStateRef = useRef<{
		pointerId: number;
		startClientX: number;
		startClientY: number;
		startTime: number;
		dragMode: boolean;
		dragTimer: number | null;
	} | null>(null);
	const myTurn = matchStarted && !flow.isEnded && flow.currentPlayerIndex === myPlayerIndex;

	useEffect(() => {
		if (!fluidRef.current || !overlayRef.current || !previewRef.current) return;
		try {
			const r = new BoardRenderer(
				{ fluid: fluidRef.current, overlay: overlayRef.current, preview: previewRef.current },
				BOARD_PX,
			);
			rendererRef.current = r;
			r.setBoard(board);
		} catch (err) {
			console.error("Failed to init BoardRenderer:", err);
		}
		return () => {
			rendererRef.current?.dispose();
			rendererRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Re-render when board changes.
	useEffect(() => {
		rendererRef.current?.setBoard(board);
	}, [board]);

	// Re-render hover preview.
	useEffect(() => {
		const r = rendererRef.current;
		if (!r) return;
		if (!myTurn || !hover || !inBounds(hover, board)) {
			r.setHover(null, myPlayerIndex, true, gameConfig.stoneStrength);
			return;
		}
		r.setHover(hover, myPlayerIndex, true, gameConfig.stoneStrength);
	}, [hover, myTurn, board, myPlayerIndex, gameConfig.stoneStrength]);

	// Track Shift for free placement.
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

	function eventToBoardPoint(
		clientX: number,
		clientY: number,
		canvas: HTMLCanvasElement,
	): Vec2 | null {
		const r = rendererRef.current;
		if (!r) return null;
		const rect = canvas.getBoundingClientRect();
		const px = ((clientX - rect.left) / rect.width) * BOARD_PX;
		const py = ((clientY - rect.top) / rect.height) * BOARD_PX;
		return r.pxToBoard({ x: px, y: py });
	}

	function snapPoint(p: Vec2): Vec2 {
		return { x: Math.round(p.x), y: Math.round(p.y) };
	}

	function placeAt(point: Vec2): void {
		if (!inBounds(point, board)) return;
		onAction({
			playerIndex: myPlayerIndex,
			actionType: "place",
			position: point,
			turnSeq: flow.turnSeq,
			actionSeq: 0,
		});
	}

	const TAP_MAX_MOVE_PX = 14;
	const DRAG_HOLD_MS = 180;

	const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!myTurn) return;
		const isTouchLike = e.pointerType === "touch" || e.pointerType === "pen";

		if (!isTouchLike) {
			// Mouse: legacy click-to-place behavior happens on pointerup.
			return;
		}

		// Touch / pen: show loupe + snapped preview IMMEDIATELY for instant
		// feedback. Drag-mode classification (tap vs press-drag) only changes
		// whether the preview snaps; it doesn't gate the visual feedback.
		e.currentTarget.setPointerCapture(e.pointerId);
		if ("vibrate" in navigator) navigator.vibrate(8);

		const raw = eventToBoardPoint(e.clientX, e.clientY, e.currentTarget);
		if (raw) {
			setHover(snapPoint(raw));
			setTouchLoupePx({ x: e.clientX, y: e.clientY });
			setTouchDragging(true);
		}

		// 180 ms later, if the finger has not moved enough to trigger drag
		// already, switch from snapped preview to free preview at the finger.
		const dragTimer = window.setTimeout(() => {
			const st = touchStateRef.current;
			if (!st || st.dragMode) return;
			st.dragMode = true;
			const rawNow = eventToBoardPoint(st.startClientX, st.startClientY, e.currentTarget);
			if (rawNow) setHover(rawNow);
		}, DRAG_HOLD_MS);

		touchStateRef.current = {
			pointerId: e.pointerId,
			startClientX: e.clientX,
			startClientY: e.clientY,
			startTime: Date.now(),
			dragMode: false,
			dragTimer,
		};
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!myTurn) return;
		const isTouchLike = e.pointerType === "touch" || e.pointerType === "pen";

		if (!isTouchLike) {
			// Mouse: hover preview as user moves.
			const raw = eventToBoardPoint(e.clientX, e.clientY, e.currentTarget);
			if (!raw) return;
			setHover(shiftHeld ? raw : snapPoint(raw));
			return;
		}

		// Touch / pen.
		const st = touchStateRef.current;
		if (!st || st.pointerId !== e.pointerId) return;

		if (!st.dragMode) {
			// Have we moved far enough to count as a drag (vs tap)?
			const dx = e.clientX - st.startClientX;
			const dy = e.clientY - st.startClientY;
			if (dx * dx + dy * dy > TAP_MAX_MOVE_PX * TAP_MAX_MOVE_PX) {
				if (st.dragTimer !== null) clearTimeout(st.dragTimer);
				st.dragTimer = null;
				st.dragMode = true;
			}
		}

		// Always update the loupe + preview to follow the finger.
		// Snap until drag mode kicks in, then track raw finger position.
		const raw = eventToBoardPoint(e.clientX, e.clientY, e.currentTarget);
		if (!raw) return;
		setHover(st.dragMode ? raw : snapPoint(raw));
		setTouchLoupePx({ x: e.clientX, y: e.clientY });
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!myTurn) return;
		const isTouchLike = e.pointerType === "touch" || e.pointerType === "pen";

		if (!isTouchLike) {
			// Mouse: place. Snap unless Shift held.
			const raw = eventToBoardPoint(e.clientX, e.clientY, e.currentTarget);
			if (!raw) return;
			placeAt(shiftHeld ? raw : snapPoint(raw));
			return;
		}

		// Touch / pen.
		const st = touchStateRef.current;
		if (!st || st.pointerId !== e.pointerId) return;
		if (st.dragTimer !== null) clearTimeout(st.dragTimer);

		const raw = eventToBoardPoint(e.clientX, e.clientY, e.currentTarget);
		if (raw) {
			if (st.dragMode) {
				// Free placement at finger position.
				placeAt(raw);
			} else {
				// Quick tap → snap to nearest grid intersection.
				placeAt(snapPoint(raw));
			}
		}

		touchStateRef.current = null;
		setTouchDragging(false);
		setTouchLoupePx(null);
		setHover(null);
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			// already released
		}
	};

	const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const st = touchStateRef.current;
		if (st && st.dragTimer !== null) clearTimeout(st.dragTimer);
		touchStateRef.current = null;
		setTouchDragging(false);
		setTouchLoupePx(null);
		setHover(null);
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			// ignore
		}
	};

	const handlePointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
		// Only clear hover for mouse — touch/pen state is owned by pointerup.
		if (e.pointerType === "mouse") setHover(null);
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

	const handleResignConfirm = () => {
		setConfirmResign(false);
		onAction({
			playerIndex: myPlayerIndex,
			actionType: "resign",
			turnSeq: flow.turnSeq,
			actionSeq: 0,
		});
	};

	// Reset modal-dismissed state whenever a new match starts (turnSeq=0 + not ended).
	useEffect(() => {
		if (!flow.isEnded) setWinModalDismissed(false);
	}, [flow.isEnded, flow.turnSeq]);

	const winOutcome: WinModalOutcome | null = (() => {
		if (!flow.isEnded) return null;
		if (flow.winnerIndex === null) return "draw";
		return flow.winnerIndex === myPlayerIndex ? "win" : "loss";
	})();
	const showWinModal = winOutcome !== null && !winModalDismissed;
	const myFinalScore = flow.finalScore?.find(s => s.player === myPlayerIndex);
	const oppFinalScore = flow.finalScore?.find(s => s.player !== myPlayerIndex);

	const stoneCounts = [
		board.stones.filter(s => s.playerIndex === 0).length,
		board.stones.filter(s => s.playerIndex === 1).length,
	];

	return (
		<div className="game">
			{showTutorial && <Tutorial onDone={() => setShowTutorial(false)} />}
			<div className="game-rail">
				<RoomBadge code={roomCode} />
				{players.map((p, i) => (
					<PlayerCard
						key={i}
						player={p}
						isMe={i === myPlayerIndex}
						isCurrent={flow.currentPlayerIndex === i && matchStarted && !flow.isEnded}
						stoneCount={stoneCounts[i] ?? 0}
						aiThinking={aiThinking && p.isAi && flow.currentPlayerIndex === i}
					/>
				))}
				<GameMeta config={gameConfig} matchStarted={matchStarted} flow={flow} myPlayerIndex={myPlayerIndex} />
			</div>

			<div className="game-stage">
				{!matchStarted && !players.some(p => p.isAi) && (
					<div className="banner banner-info">
						等另一位玩家加入。把房间码 <kbd>{roomCode}</kbd> 发给对手。
					</div>
				)}

				{rejection && <div className="banner banner-error">{rejection}</div>}

				<div className="game-board">
					<canvas ref={fluidRef} className="fluid" />
					<canvas ref={overlayRef} className="overlay" />
					<canvas ref={previewRef} className="preview" />
					<canvas
						ref={inputRef}
						className="input"
						width={BOARD_PX}
						height={BOARD_PX}
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerCancel}
						onPointerLeave={handlePointerLeave}
					/>
					{captureToast && (
						<div key={captureToast.id} className="capture-toast">
							提子 +{captureToast.count}
						</div>
					)}
					{touchDragging && touchLoupePx && (
						<TouchLoupe
							finger={touchLoupePx}
							sourceCanvas={fluidRef.current}
							boardCanvasRect={inputRef.current?.getBoundingClientRect() ?? null}
						/>
					)}
				</div>

				<TerritoryBar
					p0={territory.p0}
					p1={territory.p1}
					neutral={territory.neutral}
				/>

				<div className="game-controls">
					<button className="btn secondary" onClick={handlePass} disabled={!myTurn}>
						Pass · 跳过
					</button>
					<button
						className="btn ghost resign-btn"
						onClick={() => setConfirmResign(true)}
						disabled={flow.isEnded || !matchStarted}
					>
						投子认输
					</button>
					<button className="btn ghost" onClick={onLeave}>
						离开房间
					</button>
					<span className="game-controls-hint">
						{detectDevice() === "touch"
							? "轻点落子（吸附） · 按住拖动 = 自由落子"
							: <>左键落子（吸附） · 按住 <kbd>Shift</kbd> 自由落子</>}
					</span>
				</div>
			</div>

			{confirmResign && (
				<div className="confirm-backdrop" onClick={() => setConfirmResign(false)}>
					<div className="confirm-card" onClick={e => e.stopPropagation()}>
						<h4>确定要投子认输吗？</h4>
						<p>认输后本局立即结束，对手获胜。</p>
						<div className="confirm-actions">
							<button className="btn ghost" onClick={() => setConfirmResign(false)}>取消</button>
							<button className="btn danger" onClick={handleResignConfirm}>投子认输</button>
						</div>
					</div>
				</div>
			)}

			{showWinModal && winOutcome && (
				<WinModal
					outcome={winOutcome}
					endReason={flow.endReason}
					myScore={myFinalScore && { cells: myFinalScore.cells, percent: myFinalScore.percent }}
					oppScore={oppFinalScore && { cells: oppFinalScore.cells, percent: oppFinalScore.percent }}
					myName={players[myPlayerIndex]?.name ?? "你"}
					oppName={players.find((_, i) => i !== myPlayerIndex)?.name ?? "对手"}
					onLeave={onLeave}
					onDismiss={() => setWinModalDismissed(true)}
				/>
			)}
		</div>
	);
}

function RoomBadge({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			className="room-badge"
			onClick={() => {
				navigator.clipboard.writeText(code).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
			title="点击复制房间码"
		>
			<span className="room-badge-label">房间</span>
			<span className="room-badge-code">{code}</span>
			<span className="room-badge-action">{copied ? "已复制" : "复制"}</span>
		</button>
	);
}

function PlayerCard({
	player, isMe, isCurrent, stoneCount, aiThinking,
}: {
	player: RoomPlayerInfo;
	isMe: boolean;
	isCurrent: boolean;
	stoneCount: number;
	aiThinking: boolean;
}) {
	const style = PLAYER_STYLES[player.playerIndex] ?? PLAYER_STYLES[0]!;
	return (
		<div className={`player-card${isCurrent ? " current" : ""}`}>
			<div className="player-stone" style={{ background: style.stone, borderColor: style.stroke }} />
			<div className="player-info">
				<div className="player-name">
					{player.connected ? player.name : "(待加入)"}
					{isMe && <span className="player-tag-me">你</span>}
					{player.isAi && player.aiLevel && (
						<span className="player-tag-ai">{AI_LABELS[player.aiLevel].zh}</span>
					)}
				</div>
				{player.isAi && player.aiLevel && (
					<div className="player-aka">代号 · {AI_LABELS[player.aiLevel].persona}</div>
				)}
				<div className="player-meta">
					<span>{stoneCount} 子</span>
					{aiThinking && <span className="ai-thinking">思考中…</span>}
					{isCurrent && !aiThinking && <span className="turn-tag">该你</span>}
				</div>
			</div>
		</div>
	);
}

function GameMeta({
	config, matchStarted, flow, myPlayerIndex,
}: {
	config: GameConfig;
	matchStarted: boolean;
	flow: { turnSeq: number; isEnded: boolean; passStates: boolean[]; currentPlayerIndex: number };
	myPlayerIndex: number;
}) {
	return (
		<div className="game-meta">
			<div className="meta-row"><span>棋盘</span><b>{config.boardSize} × {config.boardSize}</b></div>
			<div className="meta-row"><span>硬度</span><b>{config.stoneHardness.toFixed(2)}</b></div>
			<div className="meta-row"><span>力度</span><b>{config.stoneStrength.toFixed(2)}</b></div>
			{matchStarted && !flow.isEnded && (
				<div className="meta-row"><span>第 {flow.turnSeq + 1} 手</span><b>{flow.currentPlayerIndex === myPlayerIndex ? "你" : "对手"}</b></div>
			)}
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

function TerritoryBar({ p0, p1, neutral }: { p0: number; p1: number; neutral: number }) {
	return (
		<div className="territory-bar">
			<div className="territory-meter" aria-label="占地比例">
				<div className="territory-fill territory-black" style={{ width: `${p0}%` }} />
				<div className="territory-fill territory-neutral" style={{ width: `${neutral}%` }} />
				<div className="territory-fill territory-white" style={{ width: `${p1}%` }} />
			</div>
			<div className="territory-legend">
				<span className="legend-item legend-black"><span className="legend-dot" />黑 {p0.toFixed(0)}%</span>
				<span className="legend-item legend-neutral"><span className="legend-dot" />空地 {neutral.toFixed(0)}%</span>
				<span className="legend-item legend-white"><span className="legend-dot" />白 {p1.toFixed(0)}%</span>
			</div>
		</div>
	);
}
