import * as React from "react";
import { cn } from "@/lib/utils";

// ── Single digit-masked input ────────────────────────────────────────

export interface MaskedSlotProps {
	/** Number of digit positions */
	digits: number;
	/** Max allowed numeric value for the whole field */
	max: number;
	/** Current raw digit string, length <= digits */
	value: string;
	onChange: (v: string) => void;
	/** Called when backspace is pressed with all digits empty */
	onBackspaceEmpty?: () => void;
	/** Called when input arrives but field is already at max length */
	onFull?: () => void;
	isActive?: boolean;
	onFocus?: () => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

export const MaskedSlot = React.forwardRef<HTMLInputElement, MaskedSlotProps>(
	(
		{
			digits,
			max,
			value,
			onChange,
			onBackspaceEmpty,
			onFull,
			isActive,
			onFocus,
			placeholder,
			disabled,
			className,
		},
		ref,
	) => {
		const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
			const raw = e.target.value.replace(/\D/g, "").slice(0, digits);
			if (raw.length === 0) {
				onChange("");
				return;
			}
			const num = parseInt(raw, 10);
			const clamped = Math.min(num, max);
			onChange(String(clamped).padStart(Math.min(raw.length, digits), "0"));
		};

		const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
			// When field is full and user types a digit, fire onFull to advance
			if (value.length === digits && /\d/.test(e.key)) {
				e.preventDefault();
				onFull?.();
				return;
			}
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const delta = e.key === "ArrowUp" ? 1 : -1;
				const n = parseInt(value, 10) || 0;
				const next = (((n + delta) % (max + 1)) + (max + 1)) % (max + 1);
				onChange(String(next).padStart(digits, "0"));
			}
			if (e.key === "Backspace" && value.length === 0) {
				onBackspaceEmpty?.();
			}
		};

		return (
			<input
				ref={ref}
				type="text"
				inputMode="numeric"
				placeholder={placeholder}
				value={value}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				onFocus={onFocus}
				disabled={disabled}
				maxLength={digits}
				autoComplete="off"
				className={cn(
					"h-auto min-w-0 text-center text-sm font-mono rounded-xl border border-border/50 bg-muted/30 px-2 py-1.5 outline-none transition-colors select-none placeholder:text-muted-faint focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
					isActive && "border-ring ring-2 ring-ring/20",
					className,
				)}
				style={{
					width: `${digits * 2}ch`,
					flexShrink: 0,
					boxSizing: "content-box",
				}}
			/>
		);
	},
);
MaskedSlot.displayName = "MaskedSlot";

// ── Universal time input ─────────────────────────────────────────────

const UNIT_LABELS: Record<string, string> = {
	YYYY: "Years",
	YY: "Years",
	MM: "Months",
	DD: "Days",
	HH: "Hours",
	mm: "Minutes",
	ss: "Seconds",
};

/** Max numeric value for each format token */
const TOKEN_MAX: Record<string, number> = {
	YYYY: 9999,
	YY: 99,
	MM: 12,
	DD: 31,
	HH: 23,
	mm: 59,
	ss: 59,
};

interface TimeSlotDef {
	kind: "slot";
	name: string;
	digits: number;
	max: number;
	label: string;
}

interface TimeSepDef {
	kind: "sep";
	char: string;
	display: string;
}

type TimePartDef = TimeSlotDef | TimeSepDef;

function parseTimeFormat(format: string): TimePartDef[] {
	const parts: TimePartDef[] = [];
	let i = 0;
	while (i < format.length) {
		const ch = format[i];
		if (/[A-Za-z]/.test(ch)) {
			let j = i;
			while (j < format.length && format[j] === ch) j++;
			const name = format.slice(i, j);
			parts.push({
				kind: "slot",
				name,
				digits: name.length,
				max: TOKEN_MAX[name] ?? 10 ** name.length - 1,
				label: UNIT_LABELS[name] ?? name,
			});
			i = j;
		} else {
			parts.push({
				kind: "sep",
				char: ch,
				display: ch === "T" ? "-" : ch,
			});
			i++;
		}
	}
	return parts;
}

