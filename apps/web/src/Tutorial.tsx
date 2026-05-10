// First-time gameplay tutorial. Shown once per browser (gated by localStorage).
// Three-step modal explaining the click model.

import { useState } from "react";
import { detectDevice } from "./device.ts";

const STORAGE_KEY = "fluid-weiqi-tutorial-seen";

const DESKTOP_STEPS = [
	{
		title: "1 · 鼠标悬停",
		body: "把鼠标移到棋盘上 —— 你会实时看到 \"如果落在这\"会形成什么样的色块。两颗同色子靠近时，色块会像水滴一样合并。",
	},
	{
		title: "2 · 左键落子",
		body: "看好位置点左键就落子。子默认会吸附到最近的网格交叉点。",
	},
	{
		title: "3 · Shift = 自由落子",
		body: "按住 Shift 再点击，就不再吸附到网格 —— 这是\"液态围棋\"区别于传统围棋的关键特性，你可以下在任意连续位置。",
	},
];

const TOUCH_STEPS = [
	{
		title: "1 · 轻点落子",
		body: "想下在哪儿就点哪儿 —— 棋子会自动吸附到最近的格点。跟普通围棋一样直觉。",
	},
	{
		title: "2 · 按住拖动 = 自由落子",
		body: "想精确放在格点之间？手指按住别松，然后慢慢拖到想要的位置，松手就下了。这是\"液态围棋\"的关键玩法。",
	},
	{
		title: "3 · 拖动时看放大镜",
		body: "按住拖动时，手指上方会出现一个圆形放大镜，让你能精确看到棋子会落在哪 —— 不会被手指挡住。",
	},
];

export function shouldShowTutorial(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== "1";
	} catch {
		return true;
	}
}

export function markTutorialSeen(): void {
	try {
		localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		// ignore
	}
}

export function Tutorial({ onDone }: { onDone: () => void }) {
	const [step, setStep] = useState(0);
	const steps = detectDevice() === "touch" ? TOUCH_STEPS : DESKTOP_STEPS;
	const isLast = step === steps.length - 1;
	const current = steps[step]!;

	const close = () => {
		markTutorialSeen();
		onDone();
	};

	return (
		<div className="tutorial-backdrop" onClick={close}>
			<div className="tutorial-card" onClick={e => e.stopPropagation()}>
				<div className="tutorial-progress">
					{steps.map((_, i) => (
						<span key={i} className={`tutorial-dot${i === step ? " active" : ""}${i < step ? " done" : ""}`} />
					))}
				</div>
				<h3>{current.title}</h3>
				<p>{current.body}</p>
				<div className="tutorial-actions">
					<button className="btn ghost" onClick={close}>跳过</button>
					{isLast ? (
						<button className="btn primary" onClick={close}>明白了，开下！</button>
					) : (
						<button className="btn primary" onClick={() => setStep(s => s + 1)}>下一步</button>
					)}
				</div>
			</div>
		</div>
	);
}
