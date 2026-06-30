import { useState, useMemo, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MaskedSlot } from "@/components/masked-input"
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate() }
function getFirstDayOfWeek(year: number, month: number) { const d = new Date(year, month, 1).getDay(); return d === 0 ? 6 : d - 1 }
function formatDate(year: number, month: number, day: number) { return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` }

interface DateTimePickerProps { value?: string; onChange?: (iso: string) => void; placeholder?: string }

export function DateTimePicker({ value, onChange, placeholder = "Pick a date" }: DateTimePickerProps) {
  const parsed = value ? new Date(value + (value.includes("T") ? "" : "T00:00:00")) : null
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth())
  const [selectedDay, setSelectedDay] = useState(parsed?.getDate() ?? null)
  const [hours, setHours] = useState(parsed ? String(parsed.getHours()).padStart(2, "0") : "")
  const [minutes, setMinutes] = useState(parsed ? String(parsed.getMinutes()).padStart(2, "0") : "")
  const [seconds, setSeconds] = useState(parsed ? String(parsed.getSeconds()).padStart(2, "0") : "")
  const hoursRef = useRef<HTMLInputElement>(null)
  const minutesRef = useRef<HTMLInputElement>(null)
  const secondsRef = useRef<HTMLInputElement>(null)

  const today = new Date()
  const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate())

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth)
    const firstDow = getFirstDayOfWeek(viewYear, viewMonth)
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7
    const cells: Array<{ day: number; dateStr: string; outside: boolean }> = []
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstDow + 1
      const date = new Date(viewYear, viewMonth, dayNum)
      cells.push({
        day: date.getDate(),
        dateStr: formatDate(date.getFullYear(), date.getMonth(), date.getDate()),
        outside: date.getMonth() !== viewMonth || date.getFullYear() !== viewYear,
      })
    }
    return cells
  }, [viewYear, viewMonth])

  const emitValue = useCallback((day: number | null, h: string, m: string, s: string) => {
    if (day === null) return
    const hh = h.length > 0 ? h.padStart(2, "0") : "00"
    const mm = m.length > 0 ? m.padStart(2, "0") : "00"
    const ss = s.length > 0 ? s.padStart(2, "0") : "00"
    onChange?.(`${formatDate(viewYear, viewMonth, day)}T${hh}:${mm}:${ss}`)
  }, [viewYear, viewMonth, onChange])

  const selectDay = useCallback((day: number) => {
    setSelectedDay(day)
    emitValue(day, hours, minutes, seconds)
  }, [emitValue, hours, minutes, seconds])

  const handleHoursChange = useCallback((v: string) => { setHours(v); if (selectedDay !== null) emitValue(selectedDay, v, minutes, seconds) }, [emitValue, minutes, seconds, selectedDay])
  const handleMinutesChange = useCallback((v: string) => { setMinutes(v); if (selectedDay !== null) emitValue(selectedDay, hours, v, seconds) }, [emitValue, hours, seconds, selectedDay])
  const handleSecondsChange = useCallback((v: string) => { setSeconds(v); if (selectedDay !== null) emitValue(selectedDay, hours, minutes, v) }, [emitValue, hours, minutes, selectedDay])

  const displayText = parsed
    ? `${parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} at ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}:${String(parsed.getSeconds()).padStart(2, "0")}`
    : placeholder
  const currentYear = today.getFullYear()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")} />}>
          <CalendarIcon className="mr-2 size-4 shrink-0" />{displayText}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 w-[284px]">
          <div className="flex items-center gap-1.5 mb-3">
            <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) } else setViewMonth((m) => m - 1) }}>
              <ChevronLeft className="size-4" />
            </Button>
            <Select value={String(viewMonth)} onValueChange={(v) => setViewMonth(parseInt(v))} items={MONTHS.map((m, i) => ({ value: String(i), label: m }))}>
              <SelectTrigger className="flex-1 min-w-0 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(viewYear)} onValueChange={(v) => setViewYear(parseInt(v))} items={Array.from({ length: 21 }, (_, i) => ({ value: String(currentYear - 5 + i), label: String(currentYear - 5 + i) }))}>
              <SelectTrigger className="w-14 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 21 }, (_, i) => currentYear - 5 + i).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) } else setViewMonth((m) => m + 1) }}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0 mb-1">
            {DAYS.map((d) => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0">
            {calendarDays.map((cell, i) => {
              const isToday = cell.dateStr === todayStr
              const isSelected = cell.day === selectedDay && !cell.outside && viewMonth === parsed?.getMonth() && viewYear === parsed?.getFullYear()
              return (
                <button key={i} type="button" className={cn("h-9 w-9 rounded-xl text-sm flex items-center justify-center transition-colors", isSelected && "bg-foreground text-background", !isSelected && isToday && "border border-foreground/30", !isSelected && !isToday && !cell.outside && "hover:bg-muted hover:text-foreground", cell.outside && "text-muted-foreground/30")} onClick={() => { if (!cell.outside) selectDay(cell.day) }}>
                  {cell.day}
                </button>
              )
            })}
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-center">
            <MaskedSlot
              ref={hoursRef}
              digits={2}
              max={23}
              value={hours}
              onChange={handleHoursChange}
              onBackspaceEmpty={() => {}}
              onFull={() => minutesRef.current?.focus()}
              placeholder="HH"
            />
            <span className="text-sm font-mono text-muted-foreground select-none mx-0.5">:</span>
            <MaskedSlot
              ref={minutesRef}
              digits={2}
              max={59}
              value={minutes}
              onChange={handleMinutesChange}
              onBackspaceEmpty={() => hoursRef.current?.focus()}
              onFull={() => secondsRef.current?.focus()}
              placeholder="mm"
            />
            <span className="text-sm font-mono text-muted-foreground select-none mx-0.5">:</span>
            <MaskedSlot
              ref={secondsRef}
              digits={2}
              max={59}
              value={seconds}
              onChange={handleSecondsChange}
              onBackspaceEmpty={() => minutesRef.current?.focus()}
              onFull={() => {}}
              placeholder="ss"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
