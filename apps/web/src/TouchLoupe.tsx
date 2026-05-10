// Floating magnifier shown above the finger during touch drag-placement.
//
// Mirrors a small region of the fluid+overlay canvases scaled up, so the
// player can see exactly where the stone will land without their finger
// occluding the spot. Mirrors Apple's text-selection loupe pattern.
//
// Implementation: drawImage from the source canvas to a smaller canvas,
// re-rendered every frame the loupe is visible.

import { useEffect, useRef } from "react";

const LOUPE_SIZE = 110;       // CSS pixels (bigger so 2-3 cells of context fit)
const LOUPE_OFFSET_Y = 90;    // distance above the finger (larger loupe needs more clearance)
const ZOOM = 1.5;             // magnification factor (lower = wider view, see merge with neighbors)

export type TouchLoupeProps = {
	finger: { x: number; y: number };          // viewport coordinates
	sourceCanvas: HTMLCanvasElement | null;     // the fluid canvas to mirror
	boardCanvasRect: DOMRect | null;            // input canvas rect (gives board area)
};

export function TouchLoupe({ finger, sourceCanvas, boardCanvasRect }: TouchLoupeProps) {
	const ref = useRef<HTMLCanvasElement | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas || !sourceCanvas || !boardCanvasRect) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = LOUPE_SIZE * dpr;
		canvas.height = LOUPE_SIZE * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		const tick = () => {
			if (!ref.current) return;
			ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

			// Map finger viewport coords -> source-canvas pixel coords.
			const cssX = finger.x - boardCanvasRect.left;
			const cssY = finger.y - boardCanvasRect.top;
			const srcX = (cssX / boardCanvasRect.width)  * sourceCanvas.width;
			const srcY = (cssY / boardCanvasRect.height) * sourceCanvas.height;

			// Region of the source canvas to sample, in source pixels.
			const sampleSize = (LOUPE_SIZE / ZOOM) * (sourceCanvas.width / boardCanvasRect.width);
			const sx = srcX - sampleSize / 2;
			const sy = srcY - sampleSize / 2;

			ctx.save();
			// Circular clip.
			ctx.beginPath();
			ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 2, 0, Math.PI * 2);
			ctx.clip();
			// Background fallback (in case finger is outside the WebGL canvas).
			ctx.fillStyle = "#3a2f24";
			ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
			try {
				ctx.drawImage(
					sourceCanvas,
					sx, sy, sampleSize, sampleSize,
					0, 0, LOUPE_SIZE, LOUPE_SIZE,
				);
			} catch {
				// drawImage can throw on tainted canvas — silently skip.
			}
			ctx.restore();

			// Crosshair at center.
			ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(LOUPE_SIZE / 2 - 8, LOUPE_SIZE / 2);
			ctx.lineTo(LOUPE_SIZE / 2 + 8, LOUPE_SIZE / 2);
			ctx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 8);
			ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 8);
			ctx.stroke();

			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);

		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		};
	}, [finger, sourceCanvas, boardCanvasRect]);

	const left = finger.x - LOUPE_SIZE / 2;
	const top = finger.y - LOUPE_OFFSET_Y - LOUPE_SIZE;

	return (
		<div
			className="touch-loupe"
			style={{
				left: `${left}px`,
				top: `${Math.max(8, top)}px`,
				width: `${LOUPE_SIZE}px`,
				height: `${LOUPE_SIZE}px`,
			}}
		>
			<canvas
				ref={ref}
				style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
			/>
		</div>
	);
}
