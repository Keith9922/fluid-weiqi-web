import { useState } from "react";
import { AI_LABELS, DEFAULT_GAME_CONFIG, type AiLevel, type GameConfig } from "@fluid/core";

export type LobbyProps = {
	connecting: boolean;
	error: string | null;
	onCreateOnline: (name: string, config: GameConfig) => void;
	onJoin: (code: string, name: string) => void;
	onCreateAi: (name: string, aiLevel: AiLevel, humanFirst: boolean, config: GameConfig) => void;
};

type Tab = "online" | "ai";

const BOARD_SIZES = [9, 13, 19] as const;
const AI_LEVELS: AiLevel[] = ["easy", "medium", "hard", "hell"];
const AI_DESCRIPTION: Record<AiLevel, string> = {
	easy:   "随机落子，会避开自杀。新手陪练。",
	medium: "1-ply 启发式，会算提子和大局。普通玩家有得拼。",
	hard:   "深度 3 minimax + α-β 剪枝。casual 玩家很难赢。",
	hell:   "MCTS + 启发式 rollout。每手思考 5-10 秒。准备好了吗？",
};

export function Lobby({ connecting, error, onCreateOnline, onJoin, onCreateAi }: LobbyProps) {
	const [tab, setTab] = useState<Tab>("ai");
	const [name, setName] = useState(() => randomName());
	const [code, setCode] = useState("");
	const [aiLevel, setAiLevel] = useState<AiLevel>("medium");
	const [humanFirst, setHumanFirst] = useState(true);
	const [config, setConfig] = useState<GameConfig>(DEFAULT_GAME_CONFIG);

	const trimmedName = name.trim();
	const trimmedCode = code.trim().toUpperCase();
	const canSubmit = !connecting && trimmedName.length > 0;
	const canJoin = canSubmit && trimmedCode.length === 6;

	return (
		<div className="lobby">
			<div className="lobby-hero">
				<h2>Fluid Weiqi</h2>
				<p>
					连续影响场版围棋。原作者{" "}
					<a href="https://github.com/WangNianyi2001/Fluid-Weiqi" target="_blank" rel="noreferrer">@WangNianyi2001</a>。
				</p>
			</div>

			<div className="field">
				<label htmlFor="name">你的名字</label>
				<input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={16} />
			</div>

			<div className="tabs">
				<button className={`tab${tab === "ai" ? " active" : ""}`} onClick={() => setTab("ai")}>vs AI</button>
				<button className={`tab${tab === "online" ? " active" : ""}`} onClick={() => setTab("online")}>双人联机</button>
			</div>

			{tab === "ai" && (
				<div className="lobby-panel">
					<div className="ai-grid">
						{AI_LEVELS.map(level => (
							<button
								key={level}
								className={`ai-card${aiLevel === level ? " selected" : ""}`}
								onClick={() => setAiLevel(level)}
							>
								<div className={`ai-card-badge ai-${level}`}>{AI_LABELS[level].zh}</div>
								<div className="ai-card-desc">{AI_DESCRIPTION[level]}</div>
							</button>
						))}
					</div>

					<div className="row">
						<label className="check">
							<input type="checkbox" checked={humanFirst} onChange={e => setHumanFirst(e.target.checked)} />
							<span>我执黑先行（取消则 AI 先手）</span>
						</label>
					</div>

					<GameConfigPanel config={config} onChange={setConfig} />

					<button
						className="btn primary"
						disabled={!canSubmit}
						onClick={() => onCreateAi(trimmedName, aiLevel, humanFirst, config)}
					>
						开始对局
					</button>
				</div>
			)}

			{tab === "online" && (
				<div className="lobby-panel">
					<GameConfigPanel config={config} onChange={setConfig} />
					<button
						className="btn primary"
						disabled={!canSubmit}
						onClick={() => onCreateOnline(trimmedName, config)}
					>
						创建房间
					</button>

					<div className="separator">或加入已有房间</div>

					<div className="row">
						<input
							value={code}
							onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
							placeholder="6 位房间码"
							className="code-input"
						/>
						<button
							className="btn secondary"
							disabled={!canJoin}
							onClick={() => onJoin(trimmedCode, trimmedName)}
						>
							加入
						</button>
					</div>
				</div>
			)}

			{error && <div className="banner banner-error">{error}</div>}
		</div>
	);
}

function GameConfigPanel({ config, onChange }: { config: GameConfig; onChange: (c: GameConfig) => void }) {
	return (
		<details className="config-panel">
			<summary>对局设置 · 棋盘 {config.boardSize}×{config.boardSize} · 硬度 {config.stoneHardness.toFixed(2)} · 力度 {config.stoneStrength.toFixed(2)}</summary>
			<div className="config-grid">
				<div className="config-item">
					<label>棋盘大小</label>
					<div className="seg">
						{BOARD_SIZES.map(s => (
							<button
								key={s}
								className={`seg-item${config.boardSize === s ? " active" : ""}`}
								onClick={() => onChange({ ...config, boardSize: s })}
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
						onChange={e => onChange({ ...config, stoneHardness: Number(e.target.value) })}
					/>
					<div className="config-hint">小：影响范围广而柔；大：边界锐利。</div>
				</div>
				<div className="config-item">
					<label>落子力度 <span className="muted">{config.stoneStrength.toFixed(2)}</span></label>
					<input
						type="range" min={0.5} max={2.0} step={0.1}
						value={config.stoneStrength}
						onChange={e => onChange({ ...config, stoneStrength: Number(e.target.value) })}
					/>
					<div className="config-hint">每子的影响力强度。值越大棋子辐射越远。</div>
				</div>
			</div>
		</details>
	);
}

const ADJ = ["快", "慢", "野", "稳", "巧", "锐", "笑", "醒", "醉", "闲"];
const NOUN = ["手", "客", "棋手", "君", "侠", "童", "翁", "生", "人"];
function randomName(): string {
	const a = ADJ[Math.floor(Math.random() * ADJ.length)] ?? "";
	const n = NOUN[Math.floor(Math.random() * NOUN.length)] ?? "";
	return a + n;
}
