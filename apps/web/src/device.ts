// Device-class detection. Used in a few places to adapt copy and defaults
// (board size, tutorial wording, controls hint) without forking components.

export type DeviceClass = "desktop" | "touch";

// Pure check we can run during module init / SSR (in our case there's no SSR
// but we still want it cheap and side-effect-free).
export function detectDevice(): DeviceClass {
	if (typeof window === "undefined") return "desktop";
	// Coarse pointer = primary input is touch (phone/tablet without mouse).
	// Width gate is a safety net for desktop browsers that report coarse
	// pointer because of a Wacom tablet or hybrid laptop in tablet mode.
	const coarse = matchMedia?.("(pointer: coarse)")?.matches ?? false;
	const narrow = window.innerWidth <= 820;
	return coarse && narrow ? "touch" : "desktop";
}
