// Live battle lounge — list of public rooms, with actions to spectate or
// join. Sibling component of <Lobby> (rendered inside its "直播间" tab).
//
// Subscription lifecycle is owned by <App> — this component is presentational
// + dispatches callbacks. That keeps a single WS subscription regardless of
// how the user toggles tabs.

import { useEffect, useState } from "react";
import {
	AI_LABELS,
	DEFAULT_GAME_CONFIG,
	type GameConfig,
	type LoungeRoomSummary,
	type RoomLifecycleStage,
	type RoomVisibility,
} from "@fluid/core";

export type LoungeProps = {
	rooms: LoungeRoomSummary[];
	subscribed: boolean;                   // false until the first loungeSnapshot
	serverTime: number | null;             // unix ms from server, used for "几分钟前"
	connecting: boolean;                   // ws connecting
	myName: string;
	onCreateRoom: (opts: {
		roomName: string;
		visibility: RoomVisibility;
		gameConfig: GameConfig;
	}) => void;
	onJoinAsPlayer: (roomCode: string) => void;
	onSpectate: (roomCode: string) => void;
	onJoinByCode: (roomCode: string) => void;     // private fallback
};

export function Lounge(props: LoungeProps) {
	const {
		rooms, subscribed, serverTime, connecting,
		myName, onCreateRoom, onJoinAsPlayer, onSpectate, onJoinByCode,
	} = props;

	const [showCreate, setShowCreate] = useState(false);
	const [showJoinByCode, setShowJoinByCode] = useState(false);
	const [joinCode, setJoinCode] = useState("");

	// Tick the clock so "几分钟前" updates without external prop changes.
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => setTick(t => t + 1), 15_000);
		return () => window.clearInterval(id);
	}, []);

	// Use local time for "几分钟前". serverTime is plumbed in for future skew
	// correction but on typical home networks the round-trip is small enough
	// that Date.now() is fine.
	void serverTime;
	const referenceNow = Date.now();

	const trimmedJoin = joinCode.trim().toUpperCase();
	const canJoinByCode = trimmedJoin.length === 6;

	return (
		<div className="lounge-panel">
			<div className="lounge-toolbar">
				<button
					className="btn primary"
					disabled={connecting}
					onClick={() => setShowCreate(true)}
				>
					创建直播间
				</button>
				<button
					className="btn ghost lounge-private-toggle"
					onClick={() => setShowJoinByCode(v => !v)}
					title="用 6 位房间码加入私密房间"
				>
					{showJoinByCode ? "收起房间码" : "用房间码加入"}
				</button>
			</div>

			{showJoinByCode && (
				<div className="lounge-join-by-code">
					<input
						value={joinCode}
						onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
						placeholder="6 位房间码"
						className="code-input"
					/>
					<button
						className="btn secondary"
						disabled={!canJoinByCode || connecting}
						onClick={() => onJoinByCode(trimmedJoin)}
					>
						加入
					</button>
				</div>
			)}

			{!subscribed && (
				<div className="lounge-loading">正在连接直播间…</div>
			)}

			{subscribed && rooms.length === 0 && (
				<div className="lounge-empty">
					<p>暂时没有公开对局。</p>
					<p className="muted">第一个开房间的就是你。</p>
				</div>
			)}

			{subscribed && rooms.length > 0 && (
				<ul className="lounge-list">
					{rooms.map(r => (
						<LoungeRoomCard
							key={r.roomCode}
							room={r}
							now={referenceNow}
							myName={myName}
							onJoinAsPlayer={onJoinAsPlayer}
							onSpectate={onSpectate}
						/>
					))}
				</ul>
			)}

			{showCreate && (
				<CreateRoomDialog
					defaultName={`${myName} 的房间`}
					onClose={() => setShowCreate(false)}
					onSubmit={opts => {
						setShowCreate(false);
						onCreateRoom(opts);
					}}
				/>
			)}
		</div>
	);
}

// ---- Room card ----------------------------------------------------------

