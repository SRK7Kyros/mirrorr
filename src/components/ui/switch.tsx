import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

function Switch({
	className,
	size = "default",
	pending,
	checked,
	...props
}: SwitchPrimitive.Root.Props & {
	size?: "sm" | "default";
	pending?: boolean;
}) {
	// Unchecked thumb translateX=0, Checked=calc(100% - 2px).
	// Default (track=32px, thumb=16px): center=8px. Sm (track=24px, thumb=12px): center=6px.
	const thumbOffset = pending
		? size === "sm"
			? "6px"
			: "8px"
		: checked
			? "calc(100% - 2px)"
			: "0px";

	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:bg-primary/50",
				className,
			)}
			checked={checked}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block rounded-full bg-background ring-0 transition-transform duration-200 ease-in-out",
					"group-data-[size=default]/switch:size-4",
					"group-data-[size=sm]/switch:size-3",
					"dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground",
				)}
				style={{ transform: `translateX(${thumbOffset})` }}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
