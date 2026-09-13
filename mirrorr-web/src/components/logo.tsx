import { Link } from "@tanstack/react-router";

export function Logo({ className }: { className?: string }) {
	return (
		<Link to="/" className={`flex items-center gap-2.5 ${className ?? ""}`}>
			<div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center">
				<span className="text-background font-bold text-sm">M</span>
			</div>
			<span className="text-base font-semibold tracking-tight">Mirrorr</span>
		</Link>
	);
}
