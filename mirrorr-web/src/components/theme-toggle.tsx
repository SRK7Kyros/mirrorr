/**
 * Reusable theme toggle button.
 * Used in both _auth.tsx and _app.tsx to avoid duplication.
 */

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
	const { theme, setTheme } = useTheme();
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className={className}
			onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
		>
			<Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
			<Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
			<span className="sr-only">Toggle theme</span>
		</Button>
	);
}
