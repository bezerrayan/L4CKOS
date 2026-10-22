import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { format, isValid, parse, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Clock3 } from "lucide-react";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminBatchesVisualPreview.css";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import {
  BATCH_TRANSITIONS,
  manufacturingEstimate,
  shippingEstimate,
  type BatchStatus,
} from "../../../shared/preorder";

type PreviewBatch = {
  id: number;
  name: string;
  status: BatchStatus;
  salesOpenAt: string | null;
  salesCloseAt: string | null;
  estimatedManufacturingStart: string | null;
  estimatedManufacturingEnd: string | null;
  estimatedShippingStart: string | null;
  estimatedShippingEnd: string | null;
  minimumQuantity: number;
  maximumQuantity: number | null;
  paidOrders: number;
  confirmedQuantity: number;
  confirmedItemValueCents: number;
  pendingOrders: number;
  pendingQuantity: number;
  minimumRemaining: number;
  products: Array<{ id: number; name: string; salesMode: "PREORDER" }>;
  groups: Array<{
    productId: number;
    productName: string;
    variantId: number | null;
    variantName: string | null;
    size: string | null;
    color: string | null;
    quantity: number;
    itemValueCents: number;
  }>;
};

const statusInfo: Record<BatchStatus, { label: string; tone: string }> = {
  DRAFT: { label: "Rascunho", tone: "draft" },
  OPEN: { label: "Pré-venda aberta", tone: "open" },
  CLOSED: { label: "Vendas encerradas", tone: "closed" },
  IN_PRODUCTION: { label: "Em produção", tone: "production" },
  RECEIVED: { label: "Recebido", tone: "received" },
  SHIPPING: { label: "Envios iniciados", tone: "shipping" },
  COMPLETED: { label: "Concluído", tone: "completed" },
  CANCELLED: { label: "Cancelado", tone: "cancelled" },
};

const transitionLabels: Record<BatchStatus, string> = {
  DRAFT: "Rascunho",
  OPEN: "Abrir pré-venda",
  CLOSED: "Encerrar pré-venda",
  IN_PRODUCTION: "Iniciar produção",
  RECEIVED: "Marcar recebido",
  SHIPPING: "Iniciar envios",
  COMPLETED: "Completar",
  CANCELLED: "Cancelar lote",
};

