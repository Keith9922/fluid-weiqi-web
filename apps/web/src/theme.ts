// Light / dark theme manager.
//
// State lives on <html data-theme="..."> so CSS rules can specialize via
// :root[data-theme="light"] vs :root[data-theme="dark"]. Persisted in
// localStorage; first visit honors prefers-color-scheme.

export type Theme = "light" | "dark";

const STORAGE_KEY = "fluid-weiqi-theme";

export function getInitialTheme(): Theme {
	const stored = (() => {
		try {
			return localStorage.getItem(STORAGE_KEY) as Theme | null;
		} catch {
			return null;
		}
	})();
	if (stored === "light" || stored === "dark") return stored;
	if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) {
		return "light";
	}
	return "dark";
}

export function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Storage unavailable (private mode) — that's fine.
	}
}

export function toggleTheme(current: Theme): Theme {
	return current === "light" ? "dark" : "light";
}
