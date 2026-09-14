import { useEffect } from "react";
import { isNativeApp } from "@/lib/token-store";

function setKbVar(px: number) {
	document.documentElement.style.setProperty(
		"--kb-inset",
		`${Math.max(0, Math.round(px))}px`,
	);
}

export function useKeyboardInset() {
	useEffect(() => {
		if (!isNativeApp()) return;
		let cancelled = false;
		let listeners: Array<() => void> = [];

		async function wireNative() {
			try {
				const mod = await import("@capacitor/keyboard");
				if (cancelled) return;
				const { Keyboard, KeyboardResize } = mod;
				await Keyboard.setResizeMode({ mode: KeyboardResize.None });
				const show = await Keyboard.addListener(
					"keyboardWillShow",
					(info) => {
						setKbVar(info.keyboardHeight);
						requestAnimationFrame(() => {
							const el = document.activeElement as HTMLElement | null;
							el?.scrollIntoView({ block: "center" });
						});
					},
				);
				const hide = await Keyboard.addListener("keyboardWillHide", () =>
					setKbVar(0),
				);
				listeners = [() => void show.remove(), () => void hide.remove()];
			} catch {
				wireViewport();
			}
		}

		function wireViewport() {
			const vv = window.visualViewport;
			if (!vv) return;
			const sync = () => {
				const inset = window.innerHeight - vv.height - vv.offsetTop;
				setKbVar(inset);
			};
			vv.addEventListener("resize", sync);
			vv.addEventListener("scroll", sync);
			listeners = [
				() => vv.removeEventListener("resize", sync),
				() => vv.removeEventListener("scroll", sync),
			];
			sync();
		}

		void wireNative();
		return () => {
			cancelled = true;
			for (const off of listeners) off();
			listeners = [];
			setKbVar(0);
		};
	}, []);
}