// Fictitious records shaped from productionBatches.list/detail only.
const batches: PreviewBatch[] = [
  {
    id: 31,
    name: "Camiseta Linha Noturna",
    status: "OPEN",
    salesOpenAt: "2026-10-12T12:00:00.000Z",
    salesCloseAt: "2026-10-30T02:59:00.000Z",
    estimatedManufacturingStart: "2026-11-05",
    estimatedManufacturingEnd: "2026-11-28",
    estimatedShippingStart: "2026-12-02T03:00:00.000Z",
    estimatedShippingEnd: "2026-12-09T02:59:00.000Z",
    minimumQuantity: 40,
    maximumQuantity: 100,
    paidOrders: 18,
    confirmedQuantity: 32,
    confirmedItemValueCents: 287680,
    pendingOrders: 4,
    pendingQuantity: 6,
    minimumRemaining: 8,
    products: [
      { id: 721, name: "Camiseta Linha Noturna — Preta", salesMode: "PREORDER" },
      { id: 722, name: "Camiseta Linha Noturna — Cinza", salesMode: "PREORDER" },
    ],
    groups: [
      { productId: 721, productName: "Camiseta Linha Noturna — Preta", variantId: 821, variantName: "Preta · P", size: "P", color: "Preta", quantity: 8, itemValueCents: 71920 },
      { productId: 721, productName: "Camiseta Linha Noturna — Preta", variantId: 822, variantName: "Preta · M", size: "M", color: "Preta", quantity: 12, itemValueCents: 107880 },
      { productId: 722, productName: "Camiseta Linha Noturna — Cinza", variantId: 823, variantName: "Cinza · M", size: "M", color: "Cinza", quantity: 7, itemValueCents: 62930 },
      { productId: 722, productName: "Camiseta Linha Noturna — Cinza", variantId: 824, variantName: "Cinza · G", size: "G", color: "Cinza", quantity: 5, itemValueCents: 44950 },
    ],
  },
  {
    id: 30,
    name: "Moletom Frequência",
    status: "IN_PRODUCTION",
    salesOpenAt: "2026-08-10T12:00:00.000Z",
    salesCloseAt: "2026-08-25T02:59:00.000Z",
    estimatedManufacturingStart: "2026-09-01",
    estimatedManufacturingEnd: "2026-10-15",
    estimatedShippingStart: "2026-10-20T03:00:00.000Z",
    estimatedShippingEnd: "2026-10-28T02:59:00.000Z",
    minimumQuantity: 30,
    maximumQuantity: null,
    paidOrders: 26,
    confirmedQuantity: 34,
    confirmedItemValueCents: 577660,
    pendingOrders: 2,
    pendingQuantity: 2,
    minimumRemaining: 0,
    products: [{ id: 719, name: "Moletom Frequência — Preto", salesMode: "PREORDER" }],
    groups: [
      { productId: 719, productName: "Moletom Frequência — Preto", variantId: 819, variantName: "Preto · M", size: "M", color: "Preto", quantity: 14, itemValueCents: 237860 },
      { productId: 719, productName: "Moletom Frequência — Preto", variantId: 820, variantName: "Preto · G", size: "G", color: "Preto", quantity: 20, itemValueCents: 339800 },
    ],
  },
  {
    id: 29,
    name: "Boné Sinal Aberto",
    status: "DRAFT",
    salesOpenAt: null,
    salesCloseAt: null,
    estimatedManufacturingStart: null,
    estimatedManufacturingEnd: null,
    estimatedShippingStart: null,
    estimatedShippingEnd: null,
    minimumQuantity: 25,
    maximumQuantity: 60,
    paidOrders: 0,
    confirmedQuantity: 0,
    confirmedItemValueCents: 0,
    pendingOrders: 0,
    pendingQuantity: 0,
    minimumRemaining: 25,
    products: [{ id: 718, name: "Boné Sinal Aberto", salesMode: "PREORDER" }],
    groups: [],
  },
  {
    id: 28,
    name: "Camiseta Frequência Zero",
    status: "CANCELLED",
    salesOpenAt: "2026-06-03T12:00:00.000Z",
    salesCloseAt: "2026-06-14T02:59:00.000Z",
    estimatedManufacturingStart: "2026-06-22",
    estimatedManufacturingEnd: "2026-07-12",
    estimatedShippingStart: "2026-07-15T03:00:00.000Z",
    estimatedShippingEnd: "2026-07-22T02:59:00.000Z",
    minimumQuantity: 35,
    maximumQuantity: 70,
    paidOrders: 11,
    confirmedQuantity: 15,
    confirmedItemValueCents: 134850,
    pendingOrders: 0,
    pendingQuantity: 0,
    minimumRemaining: 20,
    products: [{ id: 717, name: "Camiseta Frequência Zero — Branca", salesMode: "PREORDER" }],
    groups: [{ productId: 717, productName: "Camiseta Frequência Zero — Branca", variantId: 817, variantName: "Branca · M", size: "M", color: "Branca", quantity: 15, itemValueCents: 134850 }],
  },
];

