/**
 * @module components/telemetry-charts
 *
 * Recharts-based line charts for session telemetry data.
 * Renders CPU%, memory, and process count as time-series graphs.
 */
import {
    ResponsiveContainer,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Area,
    AreaChart,
} from "recharts";
import type { TelemetrySample } from "@/lib/schemas";
import { formatBytes } from "@/lib/utils";

interface TelemetryChartsProps {
    samples: TelemetrySample[];
    className?: string;
}

function formatTime(isoStr: string): string {
    const d = new Date(isoStr);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function ChartTooltipContent({
    active,
    payload,
    label,
    valueFormatter,
}: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
    valueFormatter: (v: number) => string;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-popover/90 backdrop-blur-xl border rounded-lg px-3 py-2 shadow-md text-xs">
            <p className="text-muted-foreground mb-1">{label}</p>
            <p className="font-semibold">{valueFormatter(payload[0].value)}</p>
        </div>
    );
}

function MetricChart({
    samples,
    dataKey,
    color,
    label,
    valueFormatter,
    yAxisFormatter,
}: {
    samples: TelemetrySample[];
    dataKey: keyof TelemetrySample;
    color: string;
    label: string;
    valueFormatter: (v: number) => string;
    yAxisFormatter?: (v: number) => string;
}) {
    if (samples.length === 0) {
        return (
            <div className="flex items-center justify-center h-[150px] text-xs text-muted-foreground">
                No telemetry data
            </div>
        );
    }

    const data = samples.map((s) => ({
        ...s,
        time: formatTime(s.timestamp),
    }));

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {label}
                </h4>
                <span className="text-[11px] font-mono text-muted-foreground">
                    {samples.length > 0
                        ? valueFormatter(
                              samples[samples.length - 1][dataKey] as number,
                          )
                        : "—"}
                </span>
            </div>
            <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                    >
                        <defs>
                            <linearGradient
                                id={`grad-${dataKey}`}
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                            >
                                <stop
                                    offset="0%"
                                    stopColor={color}
                                    stopOpacity={0.3}
                                />
                                <stop
                                    offset="100%"
                                    stopColor={color}
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border)"
                            vertical={false}
                        />
                        <XAxis
                            dataKey="time"
                            tick={{
                                fontSize: 10,
                                fill: "var(--muted-foreground)",
                            }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={60}
                        />
                        <YAxis
                            tick={{
                                fontSize: 10,
                                fill: "var(--muted-foreground)",
                            }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={yAxisFormatter}
                            width={50}
                        />
                        <Tooltip
                            content={
                                <ChartTooltipContent
                                    valueFormatter={valueFormatter}
                                />
                            }
                        />
                        <Area
                            type="monotone"
                            dataKey={dataKey}
                            stroke={color}
                            strokeWidth={2}
                            fill={`url(#grad-${dataKey})`}
                            dot={false}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export function TelemetryCharts({ samples, className }: TelemetryChartsProps) {
    return (
        <div className={className}>
            <MetricChart
                samples={samples}
                dataKey="cpu_percent"
                color="#22c55e"
                label="CPU Usage"
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                yAxisFormatter={(v) => `${v}%`}
            />
            <MetricChart
                samples={samples}
                dataKey="memory_bytes"
                color="#3b82f6"
                label="Memory"
                valueFormatter={(v) => formatBytes(v)}
                yAxisFormatter={(v) => formatBytes(v)}
            />
            <MetricChart
                samples={samples}
                dataKey="process_count"
                color="#f59e0b"
                label="Processes"
                valueFormatter={(v) => `${v}`}
            />
        </div>
    );
}
