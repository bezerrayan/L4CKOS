import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Eye, Menu, Pencil, Plus, Tag, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { getCouponStatus, formatCouponValue, type CouponAdminView } from "../components/admin/coupons/AdminCouponsUI";
import { AdminCouponsPanel } from "../components/admin/coupons/AdminCouponsPanel";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminCouponsVisualPreview.css";

type Coupon = Omit<CouponAdminView, "id" | "code" | "type" | "value" | "maxUses" | "usedCount" | "startsAt" | "expiresAt" | "isActive" | "createdAt"> & {
  id: number;
  code: string;
  type: "percent" | "fixed";
  value: number;
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
};
type CouponDraft = Omit<Coupon, "id" | "createdAt">;
type PageMode = "list" | "details" | "create" | "edit";
type Filter = "all" | "active" | "inactive" | "expired" | "future" | "exhausted";

const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];
const nowSeed = Date.now();
const utcRelative = (days: number, hour = 12) => {
  const value = new Date(nowSeed + days * 86_400_000);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
};
const initialCoupons: Coupon[] = [
  { id: 318, code: "CLA14BIS15", type: "percent", value: 15, maxUses: 100, usedCount: 82, startsAt: utcRelative(-14), expiresAt: utcRelative(12), isActive: true, createdAt: utcRelative(-30) },
  { id: 317, code: "L4CORE25", type: "fixed", value: 25, maxUses: null, usedCount: 46, startsAt: null, expiresAt: null, isActive: true, createdAt: utcRelative(-20) },
  { id: 316, code: "BEMVINDO10", type: "percent", value: 10, maxUses: 500, usedCount: 124, startsAt: utcRelative(-90), expiresAt: utcRelative(30), isActive: false, createdAt: utcRelative(-90) },
  { id: 315, code: "NOITES20", type: "percent", value: 20, maxUses: 80, usedCount: 31, startsAt: utcRelative(-35), expiresAt: utcRelative(-4), isActive: true, createdAt: utcRelative(-45) },
  { id: 314, code: "PREVENDA12", type: "percent", value: 12, maxUses: 250, usedCount: 0, startsAt: utcRelative(6), expiresAt: utcRelative(26), isActive: true, createdAt: utcRelative(-3) },
  { id: 313, code: "DROPESGOTADO", type: "fixed", value: 30, maxUses: 10, usedCount: 10, startsAt: utcRelative(-15), expiresAt: utcRelative(15), isActive: true, createdAt: utcRelative(-16) },
];
const emptyDraft = (): CouponDraft => ({ code: "", type: "percent", value: 10, maxUses: null, usedCount: 0, startsAt: null, expiresAt: null, isActive: true });
const filterLabels: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos" }, { key: "active", label: "Ativos" }, { key: "inactive", label: "Inativos" },
  { key: "expired", label: "Expirados" }, { key: "future", label: "Agendados" }, { key: "exhausted", label: "Esgotados" },
];

function statusFor(coupon: Coupon) {
  const status = getCouponStatus(coupon);
  if (status === "inactive") return { key: status, label: "Inativo" };
  if (status === "expired") return { key: status, label: "Expirado" };
  if (status === "future") return { key: status, label: "Agendado" };
  if (status === "limitReached") return { key: "exhausted", label: "Limite atingido" };
  return { key: "active", label: "Ativo" };
}
function formatUtc(value: string | Date | null | undefined, withTime = true) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data inválida";
  return `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}), timeZone: "UTC" }).format(date)}${withTime ? " UTC" : ""}`;
}
function dateValue(value: string | Date | null | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}
function toUtcIso(day: Date, hour: string, minute: string) {
  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), Number(hour), Number(minute), 0, 0)).toISOString();
}
function displayDate(value: string | Date | null | undefined) {
  const day = dateValue(value);
  return day ? format(day, "dd/MM/yyyy") : "";
}

export default function AdminCouponsVisualPreview() {
  const integratedPanel = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("integration-panel") === "1";
  return integratedPanel ? <CouponsIntegrationDemo /> : <AdminCouponsVisualPreviewContent />;
}

