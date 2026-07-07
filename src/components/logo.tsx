import { Link } from "@tanstack/react-router";

export function Logo({ className }: { className?: string }) {
    return (
        <Link to="/" className={`flex items-center gap-2.5 ${className ?? ""}`}>
            <div className="w-6 h-6 rounded-md bg-foreground flex items-center justify-center">
                <span className="text-background font-bold text-2xs">M</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">
                Mirrorr
            </span>
        </Link>
    );
}
