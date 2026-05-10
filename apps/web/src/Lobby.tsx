import { useState } from "react";
import { AI_LABELS, DEFAULT_GAME_CONFIG, type AiLevel, type GameConfig } from "@fluid/core";
import { detectDevice } from "./device.ts";

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
	easy:   "刚学棋的朋友，落子随意，不会刁难你。第一次摸游戏可以选这个。",
	medium: "正经棋友，能跟你来回攻防，输赢看实力发挥。",
	hard:   "老练的对手，看得见全局，赢他得花点心思。",
	hell:   "深藏不露的高手，每手都要琢磨好一会儿。挑战自我用，慎入。",
};
const AI_TAGLINE: Record<AiLevel, string> = {
	easy:   "陪练",
	medium: "对手",
	hard:   "高手",
	hell:   "强敌",
};

export function Lobby({ connecting, error, onCreateOnline, onJoin, onCreateAi }: LobbyProps) {
	const [tab, setTab] = useState<Tab>("ai");
	const [name, setName] = useState(() => randomName());
	const [code, setCode] = useState("");
	const [aiLevel, setAiLevel] = useState<AiLevel>("medium");
	const [humanFirst, setHumanFirst] = useState(true);
	// On touch devices, recommend 13×13 by default — 19×19 cells would be
	// roughly 17px on a 375px-wide phone, too cramped for finger placement.
	const [config, setConfig] = useState<GameConfig>(() =>
		detectDevice() === "touch"
			? { ...DEFAULT_GAME_CONFIG, boardSize: 13 }
			: DEFAULT_GAME_CONFIG,
	);

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
								<div className="ai-card-head">
									<span className="ai-card-name">{AI_LABELS[level].persona}</span>
									<span className={`ai-card-badge ai-${level}`}>{AI_TAGLINE[level]}</span>
								</div>
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