function CouponsIntegrationDemo() {
  const [records, setRecords] = useState(initialCoupons);
  return <div className="l4-coupons-preview" style={{ minHeight: "100vh", padding: "24px clamp(16px, 3vw, 36px)", background: "#000" }}>
    <p style={{ margin: "0 0 14px", color: "#aaa", fontSize: 13 }}>PRÉVIA DEV-ONLY · registros fictícios · alterações apenas em memória</p>
    <AdminCouponsPanel records={records} isLoading={false} isError={false} isCreating={false} isUpdating={false} isDeleting={false} onRefresh={() => {}}
      onCreate={async input => { const id = Math.max(0, ...records.map(c => c.id)) + 1; setRecords(prev => [{ ...input, id, code: input.code, type: input.type, value: input.value, maxUses: input.maxUses, usedCount: 0, startsAt: input.startsAt, expiresAt: input.expiresAt, isActive: input.isActive, createdAt: new Date().toISOString() }, ...prev]); }}
      onUpdate={async input => { setRecords(prev => prev.map(c => c.id === input.id ? { ...c, ...input, id: c.id, startsAt: input.startsAt === undefined ? c.startsAt : input.startsAt, expiresAt: input.expiresAt === undefined ? c.expiresAt : input.expiresAt } : c)); }}
      onDelete={async id => { setRecords(prev => prev.filter(c => c.id !== id)); }} />
  </div>;
}

