/**
 * Declarative setInterval hook.
 * Automatically cleans up on unmount and when callback changes.
 *
 * Usage:
 *   useInterval(() => setNow(Date.now()), 1000)
 *   useInterval(tick, active ? 1000 : null) // null pauses
 */
import { useEffect, useRef } from "react";

export function useInterval(callback: () => void, delay: number | null) {
	const savedCallback = useRef(callback);

	// Remember the latest callback
	useEffect(() => {
		savedCallback.current = callback;
	}, [callback]);

	// Set up the interval
	useEffect(() => {
		if (delay === null) return;
		const id = setInterval(() => savedCallback.current(), delay);
		return () => clearInterval(id);
	}, [delay]);
}