interface TimeInputProps {
	/** ISO format string, e.g. "MM-DD-HH:mm:ss" */
	format: string;
	/** Offset in ms (the raw sum of typed values) */
	value: number | null;
	/** Emits the raw offset in ms — does NOT include Date.now() */
	onChange?: (offsetMs: number) => void;
	/** Called when backspace is pressed on the first (leftmost) slot with empty digits */
	onBackspaceEmpty?: () => void;
	/** Called when the very last slot in the sequence gets fully filled */
	onFull?: () => void;
	disabled?: boolean;
	className?: string;
}

export function TimeInput({
	format,
	onChange,
	onBackspaceEmpty,
	onFull,
	disabled,
	className,
}: TimeInputProps) {
	const parts = React.useMemo(() => parseTimeFormat(format), [format]);
	const slots = React.useMemo(
		() => parts.filter((p): p is TimeSlotDef => p.kind === "slot"),
		[parts],
	);
	const slotRefs = React.useRef<(HTMLInputElement | null)[]>([]);

	const [activeIdx, setActiveIdx] = React.useState<number | null>(null);

	// Slot values: one string per slot, e.g. ["01", "06", "21", "21", "18", "19"]
	const [slotValues, setSlotValues] = React.useState<string[]>(() =>
		slots.map(() => ""),
	);

	// Keep slotValues length in sync if format changes
	React.useEffect(() => {
		setSlotValues((prev) => {
			if (prev.length === slots.length) return prev;
			return slots.map((_, i) => prev[i] ?? "");
		});
	}, [slots.length, slots.map]);

	const lastSlotIdx = slots.length - 1;

	const handleSlotChange = React.useCallback(
		(slotIdx: number, newValue: string) => {
			setSlotValues((prev) => {
				const next = [...prev];
				next[slotIdx] = newValue;
				return next;
			});
		},
		[],
	);

	// Emit raw offset in ms whenever slot values change
	React.useEffect(() => {
		const ms = slotValues.reduce((acc, val, i) => {
			const n = parseInt(val, 10) || 0;
			const unit = slots[i]?.label;
			switch (unit) {
				case "Years":
					return acc + n * 365.25 * 86400000;
				case "Months":
					return acc + n * 30.44 * 86400000;
				case "Days":
					return acc + n * 86400000;
				case "Hours":
					return acc + n * 3600000;
				case "Minutes":
					return acc + n * 60000;
				case "Seconds":
					return acc + n * 1000;
				default:
					return acc;
			}
		}, 0);
		onChange?.(ms);
	}, [slotValues, slots, onChange]);

	return (
		<div
			className={cn("w-min grid", className)}
			style={{
				gridTemplateColumns: `repeat(${parts.length}, min-content)`,
				gridTemplateRows: "auto auto",
			}}
		>
			{parts.map((part, i) => {
				if (part.kind === "sep") {
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: format parts are static
							key={`c-${i}`}
							className="grid"
							style={{
								gridTemplateRows: "subgrid",
								gridRow: "span 2",
							}}
						>
							<span className="flex items-center justify-center text-sm font-mono text-muted-foreground select-none">
								{part.display}
							</span>
							<div className="invisible" />
						</div>
					);
				}

				const si = slots.indexOf(part);

				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: format parts are static
						key={`c-${i}`}
						className="grid"
						style={{
							gridTemplateRows: "subgrid",
							gridRow: "span 2",
						}}
					>
						<MaskedSlot
							ref={(el) => {
								slotRefs.current[si] = el;
							}}
							digits={part.digits}
							max={part.max}
							value={slotValues[si] ?? ""}
							onChange={(v) => handleSlotChange(si, v)}
							isActive={activeIdx === si}
							onFocus={() => setActiveIdx(si)}
							placeholder={part.name}
							disabled={disabled}
							className="mx-2"
							onBackspaceEmpty={() => {
								if (si === 0) onBackspaceEmpty?.();
								else slotRefs.current[si - 1]?.focus();
							}}
							onFull={() => {
								if (si === lastSlotIdx) onFull?.();
								else slotRefs.current[si + 1]?.focus();
							}}
						/>
						<span className="flex items-center justify-center text-[10px] text-muted-foreground text-center leading-none py-1">
							{part.label}
						</span>
					</div>
				);
			})}
		</div>
	);
}