function AdminCouponsVisualPreviewContent() {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [selectedId, setSelectedId] = useState<number | null>(initialCoupons[0]?.id ?? null);
  const [mode, setMode] = useState<PageMode>("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<CouponDraft>(emptyDraft);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile(900);
  const selected = coupons.find(coupon => coupon.id === selectedId) ?? null;
  const normalizedSearch = search.trim().toLocaleUpperCase("pt-BR");
  const searched = useMemo(() => coupons.filter(coupon => !normalizedSearch || coupon.code.toLocaleUpperCase("pt-BR").includes(normalizedSearch)), [coupons, normalizedSearch]);
  const filterCounts = useMemo(() => Object.fromEntries(filterLabels.map(({ key }) => [key, key === "all" ? searched.length : searched.filter(coupon => statusFor(coupon).key === key).length])) as Record<Filter, number>, [searched]);
  const visibleCoupons = useMemo(() => searched.filter(coupon => filter === "all" || statusFor(coupon).key === filter), [filter, searched]);
  const summary = useMemo(() => ({
    total: coupons.length,
    active: coupons.filter(coupon => statusFor(coupon).key === "active").length,
    scheduled: coupons.filter(coupon => statusFor(coupon).key === "future").length,
    attention: coupons.filter(coupon => ["expired", "exhausted"].includes(statusFor(coupon).key)).length,
  }), [coupons]);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus(); }
      if (event.key === "Tab" && menuRef.current) {
        const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(""), 2400); };
  const updateDraft = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const startCreate = () => { setDraft(emptyDraft()); setDraftId(null); setMode("create"); };
  const startEdit = (coupon: Coupon) => {
    setSelectedId(coupon.id);
    setDraftId(coupon.id);
    setDraft({ code: coupon.code, type: coupon.type, value: coupon.value, maxUses: coupon.maxUses, usedCount: coupon.usedCount, startsAt: coupon.startsAt, expiresAt: coupon.expiresAt, isActive: coupon.isActive });
    setMode("edit");
  };
  const saveDraft = () => {
    const code = draft.code.trim().toUpperCase();
    const normalized = { ...draft, code };
    if (code.length < 3 || code.length > 64) { notify("O código deve ter entre 3 e 64 caracteres."); return; }
    if (!Number.isInteger(draft.value) || draft.value <= 0) { notify("Informe um valor inteiro maior que zero."); return; }
    if (draft.maxUses !== null && (!Number.isInteger(draft.maxUses) || draft.maxUses <= 0)) { notify("O limite deve ser um inteiro maior que zero ou ficar sem limite."); return; }
    if (coupons.some(coupon => coupon.code === code && coupon.id !== draftId)) { notify("Esse código já está cadastrado nesta prévia."); return; }
    const id = draftId ?? Math.max(0, ...coupons.map(coupon => coupon.id)) + 1;
    const existing = coupons.find(coupon => coupon.id === id);
    const saved: Coupon = { ...normalized, id, createdAt: existing?.createdAt ?? new Date().toISOString() };
    setCoupons(current => draftId ? current.map(coupon => coupon.id === id ? saved : coupon) : [saved, ...current]);
    setSelectedId(id);
    setMode("details");
    notify(draftId ? "Edição aplicada somente nesta prévia." : "Cupom criado somente nesta prévia.");
  };
  const toggleActive = (coupon: Coupon) => {
    setCoupons(current => current.map(item => item.id === coupon.id ? { ...item, isActive: !item.isActive } : item));
    notify(`${coupon.code}: estado alterado somente nesta prévia.`);
  };
  const copyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); notify(`Código ${code} copiado.`); }
    catch { notify("A cópia não está disponível neste navegador."); }
  };
  const returnToList = () => setMode("list");
  const returnFromForm = () => setMode(mode === "edit" && selected ? "details" : "list");
  const showSectionMessage = (item: string) => item === "Cupons" ? setMenuOpen(false) : notify("Esta prévia isolada mostra somente Cupons.");

  return <div className="l4-orders-preview l4-admin-preview l4-coupons-preview">
    {menuOpen && mobile ? <button type="button" className="orders-menu-backdrop" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="coupons-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} aria-label="Fechar menu"><X size={18} /> Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <section className="orders-nav-group" key={group.group} aria-label={group.group}><h2>{group.group}</h2>{group.items.map(item => <button key={item} type="button" aria-current={item === "Cupons" ? "page" : undefined} className={item === "Cupons" ? "" : "orders-nav-inactive"} onClick={() => showSectionMessage(item)}>{item}</button>)}</section>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>
    <main className="orders-main-column">
      <div className="orders-preview-banner"><span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Dados fictícios</span><span className="orders-preview-fake-label">Alterações só nesta sessão</span></div>
      {mobile ? <button ref={triggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="coupons-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
      <header className="orders-preview-heading coupons-heading">
        <div><p className="orders-preview-eyebrow">ÁREA COMERCIAL</p><h1>Cupons</h1><p className="coupons-description">Consulte e organize os descontos cadastrados.</p></div>
        {mode === "list" ? <button type="button" className="coupon-button coupon-button--primary" onClick={startCreate}><Plus size={17} /> Novo cupom</button> : <button type="button" className="coupon-button" onClick={mode === "details" ? returnToList : returnFromForm}><ChevronLeft size={16} /> Voltar à listagem</button>}
      </header>

      {mode === "list" ? <>
        <section className="coupon-summary" aria-label="Resumo dos cupons">
          <Metric label="Cupons cadastrados" value={summary.total} />
          <Metric label="Ativos para uso" value={summary.active} />
          <Metric label="Agendados" value={summary.scheduled} />
          <Metric label="Expirados ou esgotados" value={summary.attention} />
        </section>
        <section className="coupon-section coupon-list-section" aria-labelledby="coupon-list-heading">
          <div className="coupon-section-heading"><div><h2 id="coupon-list-heading">Cupons cadastrados</h2><p>{visibleCoupons.length} de {searched.length} registros encontrados</p></div></div>
          <div className="coupon-toolbar">
            <label className="coupon-search"><Tag size={17} aria-hidden="true" /><span className="sr-only">Buscar cupom por código</span><input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por código" /></label>
            {search ? <button type="button" className="coupon-clear" onClick={() => { setSearch(""); searchRef.current?.focus(); }}>Limpar busca</button> : null}
          </div>
          <div className="coupon-filters" role="group" aria-label="Filtrar cupons">
            {filterLabels.map(option => <button type="button" key={option.key} aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>{option.label}<span>{filterCounts[option.key]}</span></button>)}
          </div>
          {visibleCoupons.length ? <div className="coupon-table-wrap"><table className="coupon-table"><thead><tr><th scope="col">Código</th><th scope="col">Benefício</th><th scope="col">Situação</th><th scope="col">Validade</th><th scope="col">Utilização</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>
            {visibleCoupons.map(coupon => <tr key={coupon.id} className={selectedId === coupon.id ? "is-selected" : ""}>
              <td data-label="Código"><button type="button" className="coupon-code-link" onClick={() => { setSelectedId(coupon.id); setMode("details"); }}><strong>{coupon.code}</strong><span>#{coupon.id}</span></button></td>
              <td data-label="Benefício"><div className="coupon-benefit"><strong>{formatCouponValue(coupon.type, coupon.value)}</strong><span>{coupon.type === "percent" ? "Percentual" : "Valor fixo em reais"}</span></div></td>
              <td data-label="Situação"><StatusBadge coupon={coupon} /></td>
              <td data-label="Validade"><div className="coupon-validity"><span>{coupon.startsAt ? `Início ${formatUtc(coupon.startsAt)}` : "Sem início definido"}</span><span>{coupon.expiresAt ? `Fim ${formatUtc(coupon.expiresAt)}` : "Sem expiração"}</span></div></td>
              <td data-label="Utilização"><Usage coupon={coupon} /></td>
              <td data-label="Ações"><div className="coupon-row-actions"><button type="button" aria-label={`Ver detalhes do cupom ${coupon.code}`} onClick={() => { setSelectedId(coupon.id); setMode("details"); }}><Eye size={16} /><span>Detalhes</span></button><button type="button" aria-label={`Editar cupom ${coupon.code}`} onClick={() => startEdit(coupon)}><Pencil size={16} /><span>Editar</span></button></div></td>
            </tr>)}
          </tbody></table></div> : <div className="coupon-empty"><strong>Nenhum cupom encontrado</strong><span>Ajuste a busca ou o filtro para ver outros registros.</span></div>}
        </section>
        <section className="coupon-waitlist-row" aria-labelledby="coupon-waitlist-heading">
          <div><h2 id="coupon-waitlist-heading">Aviso à lista de espera</h2><p>Comunicação de lançamento com código do cupom, percentual, link da loja e tamanho do lote.</p></div>
          <button type="button" className="coupon-button" disabled title="Envios estão desativados nesta prévia">Disparo desativado nesta prévia</button>
        </section>
      </> : null}

      {mode === "details" && selected ? <section className="coupon-details-layout">
        <article className="coupon-section coupon-detail-main">
          <div className="coupon-detail-header"><div><p className="coupon-kicker">CUPOM #{selected.id}</p><h2>{selected.code}</h2></div><StatusBadge coupon={selected} /></div>
          <div className="coupon-detail-benefit"><span>Benefício configurado</span><strong>{formatCouponValue(selected.type, selected.value)}</strong><small>{selected.type === "percent" ? "desconto percentual" : "valor fixo em reais"}</small></div>
          <section className="coupon-detail-group"><h3>Utilização</h3><dl className="coupon-facts">
            <Fact label="Tipo" value={selected.type === "percent" ? "Percentual" : "Valor fixo em reais"} />
            <Fact label="Limite máximo" value={selected.maxUses === null ? "Sem limite configurado" : `${selected.maxUses} utilizações`} />
            <Fact label="Utilizações confirmadas" value={`${selected.usedCount}${selected.maxUses === null ? " usos" : ` de ${selected.maxUses} usos`}`} />
          </dl></section>
          <section className="coupon-detail-group"><h3>Validade · UTC</h3><dl className="coupon-facts"><Fact label="Início" value={formatUtc(selected.startsAt)} /><Fact label="Expiração" value={formatUtc(selected.expiresAt)} /><Fact label="Criado em" value={formatUtc(selected.createdAt)} /></dl></section>
          <section className="coupon-detail-group"><h3>Aplicação do desconto</h3><p className="coupon-rule-copy">O percentual incide sobre itens e frete. O valor fixo é em reais e limitado ao total do pedido.</p></section>
          <div className="coupon-detail-actions"><button type="button" className="coupon-button" onClick={() => copyCode(selected.code)}><Copy size={16} /> Copiar código</button><button type="button" className="coupon-button coupon-button--primary" onClick={() => startEdit(selected)}><Pencil size={16} /> Editar cupom</button><button type="button" className="coupon-button" role="switch" aria-checked={Boolean(selected.isActive)} onClick={() => toggleActive(selected)}><span className={`coupon-switch-dot${selected.isActive ? " is-active" : ""}`} />{selected.isActive ? "Desativar nesta prévia" : "Ativar nesta prévia"}</button><button type="button" className="coupon-button coupon-button--danger" disabled title="A exclusão real está desativada nesta prévia">Excluir · desativado</button></div>
          <p className="coupon-demo-note">Alterações nesta tela ficam somente nesta sessão e não são publicadas.</p>
        </article>
      </section> : null}

      {(mode === "create" || mode === "edit") ? <>
        <div className="coupon-edit-context"><strong>{mode === "create" ? "Novo cupom" : `Editar ${draft.code || `#${draftId}`}`}</strong><span>{mode === "create" ? "Rascunho local" : `Registro #${draftId}`} · sem gravação no servidor</span></div>
        <div className="coupon-editor-layout">
          <form className="coupon-form" onSubmit={event => { event.preventDefault(); saveDraft(); }}>
            <section className="coupon-section coupon-form-section"><h2>Informações gerais</h2><div className="coupon-form-grid">
              <label className="coupon-field coupon-field--full"><span>Código do cupom</span><input autoComplete="off" maxLength={64} value={draft.code} onChange={event => updateDraft("code", event.target.value)} placeholder="Ex.: CLA14BIS15" aria-describedby="coupon-code-help" /><small id="coupon-code-help">De 3 a 64 caracteres. Será normalizado para maiúsculas ao aplicar o rascunho.</small></label>
              <label className="coupon-field"><span>Tipo de desconto</span><Select value={draft.type} onValueChange={value => updateDraft("type", value as CouponDraft["type"])}><SelectTrigger className="coupon-select-trigger" aria-label="Tipo de desconto"><SelectValue /></SelectTrigger><SelectContent className="coupon-select-content" position="popper" align="start" sideOffset={5} collisionPadding={12}><SelectItem value="percent">Percentual</SelectItem><SelectItem value="fixed">Valor fixo em reais</SelectItem></SelectContent></Select></label>
              <label className="coupon-field"><span>{draft.type === "percent" ? "Percentual de desconto" : "Valor fixo do desconto"}</span><div className="coupon-number-field"><input type="number" min={1} step={1} inputMode="numeric" value={draft.value} onChange={event => updateDraft("value", Number(event.target.value))} /><span>{draft.type === "percent" ? "%" : "R$"}</span></div><small>{draft.type === "fixed" ? "Informe o valor em reais." : "Informe o percentual inteiro."}</small></label>
            </div></section>
            <section className="coupon-section coupon-form-section"><h2>Condições de uso</h2><div className="coupon-form-grid">
              <label className="coupon-field"><span>Limite máximo de utilizações</span><div className="coupon-number-field"><input type="number" min={1} step={1} inputMode="numeric" value={draft.maxUses ?? ""} onChange={event => updateDraft("maxUses", event.target.value === "" ? null : Number(event.target.value))} placeholder="Sem limite" /><span>usos</span></div><small>Quantidade total. Deixe vazio para não definir um limite.</small></label>
              {mode === "edit" ? <div className="coupon-readonly-field"><span>Usos já confirmados</span><strong>{draft.usedCount}</strong><small>Somente leitura; atualizado pelo fluxo de checkout.</small></div> : <div className="coupon-readonly-field"><span>Contagem inicial</span><strong>0</strong><small>Novos registros começam sem usos contabilizados.</small></div>}
              {draft.maxUses !== null && draft.maxUses < draft.usedCount ? <p className="coupon-form-warning coupon-field--full">O limite informado está abaixo dos usos já confirmados. O estado resultante será exibido no resumo; a prévia não cria uma regra adicional.</p> : null}
            </div></section>
            <section className="coupon-section coupon-form-section"><h2>Validade e situação</h2><div className="coupon-form-grid">
              <CouponDateField label="Início de validade" value={draft.startsAt} onChange={value => updateDraft("startsAt", value)} />
              <CouponDateField label="Expiração" value={draft.expiresAt} onChange={value => updateDraft("expiresAt", value)} />
              <div className="coupon-active-field"><span>Situação</span><button type="button" role="switch" aria-checked={draft.isActive} onClick={() => updateDraft("isActive", !draft.isActive)}><span className={`coupon-switch-dot${draft.isActive ? " is-active" : ""}`} />{draft.isActive ? "Ativo" : "Inativo"}</button><small>Estado inicial ou alteração local demonstrativa.</small></div>
              {draft.startsAt && draft.expiresAt && new Date(draft.startsAt) > new Date(draft.expiresAt) ? <p className="coupon-form-warning coupon-field--full">A data inicial está depois da expiração. Confira a janela antes de aplicar o rascunho.</p> : null}
            </div></section>
            <div className="coupon-form-actions"><button type="button" className="coupon-button" onClick={returnFromForm}>Cancelar</button><button type="submit" className="coupon-button coupon-button--primary"><Check size={16} /> Aplicar nesta sessão</button></div>
          </form>
          <aside className="coupon-section coupon-live-summary"><div className="coupon-section-heading"><div><p className="coupon-kicker">RESUMO LOCAL</p><h2>Como ficará o cupom</h2></div></div><div className="coupon-live-code">{draft.code.trim().toUpperCase() || "Código não informado"}</div><StatusBadge coupon={{ ...draft, id: draftId ?? 0, code: draft.code, createdAt: new Date().toISOString() } as Coupon} /><dl className="coupon-live-facts"><Fact label="Benefício" value={formatCouponValue(draft.type, draft.value || 0)} /><Fact label="Limite" value={draft.maxUses === null ? "Sem limite" : `${draft.maxUses} usos totais`} /><Fact label="Usos confirmados" value={String(draft.usedCount)} /><Fact label="Início · UTC" value={formatUtc(draft.startsAt)} /><Fact label="Expiração · UTC" value={formatUtc(draft.expiresAt)} /></dl></aside>
        </div>
      </> : null}
      {message ? <div className="coupon-toast" role="status">{message}</div> : null}
    </main>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="coupon-metric"><strong>{value}</strong><span>{label}</span></div>; }
function StatusBadge({ coupon }: { coupon: CouponAdminView }) {
  const state = statusFor(coupon as Coupon);
  return <span className={`coupon-status is-${state.key}`}><i aria-hidden="true" />{state.label}</span>;
}
function Usage({ coupon }: { coupon: Coupon }) {
  return <div className="coupon-usage"><strong>{coupon.usedCount}{coupon.maxUses === null ? " usos" : ` / ${coupon.maxUses}`}</strong><span>{coupon.maxUses === null ? "sem limite" : "usos confirmados"}</span></div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

function CouponDateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const current = value ? new Date(value) : null;
  const selectedDay = current && Number.isFinite(current.getTime()) ? new Date(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()) : undefined;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDay ?? startOfMonth(new Date()));
  const [hour, setHour] = useState(current ? String(current.getUTCHours()).padStart(2, "0") : "12");
  const [minute, setMinute] = useState(current ? String(current.getUTCMinutes()).padStart(2, "0") : "00");
  useEffect(() => {
    const date = value ? new Date(value) : null;
    if (date && Number.isFinite(date.getTime())) {
      const day = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      setVisibleMonth(startOfMonth(day)); setHour(String(date.getUTCHours()).padStart(2, "0")); setMinute(String(date.getUTCMinutes()).padStart(2, "0"));
    }
  }, [value]);
  const normalizedHour = /^\d{1,2}$/.test(hour) && Number(hour) <= 23 ? hour.padStart(2, "0") : null;
  const normalizedMinute = /^\d{1,2}$/.test(minute) && Number(minute) <= 59 ? minute.padStart(2, "0") : null;
  const validTime = normalizedHour !== null && normalizedMinute !== null;
  const updateTime = (nextHour: string, nextMinute: string) => {
    setHour(nextHour); setMinute(nextMinute);
    const parsedHour = /^\d{1,2}$/.test(nextHour) && Number(nextHour) <= 23 ? nextHour.padStart(2, "0") : null;
    const parsedMinute = /^\d{1,2}$/.test(nextMinute) && Number(nextMinute) <= 59 ? nextMinute.padStart(2, "0") : null;
    if (selectedDay && parsedHour !== null && parsedMinute !== null) onChange(toUtcIso(selectedDay, parsedHour, parsedMinute));
  };
  return <div className="coupon-date-field">
    <span className="coupon-date-label">{label} <small>UTC</small></span>
    <div className="coupon-date-control">
      <input aria-label={`${label}, data em UTC`} readOnly value={displayDate(value)} placeholder="Sem data definida" />
      <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" className="coupon-calendar-trigger" aria-label={`Abrir calendário para ${label}`} aria-haspopup="dialog"><CalendarDays size={17} /></button></PopoverTrigger><PopoverContent className="coupon-calendar-popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Calendário de ${label}`}>
        <div className="coupon-calendar-heading"><button type="button" aria-label="Mês anterior" onClick={() => setVisibleMonth(month => subMonths(month, 1))}><ChevronLeft size={17} /></button><strong>{format(visibleMonth, "LLLL yyyy", { locale: ptBR })}</strong><button type="button" aria-label="Próximo mês" onClick={() => setVisibleMonth(month => addMonths(month, 1))}><ChevronRight size={17} /></button></div>
        <Calendar mode="single" locale={ptBR} selected={selectedDay} month={visibleMonth} onMonthChange={setVisibleMonth} onSelect={day => { if (!day) return; onChange(toUtcIso(day, validTime ? normalizedHour! : "12", validTime ? normalizedMinute! : "00")); setOpen(false); }} className="coupon-calendar" />
        <p className="coupon-calendar-hint">A data e o horário digitados são interpretados em UTC.</p>
      </PopoverContent></Popover>
      {value ? <button type="button" className="coupon-date-clear" onClick={() => onChange(null)} aria-label={`Remover ${label}`}>Limpar</button> : null}
    </div>
    <div className="coupon-time-row"><label><span>Hora UTC</span><input type="text" inputMode="numeric" maxLength={2} value={hour} role="spinbutton" aria-valuemin={0} aria-valuemax={23} aria-valuenow={Number(normalizedHour ?? 12)} aria-label={`${label}, hora UTC`} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); updateTime(next, minute); }} onBlur={() => updateTime(normalizedHour ?? "12", normalizedMinute ?? "00")} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(hour || 0) + (event.key === "ArrowUp" ? 1 : -1) + 24) % 24; updateTime(String(next).padStart(2, "0"), minute); }} /></label><span aria-hidden="true">:</span><label><span>Minuto</span><input type="text" inputMode="numeric" maxLength={2} value={minute} role="spinbutton" aria-valuemin={0} aria-valuemax={59} aria-valuenow={Number(normalizedMinute ?? 0)} aria-label={`${label}, minuto UTC`} onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); updateTime(hour, next); }} onBlur={() => updateTime(normalizedHour ?? "12", normalizedMinute ?? "00")} onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = (Number(minute || 0) + (event.key === "ArrowUp" ? 1 : -1) + 60) % 60; updateTime(hour, String(next).padStart(2, "0")); }} /></label></div>
    <small className="coupon-date-help">{value ? formatUtc(value) : "Opcional · escolha uma data no calendário"}</small>
  </div>;
}
