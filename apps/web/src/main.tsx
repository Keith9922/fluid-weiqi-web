import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, getInitialTheme } from "./theme.ts";
import "./styles.css";

// Apply theme before first paint to avoid a flash.
applyTheme(getInitialTheme());

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
