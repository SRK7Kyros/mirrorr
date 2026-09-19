import { useEffect } from "react";

const DEAD_ZONE_PX = 24;
const FOCUS_FALLBACK_PX = 320;
const BLUR_SETTLE_MS = 120;

function setKbVar(px: number) {
	document.documentElement.style.setProperty(
		"--kb-inset",
		`${Math.max(0, Math.round(px))}px`,
	);
}

function isEditable(el: EventTarget | null): el is HTMLElement {
	const t = el as HTMLElement | null;
	if (!t) return false;
	return (
		t.tagName === "INPUT" ||
		t.tagName === "TEXTAREA" ||
		t.tagName === "SELECT" ||
		t.isContentEditable
	);
}

export function useKeyboardInset() {
	useEffect(() => {
		const cleanups: Array<() => void> = [];
		let pluginHeight = 0;
		let pluginOpen = false;
		let focused = false;
		let blurTimer = 0;

		const viewportDiff = () => {
			const vv = window.visualViewport;
			if (!vv) return 0;
			return window.innerHeight - vv.height - vv.offsetTop;
		};

		const apply = () => {
			const diff = viewportDiff();
			const open = pluginOpen || focused || diff > DEAD_ZONE_PX;
			let inset = 0;
			if (open) {
				inset = Math.max(
					diff > 0 ? diff : 0,
					pluginHeight,
					focused ? FOCUS_FALLBACK_PX : 0,
				);
			}
			setKbVar(inset);
		};

		const scrollFocused = () => {
			requestAnimationFrame(() => {
				const el = document.activeElement as HTMLElement | null;
				el?.scrollIntoView({ block: "center" });
			});
		};

		const vv = window.visualViewport;
		if (vv) {
			vv.addEventListener("resize", apply);
			vv.addEventListener("scroll", apply);
			cleanups.push(
				() => vv.removeEventListener("resize", apply),
				() => vv.removeEventListener("scroll", apply),
			);
		}

		const onFocusIn = (e: FocusEvent) => {
			if (!isEditable(e.target)) return;
			window.clearTimeout(blurTimer);
			focused = true;
			apply();
			scrollFocused();
		};
		const onFocusOut = () => {
			window.clearTimeout(blurTimer);
			blurTimer = window.setTimeout(() => {
				focused = isEditable(document.activeElement);
				if (!focused) {
					pluginOpen = false;
					pluginHeight = 0;
				}
				apply();
			}, BLUR_SETTLE_MS);
		};
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		cleanups.push(
			() => document.removeEventListener("focusin", onFocusIn),
			() => document.removeEventListener("focusout", onFocusOut),
		);

		let cancelled = false;
		void (async () => {
			try {
				const mod = await import("@capacitor/keyboard");
				if (cancelled) return;
				const { Keyboard, KeyboardResize } = mod;
				await Keyboard.setResizeMode({ mode: KeyboardResize.None });
				const show = await Keyboard.addListener(
					"keyboardWillShow",
					(info) => {
						pluginOpen = true;
						pluginHeight = info.keyboardHeight || 0;
						apply();
						scrollFocused();
					},
				);
				const hide = await Keyboard.addListener("keyboardWillHide", () => {
					pluginOpen = false;
					pluginHeight = 0;
					apply();
				});
				cleanups.push(() => void show.remove(), () => void hide.remove());
			} catch {
				// Viewport + focus wiring above already covers this case.
			}
		})();

		apply();
		return () => {
			cancelled = true;
			window.clearTimeout(blurTimer);
			for (const off of cleanups) off();
			cleanups.length = 0;
			setKbVar(0);
		};
	}, []);
}
