import { useEffect } from "react";

const FOCUS_FALLBACK_PX = 320;
const DEAD_ZONE_PX = 16;

function setKbVar(px: number) {
	document.documentElement.style.setProperty(
		"--kb-inset",
		`${Math.max(0, Math.round(px))}px`,
	);
}

function scrollFocusedIntoView() {
	requestAnimationFrame(() => {
		const el = document.activeElement as HTMLElement | null;
		el?.scrollIntoView({ block: "center" });
	});
}

export function useKeyboardInset() {
	useEffect(() => {
		const cleanups: Array<() => void> = [];
		setKbVar(0);

		const vv = window.visualViewport;
		if (vv) {
			let shown = false;
			const sync = () => {
				const raw = window.innerHeight - vv.height - vv.offsetTop;
				const inset = raw < DEAD_ZONE_PX ? 0 : raw;
				setKbVar(inset);
				const nowShown = inset > 0;
				if (nowShown && !shown) scrollFocusedIntoView();
				shown = nowShown;
			};
			vv.addEventListener("resize", sync);
			vv.addEventListener("scroll", sync);
			cleanups.push(
				() => vv.removeEventListener("resize", sync),
				() => vv.removeEventListener("scroll", sync),
			);
			sync();
		} else {
			const onFocusIn = (e: FocusEvent) => {
				const t = e.target as HTMLElement | null;
				if (
					t &&
					(t.tagName === "INPUT" ||
						t.tagName === "TEXTAREA" ||
						t.tagName === "SELECT" ||
						t.isContentEditable)
				) {
					setKbVar(FOCUS_FALLBACK_PX);
					scrollFocusedIntoView();
				}
			};
			const onFocusOut = () => setKbVar(0);
			document.addEventListener("focusin", onFocusIn);
			document.addEventListener("focusout", onFocusOut);
			cleanups.push(
				() => document.removeEventListener("focusin", onFocusIn),
				() => document.removeEventListener("focusout", onFocusOut),
			);
		}

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
						if (!window.visualViewport) setKbVar(info.keyboardHeight);
						scrollFocusedIntoView();
					},
				);
				const hide = await Keyboard.addListener("keyboardWillHide", () => {
					if (!window.visualViewport) setKbVar(0);
				});
				cleanups.push(() => void show.remove(), () => void hide.remove());
			} catch {
				// Viewport/focus wiring above already covers this case.
			}
		})();

		return () => {
			cancelled = true;
			for (const off of cleanups) off();
			cleanups.length = 0;
			setKbVar(0);
		};
	}, []);
}