const navGroups = [
  { heading: "Visão geral", items: ["Dashboard / KPIs"] },
  { heading: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { heading: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { heading: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

const initialForm = {
  name: "",
  salesOpenAt: "",
  salesCloseAt: "",
  estimatedShippingStart: "",
  estimatedShippingEnd: "",
  estimatedManufacturingStart: "",
  estimatedManufacturingEnd: "",
  minimumQuantity: "0",
  maximumQuantity: "",
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function utcDateTime(value: string | null) {
  if (!value) return "Não definido";
  return `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

function calendarDate(value: string | null) {
  if (!value) return "Não definido";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function parseCalendarValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value ? date : undefined;
}

function displayCalendarValue(value: string) {
  const date = parseCalendarValue(value);
  return date ? format(date, "dd/MM/yyyy") : "";
}

function fromDisplayDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return undefined;
  const date = parse(value, "dd/MM/yyyy", new Date(), { locale: ptBR });
  return isValid(date) && format(date, "dd/MM/yyyy") === value ? format(date, "yyyy-MM-dd") : undefined;
}

function datePart(value: string) {
  return value.slice(0, 10);
}

function timePart(value: string) {
  return value.length >= 16 ? value.slice(11, 16) : "00:00";
}

function joinDateTime(date: string, time: string) {
  return `${date}T${time}`;
}

function BatchDateField({
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(displayCalendarValue(datePart(value)));
  const [timeDraft, setTimeDraft] = useState(withTime ? timePart(value) : "00:00");
  const selectedDate = parseCalendarValue(datePart(value));
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? new Date());
  const selectedTime = withTime ? timePart(value) : "00:00";
  const selectedHour = selectedTime.slice(0, 2) || "00";
  const selectedMinute = selectedTime.slice(3, 5) || "00";
  const [hourDraft, setHourDraft] = useState(selectedHour);
  const [minuteDraft, setMinuteDraft] = useState(selectedMinute);
  const currentHour = /^\d{1,2}$/.test(hourDraft) && Number(hourDraft) <= 23 ? hourDraft.padStart(2, "0") : selectedHour;
  const currentMinute = /^\d{1,2}$/.test(minuteDraft) && Number(minuteDraft) <= 59 ? minuteDraft.padStart(2, "0") : selectedMinute;
  const currentTime = withTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft) ? timeDraft : `${currentHour}:${currentMinute}`;

  useEffect(() => {
    setDateDraft(displayCalendarValue(datePart(value)));
    if (withTime) {
      setTimeDraft(timePart(value));
      setHourDraft(timePart(value).slice(0, 2));
      setMinuteDraft(timePart(value).slice(3, 5));
    }
    if (selectedDate) setVisibleMonth(selectedDate);
  }, [value, withTime]);

  const acceptDate = (dateValue: string) => {
    const validDate = fromDisplayDate(dateValue);
    if (!validDate) return;
    onChange(withTime ? joinDateTime(validDate, currentTime) : validDate);
  };

  const acceptTime = (timeValue: string) => {
    setTimeDraft(timeValue);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) return;
    if (selectedDate) onChange(joinDateTime(datePart(value), timeValue));
  };

  const setHour = (hour: string) => {
    const nextTime = `${hour}:${currentMinute}`;
    setTimeDraft(nextTime);
    if (selectedDate) onChange(joinDateTime(datePart(value), nextTime));
  };

  const setMinute = (minute: string) => {
    const nextTime = `${currentHour}:${minute}`;
    setTimeDraft(nextTime);
    if (selectedDate) onChange(joinDateTime(datePart(value), nextTime));
  };

  return <div className={`batches-date-control${withTime ? " has-time" : ""}`} data-preview-date-field={name}>
    <div className="batches-date-input-row">
      <label className="batches-date-part"><span>Data · {zone}</span><input
        type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA"
        aria-label={`${label}, data em ${zone}`} value={dateDraft}
        onChange={event => { setDateDraft(event.target.value); acceptDate(event.target.value); }}
        onBlur={() => { if (!fromDisplayDate(dateDraft)) setDateDraft(displayCalendarValue(datePart(value))); }}
        data-date-input={name}
      /></label>
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild><button type="button" className="batches-date-trigger" aria-label={`Abrir calendário: ${label}`} aria-haspopup="dialog" data-calendar-trigger={name}><CalendarDays size={18} aria-hidden="true" /></button></PopoverTrigger>
        <PopoverContent className="batches-date-popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Calendário de ${label}`}>
          <div className="batches-popover-heading"><strong>Selecionar data</strong><span>{zone}</span></div>
          <Calendar
            mode="single" locale={ptBR} selected={selectedDate}
            month={visibleMonth} onMonthChange={setVisibleMonth}
            onSelect={date => {
              if (!date) return;
              const isoDay = format(date, "yyyy-MM-dd");
              setDateDraft(format(date, "dd/MM/yyyy"));
              onChange(withTime ? joinDateTime(isoDay, currentTime) : isoDay);
              setCalendarOpen(false);
            }}
            className="batches-calendar"
            aria-label={`Dias do mês para ${label}`}
          />
          <p className="batches-calendar-hint">Use as setas para navegar pelos dias e Enter para selecionar.</p>
        </PopoverContent>
      </Popover>
      {withTime ? <>
        <label className="batches-time-part"><span>Hora · UTC</span><input type="text" inputMode="numeric" placeholder="HH:mm" aria-label={`${label}, horário UTC`} value={timeDraft} onChange={event => acceptTime(event.target.value)} onBlur={() => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft)) setTimeDraft(selectedTime); }} data-time-input={name} /></label>
        <Popover open={timeOpen} onOpenChange={setTimeOpen}>
          <PopoverTrigger asChild><button type="button" className="batches-date-trigger batches-time-trigger" aria-label={`Selecionar hora: ${label}`} aria-haspopup="dialog" data-time-trigger={name}><Clock3 size={18} aria-hidden="true" /></button></PopoverTrigger>
          <PopoverContent className="batches-time-popover" align="end" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Seletor de horário de ${label}`}>
            <div className="batches-popover-heading"><strong>Horário</strong><span>UTC · precisão de minuto</span></div>
            <div className="batches-time-selects">
              <label><span>Hora</span><input type="text" inputMode="numeric" maxLength={2} value={hourDraft} aria-label="Hora UTC" aria-valuemin={0} aria-valuemax={23} aria-valuenow={Number(selectedHour)} role="spinbutton" data-hour-control={name} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setHourDraft(next); if (next !== "" && Number(next) <= 23) setHour(next.padStart(2, "0")); }} onBlur={() => { const normalized = /^\d{1,2}$/.test(hourDraft) && Number(hourDraft) <= 23 ? hourDraft.padStart(2, "0") : selectedHour; setHourDraft(normalized); setHour(normalized); }} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(selectedHour) + (event.key === "ArrowUp" ? 1 : -1) + 24) % 24; setHour(String(next).padStart(2, "0")); setHourDraft(String(next).padStart(2, "0")); }} /></label>
              <span className="batches-time-separator" aria-hidden="true">:</span>
              <label><span>Minuto</span><input type="text" inputMode="numeric" maxLength={2} value={minuteDraft} aria-label="Minuto UTC" aria-valuemin={0} aria-valuemax={59} aria-valuenow={Number(selectedMinute)} role="spinbutton" data-minute-control={name} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setMinuteDraft(next); if (next !== "" && Number(next) <= 59) setMinute(next.padStart(2, "0")); }} onBlur={() => { const normalized = /^\d{1,2}$/.test(minuteDraft) && Number(minuteDraft) <= 59 ? minuteDraft.padStart(2, "0") : selectedMinute; setMinuteDraft(normalized); setMinute(normalized); }} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(selectedMinute) + (event.key === "ArrowUp" ? 1 : -1) + 60) % 60; setMinute(String(next).padStart(2, "0")); setMinuteDraft(String(next).padStart(2, "0")); }} /></label>
            </div>
            <p className="batches-calendar-hint">O valor mantém a data e a hora UTC informadas.</p>
          </PopoverContent>
        </Popover>
      </> : null}
    </div>
    <span className="batches-date-zone-note">{withTime ? "Data e hora em UTC" : "Data civil de Brasília"}</span>
  </div>;
}

export default function AdminBatchesVisualPreview() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const mobile = useIsMobile(900);
  const menuRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const batchTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const selected = batches.find(batch => batch.id === selectedId) ?? null;

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>("button[aria-current=page]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
      if (event.key === "Tab" && menuRef.current) {
        const focusables = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, mobile]);

  const updateForm = (key: keyof typeof initialForm) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm(current => ({ ...current, [key]: event.target.value }));
  };

  const openCreate = () => {
    setSelectedId(null);
    setEditingBatchId(null);
    setForm(initialForm);
    setCreating(true);
  };

  const openEdit = (batch: PreviewBatch) => {
    const asUtcInput = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";
    setEditingBatchId(batch.id);
    setForm({
      name: batch.name,
      salesOpenAt: asUtcInput(batch.salesOpenAt),
      salesCloseAt: asUtcInput(batch.salesCloseAt),
      estimatedShippingStart: asUtcInput(batch.estimatedShippingStart),
      estimatedShippingEnd: asUtcInput(batch.estimatedShippingEnd),
      estimatedManufacturingStart: batch.estimatedManufacturingStart ?? "",
      estimatedManufacturingEnd: batch.estimatedManufacturingEnd ?? "",
      minimumQuantity: String(batch.minimumQuantity),
      maximumQuantity: batch.maximumQuantity === null ? "" : String(batch.maximumQuantity),
    });
    setCreating(true);
  };

  const selectBatch = (batch: PreviewBatch) => {
    setSelectedId(batch.id);
    setCreating(false);
  };

  return <div className="l4-orders-preview l4-batches-visual-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
    <aside ref={menuRef} id="batches-preview-navigation" className={`orders-sidebar${menuOpen ? " is-open" : ""}`} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA VISUAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item === "Lotes / Pré-venda" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>

    <main className="orders-main-column">
      <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="batches-preview-navigation" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
      <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Prévia de Lotes / Pré-venda</span><span className="orders-preview-fake-label">AMBIENTE LOCAL · DADOS FICTÍCIOS</span></div>
      <header className="orders-preview-heading batches-page-heading">
        <div><p className="orders-preview-eyebrow">Operação · Produção por demanda</p><h1>Lotes / Pré-venda</h1><p>Consulte períodos, demanda confirmada e cronogramas estimados.</p></div>
        {!creating ? <button type="button" className="batches-primary-action" onClick={openCreate}>Novo lote</button> : null}
      </header>

      {creating ? <section className="batches-create" aria-labelledby="batches-create-title">
        <div className="batches-section-heading"><div><h2 id="batches-create-title">{editingBatchId ? `Editar lote #${editingBatchId}` : "Novo lote"}</h2><p>{editingBatchId ? "Edite os campos disponíveis. O salvamento está desativado nesta prévia." : "Preencha os campos do cadastro. O salvamento está desativado nesta prévia."}</p></div><button type="button" className="batches-secondary-action" onClick={() => { setCreating(false); setEditingBatchId(null); }}>Voltar à visão geral</button></div>
        <form onSubmit={event => event.preventDefault()}>
          <section className="batches-form-section"><h3>Informações gerais</h3><label className="batches-field batches-field-wide">Nome do lote<input value={form.name} onChange={updateForm("name")} maxLength={255} placeholder="Ex.: Nome do lançamento" /></label></section>
          <section className="batches-form-section"><h3>Período de vendas</h3><div className="batches-form-grid"><div className="batches-field"><span>Abertura das vendas</span><BatchDateField name="salesOpenAt" label="Abertura das vendas" value={form.salesOpenAt} onChange={value => setForm(current => ({ ...current, salesOpenAt: value }))} zone="UTC" withTime /></div><div className="batches-field"><span>Encerramento das vendas</span><BatchDateField name="salesCloseAt" label="Encerramento das vendas" value={form.salesCloseAt} onChange={value => setForm(current => ({ ...current, salesCloseAt: value }))} zone="UTC" withTime /></div></div><p className="batches-field-note">A data e a hora são informadas em UTC; o equivalente em Brasília corresponde a UTC−3. O valor digitado e o selecionado no calendário representam o mesmo instante.</p></section>
          <section className="batches-form-section"><h3>Fabricação</h3><div className="batches-form-grid"><div className="batches-field"><span>Início estimado</span><BatchDateField name="estimatedManufacturingStart" label="Início estimado da fabricação" value={form.estimatedManufacturingStart} onChange={value => setForm(current => ({ ...current, estimatedManufacturingStart: value }))} zone="Brasília" /></div><div className="batches-field"><span>Término estimado</span><BatchDateField name="estimatedManufacturingEnd" label="Término estimado da fabricação" value={form.estimatedManufacturingEnd} onChange={value => setForm(current => ({ ...current, estimatedManufacturingEnd: value }))} zone="Brasília" /></div></div><p className="batches-field-note">Datas civis de Brasília, cadastradas conforme o compromisso do fornecedor. Novos lotes exigem início e término antes de abrir vendas.</p></section>
          <section className="batches-form-section"><h3>Postagem estimada</h3><div className="batches-form-grid"><div className="batches-field"><span>Início da janela</span><BatchDateField name="estimatedShippingStart" label="Início da janela de postagem" value={form.estimatedShippingStart} onChange={value => setForm(current => ({ ...current, estimatedShippingStart: value }))} zone="UTC" withTime /></div><div className="batches-field"><span>Fim da janela</span><BatchDateField name="estimatedShippingEnd" label="Fim da janela de postagem" value={form.estimatedShippingEnd} onChange={value => setForm(current => ({ ...current, estimatedShippingEnd: value }))} zone="UTC" withTime /></div></div><p className="batches-field-note">A postagem não inclui fabricação ou transporte e não representa uma data garantida de entrega. A postagem não pode anteceder o término da fabricação.</p></section>
          <section className="batches-form-section"><h3>Limites de quantidade</h3><div className="batches-form-grid batches-quantity-grid"><label className="batches-field">Mínimo informativo<input type="number" min="0" step="1" value={form.minimumQuantity} onChange={updateForm("minimumQuantity")} /></label><label className="batches-field">Máximo opcional<input type="number" min="1" step="1" placeholder="Sem limite" value={form.maximumQuantity} onChange={updateForm("maximumQuantity")} /></label></div></section>
          <div className="batches-form-footer"><p>Alterações em um lote atualizam o catálogo, mas não substituem as condições registradas em pedidos anteriores.</p><button type="button" disabled aria-describedby="batches-save-note">{editingBatchId ? "Salvar alterações" : "Criar lote"}</button><span id="batches-save-note">Gravação indisponível na prévia local.</span></div>
        </form>
      </section> : <div className={`batches-workspace${selected ? " has-selection" : ""}`}>
        <section className="batches-list-panel" aria-labelledby="batches-list-title">
          <div className="batches-section-heading"><div><h2 id="batches-list-title">Lançamentos</h2><p>{batches.length} lotes de demonstração</p></div></div>
          <div className="batches-list">
            {batches.map(batch => <button key={batch.id} ref={node => { batchTriggerRefs.current[batch.id] = node; }} type="button" className="batches-list-item" aria-pressed={selectedId === batch.id} onClick={() => selectBatch(batch)}>
              <span className="batches-list-title"><strong>{batch.name}</strong><small>#{batch.id}</small></span>
              <span className={`batches-status batches-status-${statusInfo[batch.status].tone}`}><i aria-hidden="true" />{statusInfo[batch.status].label}</span>
              <span className="batches-list-period">{batch.salesOpenAt || batch.estimatedManufacturingStart ? `Vendas ${batch.salesOpenAt ? utcDateTime(batch.salesOpenAt) : "não definidas"}` : "Período ainda não definido"}</span>
              <span className="batches-list-summary">{batch.confirmedQuantity} peças confirmadas <span aria-hidden="true">·</span> {batch.products.length} {batch.products.length === 1 ? "produto" : "produtos"}</span>
            </button>)}
          </div>
          <p className="batches-preview-caption">Registros inteiramente fictícios. Selecionar um lote exibe os campos disponíveis no acompanhamento administrativo.</p>
        </section>

        <section className="batches-detail-panel" aria-live="polite" aria-label="Detalhes do lote selecionado">
          {!selected ? <div className="batches-empty"><span>DETALHES DO LOTE</span><p>Selecione um lançamento para consultar o período, os produtos e o acompanhamento operacional.</p></div> : <BatchDetail batch={selected} onEdit={openEdit} />}
        </section>
      </div>}
    </main>
  </div>;
}

function BatchDetail({ batch, onEdit }: { batch: PreviewBatch; onEdit: (batch: PreviewBatch) => void }) {
  const transitionList = BATCH_TRANSITIONS[batch.status];
  const productionProgress = Math.min(batch.confirmedQuantity, batch.minimumQuantity);
  const progressMax = Math.max(1, batch.minimumQuantity);
  const perProduct = batch.products.map(product => ({
    ...product,
    confirmed: batch.groups.filter(group => group.productId === product.id).reduce((total, group) => total + group.quantity, 0),
  }));

  return <div className="batches-detail-content">
    <header className="batches-detail-header"><div><span className="batches-detail-kicker">LOTE #{batch.id}</span><h2>{batch.name}</h2></div><div className="batches-detail-header-actions"><span className={`batches-status batches-status-${statusInfo[batch.status].tone}`}><i aria-hidden="true" />{statusInfo[batch.status].label}</span><button type="button" className="batches-secondary-action" onClick={() => onEdit(batch)}>Editar</button></div></header>

    <section className="batches-info-section"><h3>Identificação e situação</h3><dl className="batches-facts"><div><dt>Status atual</dt><dd><span className={`batches-status-text batches-status-text-${statusInfo[batch.status].tone}`}>{statusInfo[batch.status].label}</span></dd></div><div><dt>Identificador</dt><dd>#{batch.id}</dd></div><div><dt>Produtos associados</dt><dd>{batch.products.length}</dd></div></dl></section>

    <div className="batches-schedule-grid">
      <section className="batches-info-section"><h3>Período de vendas</h3><dl className="batches-facts"><div><dt>Abertura <span>UTC</span></dt><dd>{utcDateTime(batch.salesOpenAt)}</dd></div><div><dt>Encerramento <span>UTC</span></dt><dd>{utcDateTime(batch.salesCloseAt)}</dd></div></dl><p className="batches-small-note">Horário de Brasília: UTC−3.</p></section>
      <section className="batches-info-section"><h3>Cronograma de fabricação</h3><dl className="batches-facts"><div><dt>Início <span>Brasília</span></dt><dd>{calendarDate(batch.estimatedManufacturingStart)}</dd></div><div><dt>Término <span>Brasília</span></dt><dd>{calendarDate(batch.estimatedManufacturingEnd)}</dd></div></dl><p className="batches-small-note">{manufacturingEstimate(batch.estimatedManufacturingStart, batch.estimatedManufacturingEnd)}</p></section>
      <section className="batches-info-section"><h3>Previsão de postagem</h3><dl className="batches-facts"><div><dt>Início <span>UTC</span></dt><dd>{utcDateTime(batch.estimatedShippingStart)}</dd></div><div><dt>Fim <span>UTC</span></dt><dd>{utcDateTime(batch.estimatedShippingEnd)}</dd></div></dl><p className="batches-small-note">{shippingEstimate(batch.estimatedShippingStart, batch.estimatedShippingEnd)} A postagem não equivale à entrega.</p></section>
    </div>

    <section className="batches-info-section batches-quantity-section"><div className="batches-section-heading"><div><h3>Produtos e quantidades associadas</h3><p>Ordem de produção formada por itens com pagamento confirmado.</p></div></div>
      <div className="batches-product-lines">{perProduct.map(product => <div className="batches-product-line" key={product.id}><span><strong>{product.name}</strong><small>Modo de venda: {product.salesMode}</small></span><span><strong>{product.confirmed}</strong><small>peças confirmadas</small></span></div>)}</div>
      {["DRAFT", "OPEN", "CLOSED"].includes(batch.status) ? <div className="batches-association-action"><p>Produtos selecionados usam PREORDER. Produtos removidos voltam a STOCK. Compras anteriores preservam seus snapshots.</p><button type="button" disabled>Editar associações e modo de venda</button><small>Ação desativada nesta prévia.</small></div> : null}
      {batch.groups.length ? <div className="batches-production-table-wrap"><table className="batches-production-table"><thead><tr><th scope="col">Produto</th><th scope="col">Variante</th><th scope="col">Tamanho</th><th scope="col">Cor</th><th scope="col">Peças</th></tr></thead><tbody>{batch.groups.map((group, index) => <tr key={`${group.productId}-${group.variantId}-${index}`}><td>{group.productName}</td><td>{group.variantName || "—"}</td><td>{group.size || "—"}</td><td>{group.color || "—"}</td><td>{group.quantity}</td></tr>)}</tbody><tfoot><tr><th colSpan={4}>Total confirmado</th><th>{batch.confirmedQuantity}</th></tr></tfoot></table></div> : <p className="batches-empty-inline">Ainda não há itens confirmados para a ordem de produção deste lote.</p>}
    </section>

    <section className="batches-info-section batches-operation-section"><h3>Acompanhamento operacional</h3><div className="batches-operation-metrics"><div><strong>{batch.paidOrders}</strong><span>Pedidos pagos confirmados</span></div><div><strong>{batch.confirmedQuantity}</strong><span>Peças confirmadas</span></div><div><strong>{money(batch.confirmedItemValueCents)}</strong><span>Valor bruto dos itens confirmados*</span></div></div>
      <div className="batches-minimum"><div><span>Mínimo informativo</span><strong>{batch.minimumQuantity} peças</strong></div><div><span>Faltam para o mínimo</span><strong>{batch.minimumRemaining} peças</strong></div><progress aria-label="Peças confirmadas em relação ao mínimo informativo" value={productionProgress} max={progressMax} /></div>
      <p className="batches-operational-note">Aguardando pagamento: {batch.pendingOrders} pedidos / {batch.pendingQuantity} peças. Capacidade comprometida: {batch.confirmedQuantity + batch.pendingQuantity} / {batch.maximumQuantity ?? "sem limite"}. Somente pagamentos confirmados entram na ordem de produção. Pedidos abandonados exigem conciliação e cancelamento administrativo.</p>
      <p className="batches-operational-note">*Valor bruto dos itens, antes de desconto e frete. O total cobrado do pedido segue o checkout.</p>
      {batch.status === "CANCELLED" ? <p className="batches-cancelled-note" role="note">Lote cancelado. Pedidos pagos exigem resolução individual; não há reembolso automático.</p> : null}
      <div className="batches-preview-actions"><div><h4>Transições de status existentes</h4><p>Representação desativada nesta prévia.</p></div>{transitionList.length ? <div className="batches-transition-buttons">{transitionList.map(status => <button key={status} type="button" disabled className={status === "CANCELLED" ? "is-danger" : ""}>{transitionLabels[status]}</button>)}</div> : <p>Nenhuma transição disponível para este estado.</p>}</div>
    </section>
  </div>;
}