function LoungeRoomCard(props: {
	room: LoungeRoomSummary;
	now: number;
	myName: string;
	onJoinAsPlayer: (code: string) => void;
	onSpectate: (code: string) => void;
}) {
	const { room, now, onJoinAsPlayer, onSpectate } = props;
	const canJoinAsPlayer = room.stage === "waiting" && room.playerCount < room.capacity;
	const canSpectate = room.stage !== "waiting";
	return (
		<li className={`lounge-room stage-${room.stage}`}>
			<div className="lounge-room-head">
				<span className="lounge-room-name">{room.roomName}</span>
				<StageBadge stage={room.stage} />
			</div>
			<div className="lounge-room-meta">
				<span>棋盘 {room.boardSize}×{room.boardSize}</span>
				<span>·</span>
				<span>{room.playerCount}/{room.capacity}</span>
				{room.spectatorCount > 0 && (
					<>
						<span>·</span>
						<span>{room.spectatorCount} 位观众</span>
					</>
				)}
				<span>·</span>
				<span>{formatAge(now - room.createdAt)}</span>
			</div>
			<div className="lounge-room-players">
				{room.players.length === 0 && <span className="muted">（暂无人入座）</span>}
				{room.players.map(p => (
					<span key={p.playerIndex} className={`lounge-player p${p.playerIndex}`}>
						<span className="lounge-player-dot" />
						{p.isAi && p.aiLevel
							? `${AI_LABELS[p.aiLevel].persona} (${AI_LABELS[p.aiLevel].zh})`
							: p.name}
					</span>
				))}
			</div>
			<div className="lounge-room-actions">
				{canJoinAsPlayer && (
					<button
						className="btn primary small"
						onClick={() => onJoinAsPlayer(room.roomCode)}
					>
						入座对弈
					</button>
				)}
				{canSpectate && (
					<button
						className="btn secondary small"
						onClick={() => onSpectate(room.roomCode)}
					>
						进入观战
					</button>
				)}
				{!canJoinAsPlayer && !canSpectate && (
					<span className="muted">…</span>
				)}
			</div>
		</li>
	);
}

function StageBadge({ stage }: { stage: RoomLifecycleStage }) {
	const label = stage === "waiting" ? "等待中" : stage === "playing" ? "进行中" : "已结束";
	return <span className={`lounge-stage-badge stage-${stage}`}>{label}</span>;
}

function formatAge(ms: number): string {
	if (ms < 0) ms = 0;
	const sec = Math.floor(ms / 1000);
	if (sec < 30) return "刚刚";
	if (sec < 60) return `${sec} 秒前`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min} 分钟前`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} 小时前`;
	const d = Math.floor(hr / 24);
	return `${d} 天前`;
}

// ---- Create-room dialog -------------------------------------------------

function CreateRoomDialog(props: {
	defaultName: string;
	onClose: () => void;
	onSubmit: (opts: {
		roomName: string;
		visibility: RoomVisibility;
		gameConfig: GameConfig;
	}) => void;
}) {
	const [roomName, setRoomName] = useState(props.defaultName);
	const [visibility, setVisibility] = useState<RoomVisibility>("public");
	const [config, setConfig] = useState<GameConfig>(DEFAULT_GAME_CONFIG);

	const trimmedName = roomName.trim();
	const canSubmit = trimmedName.length > 0;

	return (
		<div className="confirm-backdrop" onClick={props.onClose}>
			<div className="confirm-card lounge-create-card" onClick={e => e.stopPropagation()}>
				<h4>创建对局</h4>

				<div className="field">
					<label htmlFor="room-name">房间名</label>
					<input
						id="room-name"
						value={roomName}
						onChange={e => setRoomName(e.target.value)}
						maxLength={32}
						autoFocus
					/>
				</div>

				<div className="field">
					<label>可见性</label>
					<div className="seg">
						<button
							className={`seg-item${visibility === "public" ? " active" : ""}`}
							onClick={() => setVisibility("public")}
						>
							公开 · 直播间可见
						</button>
						<button
							className={`seg-item${visibility === "private" ? " active" : ""}`}
							onClick={() => setVisibility("private")}
						>
							私密 · 仅房间码
						</button>
					</div>
					<div className="config-hint">
						{visibility === "public"
							? "其他玩家可以在直播间看到并加入或观战。"
							: "房间不会出现在直播间。把房间码发给对手才能加入。"}
					</div>
				</div>

				<details className="config-panel">
					<summary>对局设置 · 棋盘 {config.boardSize}×{config.boardSize}</summary>
					<div className="config-grid">
						<div className="config-item">
							<label>棋盘大小</label>
							<div className="seg">
								{[9, 13, 19].map(s => (
									<button
										key={s}
										className={`seg-item${config.boardSize === s ? " active" : ""}`}
										onClick={() => setConfig({ ...config, boardSize: s })}
									>
										{s}×{s}
									</button>
								))}
							</div>
						</div>
						<div className="config-item">
							<label>影响力硬度 <span className="muted">{config.stoneHardness.toFixed(2)}</span></label>
							<input
								type="range" min={0} max={0.95} step={0.05}
								value={config.stoneHardness}
								onChange={e => setConfig({ ...config, stoneHardness: Number(e.target.value) })}
							/>
						</div>
						<div className="config-item">
							<label>落子力度 <span className="muted">{config.stoneStrength.toFixed(2)}</span></label>
							<input
								type="range" min={0.5} max={2.0} step={0.1}
								value={config.stoneStrength}
								onChange={e => setConfig({ ...config, stoneStrength: Number(e.target.value) })}
							/>
						</div>
					</div>
				</details>

				<div className="confirm-actions">
					<button className="btn ghost" onClick={props.onClose}>取消</button>
					<button
						className="btn primary"
						disabled={!canSubmit}
						onClick={() => props.onSubmit({ roomName: trimmedName, visibility, gameConfig: config })}
					>
						创建
					</button>
				</div>
			</div>
		</div>
	);
}

