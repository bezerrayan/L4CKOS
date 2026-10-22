import { useEffect, useState } from "react";
import { format, isValid, parse, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Clock3 } from "lucide-react";
import { Calendar } from "../../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const day = parseISO(value);
  return isValid(day) && format(day, "yyyy-MM-dd") === value ? day : undefined;
}
function displayDay(value: string) {
  const day = parseDay(value);
  return day ? format(day, "dd/MM/yyyy") : "";
}
function fromDisplay(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return undefined;
  const day = parse(value, "dd/MM/yyyy", new Date(), { locale: ptBR });
  return isValid(day) && format(day, "dd/MM/yyyy") === value ? format(day, "yyyy-MM-dd") : undefined;
}

export function AdminBatchDateField({
  name,
  label,
  value,
  onChange,
  zone,
  withTime = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  zone: "UTC" | "Brasília";
  withTime?: boolean;
}) {
  const dayPart = value.slice(0, 10);
  const timePart = withTime && value.length >= 16 ? value.slice(11, 16) : "00:00";
  const selectedDay = parseDay(dayPart);
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(displayDay(dayPart));
  const [timeDraft, setTimeDraft] = useState(timePart);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDay ?? new Date());
  const [hourDraft, setHourDraft] = useState(timePart.slice(0, 2));
  const [minuteDraft, setMinuteDraft] = useState(timePart.slice(3, 5));
  const validHour = /^\d{1,2}$/.test(hourDraft) && Number(hourDraft) <= 23 ? hourDraft.padStart(2, "0") : timePart.slice(0, 2);
  const validMinute = /^\d{1,2}$/.test(minuteDraft) && Number(minuteDraft) <= 59 ? minuteDraft.padStart(2, "0") : timePart.slice(3, 5);
  const chosenTime = withTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft) ? timeDraft : `${validHour}:${validMinute}`;

  useEffect(() => {
    setDateDraft(displayDay(value.slice(0, 10)));
    if (withTime) {
      const nextTime = value.length >= 16 ? value.slice(11, 16) : "00:00";
      setTimeDraft(nextTime);
      setHourDraft(nextTime.slice(0, 2));
      setMinuteDraft(nextTime.slice(3, 5));
    }
    const nextDay = parseDay(value.slice(0, 10));
    if (nextDay) setVisibleMonth(nextDay);
  }, [value, withTime]);

  const commitDate = (display: string) => {
    const day = fromDisplay(display);
    if (day) onChange(withTime ? `${day}T${chosenTime}` : day);
  };
  const commitTime = (next: string) => {
    setTimeDraft(next);
    if (selectedDay && /^([01]\d|2[0-3]):[0-5]\d$/.test(next)) onChange(`${dayPart}T${next}`);
  };

  return (
    <div className={`admin-batch-date${withTime ? " has-time" : ""}`}>
      <div className="admin-batch-date__row">
        <label className="admin-batch-date__part">
          <span>Data · {zone}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="DD/MM/AAAA"
            aria-label={`${label}, data em ${zone}`}
            value={dateDraft}
            onChange={event => { setDateDraft(event.target.value); commitDate(event.target.value); }}
            onBlur={() => { if (!fromDisplay(dateDraft)) setDateDraft(displayDay(dayPart)); }}
          />
        </label>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="admin-batch-date__trigger" aria-label={`Abrir calendário: ${label}`} aria-haspopup="dialog">
              <CalendarDays size={18} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="admin-batch-date__popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Calendário de ${label}`}>
            <div className="admin-batch-date__popover-heading"><strong>Selecionar data</strong><span>{zone}</span></div>
            <Calendar
              mode="single"
              locale={ptBR}
              selected={selectedDay}
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              onSelect={date => {
                if (!date) return;
                const day = format(date, "yyyy-MM-dd");
                setDateDraft(format(date, "dd/MM/yyyy"));
                onChange(withTime ? `${day}T${chosenTime}` : day);
                setDateOpen(false);
              }}
              className="admin-batch-calendar"
              aria-label={`Dias do mês para ${label}`}
            />
            <p className="admin-batch-date__hint">Use as setas para navegar e Enter para selecionar.</p>
          </PopoverContent>
        </Popover>
        {withTime ? <>
          <label className="admin-batch-date__part admin-batch-date__time-part">
            <span>Hora · UTC</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="HH:mm"
              aria-label={`${label}, horário UTC`}
              value={timeDraft}
              onChange={event => commitTime(event.target.value)}
              onBlur={() => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft)) setTimeDraft(timePart); }}
            />
          </label>
          <Popover open={timeOpen} onOpenChange={setTimeOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="admin-batch-date__trigger admin-batch-date__time-trigger" aria-label={`Selecionar hora: ${label}`} aria-haspopup="dialog">
                <Clock3 size={18} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="admin-batch-date__popover admin-batch-date__time-popover" align="end" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Seletor de horário de ${label}`}>
              <div className="admin-batch-date__popover-heading"><strong>Horário</strong><span>UTC · precisão de minuto</span></div>
              <div className="admin-batch-time-grid">
                <label><span>Hora</span><input type="text" inputMode="numeric" maxLength={2} role="spinbutton" aria-label="Hora UTC" aria-valuemin={0} aria-valuemax={23} aria-valuenow={Number(timePart.slice(0, 2))} value={hourDraft} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setHourDraft(next); if (next && Number(next) <= 23) { const time = `${next.padStart(2, "0")}:${validMinute}`; setTimeDraft(time); if (selectedDay) onChange(`${dayPart}T${time}`); } }} onBlur={() => { const hour = /^\d{1,2}$/.test(hourDraft) && Number(hourDraft) <= 23 ? hourDraft.padStart(2, "0") : timePart.slice(0, 2); setHourDraft(hour); if (selectedDay) onChange(`${dayPart}T${hour}:${validMinute}`); }} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(timePart.slice(0, 2)) + (event.key === "ArrowUp" ? 1 : 23)) % 24; const hour = String(next).padStart(2, "0"); setHourDraft(hour); const time = `${hour}:${validMinute}`; setTimeDraft(time); if (selectedDay) onChange(`${dayPart}T${time}`); }} /></label>
                <span aria-hidden="true">:</span>
                <label><span>Minuto</span><input type="text" inputMode="numeric" maxLength={2} role="spinbutton" aria-label="Minuto UTC" aria-valuemin={0} aria-valuemax={59} aria-valuenow={Number(timePart.slice(3, 5))} value={minuteDraft} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setMinuteDraft(next); if (next && Number(next) <= 59) { const time = `${validHour}:${next.padStart(2, "0")}`; setTimeDraft(time); if (selectedDay) onChange(`${dayPart}T${time}`); } }} onBlur={() => { const minute = /^\d{1,2}$/.test(minuteDraft) && Number(minuteDraft) <= 59 ? minuteDraft.padStart(2, "0") : timePart.slice(3, 5); setMinuteDraft(minute); if (selectedDay) onChange(`${dayPart}T${validHour}:${minute}`); }} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(timePart.slice(3, 5)) + (event.key === "ArrowUp" ? 1 : 59)) % 60; const minute = String(next).padStart(2, "0"); setMinuteDraft(minute); const time = `${validHour}:${minute}`; setTimeDraft(time); if (selectedDay) onChange(`${dayPart}T${time}`); }} /></label>
              </div>
              <p className="admin-batch-date__hint">A hora mantém o instante UTC informado.</p>
            </PopoverContent>
          </Popover>
        </> : null}
      </div>
      <span className="admin-batch-date__zone-note">{withTime ? "Data e hora em UTC" : "Data civil de Brasília"}</span>
    </div>
  );
}
