// Win / loss reveal modal — shown when match.flow.isEnded becomes true.
//
// Visual: a giant calligraphic 胜 / 负 / 和 character with a gold-leaf
// gradient and an ink-stroke ripple, plus subtitle (territory score / reason)
// and primary action ("再来一局" leaves the room → user can immediately start
// another match from the lobby).

import type { EndReason } from "@fluid/core";

export type WinModalOutcome = "win" | "loss" | "draw";

export type WinModalProps = {
	outcome: WinModalOutcome;
	endReason?: EndReason;
	myScore?: { cells: number; percent: number };
	oppScore?: { cells: number; percent: number };
	myName: string;
	oppName: string;
	onLeave: () => void;
	onDismiss: () => void;
};

const TITLE: Record<WinModalOutcome, string> = {
	win:  "胜",
	loss: "负",
	draw: "和",
};

const SUBTITLE: Record<WinModalOutcome, string> = {
	win:  "你赢了",
	loss: "你输了",
	draw: "平局收官",
};

function reasonText(reason: EndReason | undefined, outcome: WinModalOutcome): string {
	if (reason === "resign") {
		return outcome === "win" ? "对手投子认输" : outcome === "loss" ? "你投子认输了" : "";
	}
	if (reason === "two-passes") return "双方连续 Pass · 按领地结算";
	return "";
}

export function WinModal({
	outcome, endReason, myScore, oppScore, myName, oppName, onLeave, onDismiss,
}: WinModalProps) {
	const reason = reasonText(endReason, outcome);

	return (
		<div className={`win-backdrop win-${outcome}`} onClick={onDismiss}>
			<div className="win-card" onClick={e => e.stopPropagation()}>
				<div className="win-glyph-wrap">
					<span className={`win-glyph win-glyph-${outcome}`} aria-label={SUBTITLE[outcome]}>
						{TITLE[outcome]}
					</span>
					<span className="win-glyph-shadow">{TITLE[outcome]}</span>
				</div>

				<div className="win-subtitle">{SUBTITLE[outcome]}</div>
				{reason && <div className="win-reason">{reason}</div>}

				{myScore && oppScore && (
					<div className="win-score">
						<ScoreRow
							name={myName}
							color="black"
							isMe
							leading={myScore.cells >= oppScore.cells}
							score={myScore}
						/>
						<ScoreRow
							name={oppName}
							color="white"
							leading={oppScore.cells > myScore.cells}
							score={oppScore}
						/>
					</div>
				)}

				<div className="win-actions">
					<button className="btn ghost" onClick={onDismiss}>查看棋盘</button>
					<button className="btn primary" onClick={onLeave}>再来一局</button>
				</div>
			</div>
		</div>
	);
}

function ScoreRow({
	name, color, score, isMe, leading,
}: {
	name: string;
	color: "black" | "white";
	score: { cells: number; percent: number };
	isMe?: boolean;
	leading?: boolean;
}) {
	return (
		<div className={`win-score-row${leading ? " leading" : ""}`}>
			<span className={`win-stone win-stone-${color}`} />
			<span className="win-score-name">
				{name}
				{isMe && <span className="win-score-me"> · 你</span>}
			</span>
			<span className="win-score-cells">{score.cells} 格</span>
			<span className="win-score-pct">{score.percent.toFixed(1)}%</span>
		</div>
	);
}
