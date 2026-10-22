import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Eye, ImagePlus, Menu, Monitor, Pencil, Plus, Smartphone, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/PromoCarousel.css";
import "../components/admin/AdminPromotionsVisualPreview.css";

type PromoRecord = {
  id: number; badge: string; title: string; description: string; ctaLabel: string;
  imageUrl: string; mobileImageUrl: string; imageAlt: string; linkUrl: string;
  discountText: string; discountLabel: string; bgStyle: string; sortOrder: number; isActive: boolean;
};
type PromoDraft = Omit<PromoRecord, "id">;
type Mode = "list" | "details" | "create" | "edit";
type PreviewViewport = "desktop" | "mobile";
type DisplayMode = "single" | "rotation";

const publicHeroFallback = "/images/hero/camiseta-cla-14-bis-recorte.png";
const legacyHeroImage = "9a1c1469-8e7d-49ba-9a5b-f9de68cad788-banner.webp";
const blankDraft = (): PromoDraft => ({
  badge: "DESTAQUE L4CKOS", title: "", description: "", ctaLabel: "Ver produto",
  imageUrl: "", mobileImageUrl: "", imageAlt: "", linkUrl: "", discountText: "",
  discountLabel: "OFF", bgStyle: "#000000", sortOrder: 0, isActive: true,
});
const seedPromotions: PromoRecord[] = [
  {
    id: 204, badge: "L4CKOS × CLÃ 14 BIS", title: "Clã 14 Bis",
    description: "Camiseta da colaboração Clã 14 Bis, com identidade escoteira e linguagem urbana.",
    ctaLabel: "Ver a peça", imageUrl: publicHeroFallback, mobileImageUrl: "",
    imageAlt: "Camiseta azul-marinho da colaboração L4CKOS e Clã 14 Bis",
    linkUrl: "/produtos", discountText: "", discountLabel: "OFF", bgStyle: "#000000", sortOrder: 1, isActive: true,
  },
  {
    id: 203, badge: "LINHA ESSENCIAL", title: "L4CKOS Core",
    description: "Peças essenciais para acompanhar a rotina, com acabamento e conforto L4CKOS.",
    ctaLabel: "Explorar a linha", imageUrl: "/images/camisa.png", mobileImageUrl: "",
    imageAlt: "Camiseta preta lisa da linha essencial L4CKOS, vista de frente e de costas",
    linkUrl: "/produtos", discountText: "", discountLabel: "OFF", bgStyle: "#000000", sortOrder: 2, isActive: true,
  },
  {
    id: 202, badge: "COLEÇÃO L4CKOS", title: "Clã 14 Bis · edição",
    description: "Uma segunda apresentação local da mesma colaboração, com a foto do produto correspondente.",
    ctaLabel: "Conhecer a coleção", imageUrl: publicHeroFallback, mobileImageUrl: "",
    imageAlt: "Camiseta azul-marinho da colaboração L4CKOS e Clã 14 Bis",
    linkUrl: "/produtos", discountText: "", discountLabel: "OFF", bgStyle: "#000000", sortOrder: 3, isActive: false,
  },
];
const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

export default function AdminPromotionsVisualPreview() {
  const [records, setRecords] = useState(seedPromotions);
  const [primaryId, setPrimaryId] = useState<number | null>(seedPromotions[0]?.id ?? null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("rotation");
  const [rotationSeconds, setRotationSeconds] = useState(8);
  const [rotationInput, setRotationInput] = useState("8");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("list");
  const [selectedId, setSelectedId] = useState<number | null>(seedPromotions[0]?.id ?? null);
  const [draft, setDraft] = useState<PromoDraft>(blankDraft);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("desktop");
  const [previewPaused, setPreviewPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const mobile = useIsMobile(900);

  const orderedRecords = useMemo(() => [...records].sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id), [records]);
  const activeRecords = useMemo(() => {
    const active = orderedRecords.filter(record => record.isActive);
    const primary = active.find(record => record.id === primaryId);
    return primary ? [primary, ...active.filter(record => record.id !== primary.id)] : active;
  }, [orderedRecords, primaryId]);
  const primaryRecord = activeRecords[0] ?? null;
  const previewRecords = displayMode === "single" ? (primaryRecord ? [primaryRecord] : []) : activeRecords;
  const currentPreviewRecord = previewRecords.length ? previewRecords[previewIndex % previewRecords.length] : null;
  const selected = records.find(record => record.id === selectedId) ?? null;
  const recordForPreview = mode === "create" || mode === "edit" ? draft : (mode === "details" ? selected : currentPreviewRecord);

  useEffect(() => {
    if (previewIndex >= previewRecords.length) setPreviewIndex(0);
  }, [previewIndex, previewRecords.length]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previousOverflow = document.body.style.overflow;
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
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  useEffect(() => {
    if (displayMode !== "rotation" || previewRecords.length < 2 || previewPaused || reducedMotion) return;
    const timer = window.setTimeout(() => setPreviewIndex(index => (index + 1) % previewRecords.length), rotationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [displayMode, previewRecords.length, previewPaused, reducedMotion, rotationSeconds, previewIndex]);

  const showMessage = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  };
  const setField = <K extends keyof PromoDraft>(field: K, value: PromoDraft[K]) => setDraft(previous => ({ ...previous, [field]: value }));
  const startCreate = () => { setDraft(blankDraft()); setDraftId(null); setMode("create"); };
  const startEdit = (record: PromoRecord) => {
    const { id, ...values } = record;
    setSelectedId(record.id); setDraftId(id); setDraft({ ...values }); setMode("edit");
  };
  const returnToList = () => setMode("list");
  const returnFromForm = () => setMode(mode === "edit" && selected ? "details" : "list");
  const saveLocalDraft = () => {
    const id = draftId ?? Math.max(0, ...records.map(record => record.id)) + 1;
    const saved: PromoRecord = { ...draft, id, sortOrder: draftId ? draft.sortOrder : records.length + 1 };
    setRecords(current => draftId ? current.map(record => record.id === draftId ? saved : record) : [...current, saved]);
    setSelectedId(id);
    if (saved.isActive && primaryId === null) setPrimaryId(id);
    setMode("details");
    showMessage("Rascunho atualizado somente nesta sessão local.");
  };
  const setActive = (record: PromoRecord, isActive: boolean) => {
    const next = records.map(item => item.id === record.id ? { ...item, isActive } : item);
    setRecords(next);
    if (!isActive && primaryId === record.id) {
      setPrimaryId(next.filter(item => item.isActive).sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? null);
    } else if (isActive && primaryId === null) setPrimaryId(record.id);
    setPreviewIndex(0);
    showMessage(`${record.title}: ${isActive ? "ativado" : "desativado"} nesta sessão local.`);
  };
  const setPrimary = (record: PromoRecord) => {
    if (!record.isActive) return;
    setPrimaryId(record.id); setPreviewIndex(0);
    showMessage(`${record.title} definido como principal nesta sessão local.`);
  };
  const moveRecord = (id: number, direction: -1 | 1) => {
    const items = [...orderedRecords];
    const index = items.findIndex(record => record.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    setRecords(items.map((record, position) => ({ ...record, sortOrder: position + 1 })));
    setPreviewIndex(0);
    showMessage("Ordem atualizada somente nesta sessão local.");
  };
  const readLocalImage = (field: "imageUrl" | "mobileImageUrl", file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showMessage("Escolha um arquivo de imagem."); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setField(field, reader.result); };
    reader.readAsDataURL(file);
  };
  const imageFor = (record: PromoRecord | PromoDraft | null, viewport: PreviewViewport) => {
    if (!record) return "";
    const source = viewport === "mobile" ? (record.mobileImageUrl || record.imageUrl) : record.imageUrl;
    return source && !source.includes(legacyHeroImage) ? source : publicHeroFallback;
  };
  const stepPreview = (direction: -1 | 1) => {
    if (previewRecords.length < 2) return;
    setPreviewIndex(index => (index + direction + previewRecords.length) % previewRecords.length);
  };
  const choosePreview = (index: number) => {
    setPreviewIndex(index);
  };
  const applyRotationSeconds = () => {
    const parsed = Number(rotationInput);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 60) {
      setRotationInput(String(rotationSeconds));
      showMessage("Escolha um intervalo entre 5 e 60 segundos.");
      return;
    }
    setRotationSeconds(Math.round(parsed)); setRotationInput(String(Math.round(parsed)));
    showMessage(`Intervalo definido para ${Math.round(parsed)} segundos nesta sessão.`);
  };
  const isActuallyDisplayed = (record: PromoRecord | PromoDraft | null) => Boolean(record && "id" in record && primaryRecord?.id === record.id);

  return (
    <div className="l4-orders-preview l4-promotions-preview">
      <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="promotions-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
        <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} aria-label="Fechar menu"><X size={18} /></button>
        <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <section className="orders-nav-group" key={group.group} aria-label={group.group}><h2>{group.group}</h2>{group.items.map(item => <button key={item} type="button" aria-current={item === "Promoções" ? "page" : undefined} className={item === "Promoções" ? "" : "orders-nav-inactive"} onClick={() => item === "Promoções" ? setMenuOpen(false) : showMessage("Navegação indisponível nesta prévia isolada.")}>{item}</button>)}</section>)}</nav>
        <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
      </aside>
      {mobile && menuOpen ? <button type="button" className="orders-menu-backdrop" aria-label="Fechar menu" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} /> : null}
      <main className="orders-main-column">
        <div className="orders-preview-banner"><span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Dados fictícios</span><span className="orders-preview-fake-label">Alterações só nesta sessão</span></div>
        {mobile ? <button ref={triggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="promotions-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
        <header className="orders-preview-heading promo-heading">
          <div><p className="orders-preview-eyebrow">ÁREA COMERCIAL · DESTAQUES DA HOME</p><h1>Destaques da Home</h1><p className="promo-page-description">Organize os produtos e coleções apresentados na página inicial.</p></div>
          {mode === "create" || mode === "edit" ? <button className="promo-back" onClick={returnFromForm}><ArrowLeft size={16} /> Voltar</button> : mode === "details" ? <button className="promo-back" onClick={returnToList}><ArrowLeft size={16} /> Destaques</button> : <button className="promo-button promo-button--primary" onClick={startCreate}><Plus size={17} /> Novo destaque</button>}
        </header>

        {mode === "list" ? <>
          <section className="promo-global-controls" aria-label="Configuração local da apresentação da home">
            <div className="promo-mode-control"><span className="promo-control-label">Apresentação na home</span><div className="promo-mode-options" role="group" aria-label="Modo de apresentação">
              <button type="button" aria-pressed={displayMode === "single"} onClick={() => { setDisplayMode("single"); setPreviewIndex(0); }}>Destaque único</button>
              <button type="button" aria-pressed={displayMode === "rotation"} onClick={() => { setDisplayMode("rotation"); setPreviewIndex(0); }}>Rotação automática</button>
            </div></div>
            {displayMode === "rotation" ? <div className="promo-interval-control"><label className="promo-control-label" htmlFor="promo-rotation-seconds">Intervalo de rotação</label><div className="promo-interval-input"><input id="promo-rotation-seconds" type="number" min={5} max={60} step={1} value={rotationInput} onChange={event => setRotationInput(event.target.value)} onBlur={applyRotationSeconds} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyRotationSeconds(); } }} /><span>segundos</span><button type="button" onClick={applyRotationSeconds}>Aplicar</button></div><small>De 5 a 60 segundos</small></div> : null}
            <p className="promo-local-config-note">Configuração demonstrativa; o sistema atual ainda não salva modo, destaque principal ou intervalo.</p>
          </section>
          <section className="promo-overview-layout">
            <section className="promo-section promo-catalog" aria-labelledby="promo-list-title">
              <div className="promo-list-heading"><div><h2 id="promo-list-title">Destaques cadastrados</h2><p>{records.length} registros <span>·</span> {records.filter(item => item.isActive).length} ativos <span>·</span> {records.filter(item => !item.isActive).length} inativos</p></div><span>O principal aparece primeiro</span></div>
              <div className="promo-record-list">{orderedRecords.length ? orderedRecords.map(record => <article className={`promo-record${record.id === selectedId ? " is-selected" : ""}${record.id === primaryId ? " is-primary" : ""}`} key={record.id}>
                <button type="button" className="promo-record-select" onClick={() => { setSelectedId(record.id); setMode("list"); }} aria-label={`Selecionar destaque ${record.title}`}>
                  <img src={record.imageUrl || publicHeroFallback} alt="" />
                  <span className="promo-record-copy"><strong>{record.title || "Sem título"}</strong><small>{record.description || "Sem descrição cadastrada"}</small></span>
                  <span className={`promo-state${record.isActive ? " is-active" : ""}`}><i aria-hidden="true" />{record.isActive ? "Ativo" : "Inativo"}</span>
                  <span className="promo-order"><small>Ordem</small><b>{record.sortOrder}</b></span>
                </button>
                <div className="promo-record-meta"><span className={`promo-primary-tag${record.id === primaryId ? " is-primary" : ""}`}>{record.id === primaryId ? <><Check size={13} /> Principal</> : "Secundário"}</span><span className="promo-record-id">#{record.id}</span></div>
                <div className="promo-record-actions">
                  <button type="button" onClick={() => { setSelectedId(record.id); setMode("details"); }}><Eye size={15} /> Visualizar</button>
                  <button type="button" onClick={() => startEdit(record)}><Pencil size={15} /> Editar</button>
                  <button type="button" className="promo-primary-action" disabled={!record.isActive || record.id === primaryId} onClick={() => setPrimary(record)}>{record.id === primaryId ? "Principal" : "Definir principal"}</button>
                  <button type="button" role="switch" aria-checked={record.isActive} className={`promo-row-switch${record.isActive ? " is-active" : ""}`} onClick={() => setActive(record, !record.isActive)}><i />{record.isActive ? "Desativar" : "Ativar"}</button>
                  <button type="button" aria-label={`Mover ${record.title} para cima`} title="Mover para cima" disabled={record.sortOrder <= 1} onClick={() => moveRecord(record.id, -1)}><ArrowUp size={15} /></button>
                  <button type="button" aria-label={`Mover ${record.title} para baixo`} title="Mover para baixo" disabled={record.sortOrder >= records.length} onClick={() => moveRecord(record.id, 1)}><ArrowDown size={15} /></button>
                </div>
              </article>) : <div className="promo-empty">Nenhum destaque cadastrado nesta prévia.</div>}</div>
            </section>
            <section className="promo-section promo-storefront-panel" aria-label="Simulação da apresentação na home">
              <StorefrontPanel record={currentPreviewRecord} previewIdentity={currentPreviewRecord ? `Destaque #${currentPreviewRecord.id}${isActuallyDisplayed(currentPreviewRecord) ? " · principal" : ""}` : "Nenhum destaque ativo"} viewport={previewViewport} setViewport={setPreviewViewport} image={imageFor(currentPreviewRecord, previewViewport)} isActuallyDisplayed={isActuallyDisplayed(currentPreviewRecord)} primaryRecord={primaryRecord} displayMode={displayMode} displayCount={previewRecords.length} interval={rotationSeconds} reducedMotion={reducedMotion} previewIndex={previewIndex} previewRef={previewRef} setPreviewPaused={setPreviewPaused} stepPreview={stepPreview} choosePreview={choosePreview} />
              {selected ? <div className="promo-selected-actions"><button type="button" onClick={() => setMode("details")}><Eye size={15} /> Ver detalhes</button><button type="button" onClick={() => startEdit(selected)}><Pencil size={15} /> Editar destaque</button></div> : null}
            </section>
          </section>
        </> : null}

        {mode === "details" && selected ? <section className="promo-detail-layout">
          <div className="promo-section promo-detail-data"><div className="promo-list-heading"><div><h2>Detalhes do destaque</h2><p>Registro #{selected.id}</p></div><span className={`promo-state${selected.isActive ? " is-active" : ""}`}><i aria-hidden="true" />{selected.isActive ? "Ativo" : "Inativo"}</span></div>
            <dl className="promo-detail-grid"><Fact label="Título cadastrado" value={selected.title} /><Fact label="Posição" value={selected.id === primaryId ? "Principal · primeiro" : `Ordem ${selected.sortOrder}`} /><Fact label="Foto desktop" value={selected.imageUrl ? "Disponível" : "Não cadastrada"} /><Fact label="Foto mobile" value={selected.mobileImageUrl ? "Imagem própria" : "Usa a foto desktop"} /><Fact label="Destino" value={selected.linkUrl || "Não informado"} /><Fact label="Texto alternativo" value={selected.imageAlt || "Não informado"} /><Fact label="Informação promocional" value={selected.discountText ? `${selected.discountText} ${selected.discountLabel}` : "Não configurada"} /><Fact label="Agendamento" value="Não disponível no contrato atual" /></dl>
            <p className="promo-detail-note">A home atual apresenta somente o primeiro registro ativo por ordem. A rotação e o conteúdo editorial dinâmico aparecem aqui apenas como simulação local.</p>
            <div className="promo-detail-actions"><button type="button" className="promo-button promo-button--primary" onClick={() => startEdit(selected)}><Pencil size={16} /> Editar destaque</button><button type="button" role="switch" aria-checked={selected.isActive} className={`promo-row-switch${selected.isActive ? " is-active" : ""}`} onClick={() => setActive(selected, !selected.isActive)}><i />{selected.isActive ? "Desativar" : "Ativar"}</button>{selected.isActive ? <button type="button" className="promo-button" disabled={selected.id === primaryId} onClick={() => setPrimary(selected)}>Definir como principal</button> : null}</div>
          </div>
          <section className="promo-section promo-storefront-panel"><StorefrontPanel record={selected} previewIdentity={`Destaque #${selected.id}${isActuallyDisplayed(selected) ? " · principal" : ""}`} viewport={previewViewport} setViewport={setPreviewViewport} image={imageFor(selected, previewViewport)} isActuallyDisplayed={isActuallyDisplayed(selected)} primaryRecord={primaryRecord} displayMode={displayMode} displayCount={previewRecords.length} interval={rotationSeconds} reducedMotion={reducedMotion} previewIndex={0} previewRef={previewRef} setPreviewPaused={setPreviewPaused} stepPreview={stepPreview} choosePreview={choosePreview} /></section>
        </section> : null}

        {(mode === "create" || mode === "edit") ? <>
          <div className="promo-edit-context"><strong>{mode === "create" ? "Novo destaque" : `Editar · ${draft.title || `#${draftId ?? "—"}`}`}</strong><span>{mode === "create" ? "Novo registro fictício" : `Editando registro #${draftId}`} · não há publicação nesta prévia</span></div>
          <div className="promo-editor-layout">
            <form className="promo-form" onSubmit={event => { event.preventDefault(); saveLocalDraft(); }}>
              <section className="promo-edit-section"><h2>Conteúdo do destaque</h2><div className="promo-field-grid">
                <label className="promo-field-full"><span>Título do destaque</span><input maxLength={255} value={draft.title} onChange={event => setField("title", event.target.value)} placeholder="Ex.: Clã 14 Bis" /><small>O contrato atual tem um único título, usado aqui como identificação e conteúdo proposto.</small></label>
                <label className="promo-field-full"><span>Descrição curta</span><textarea maxLength={1000} rows={3} value={draft.description} onChange={event => setField("description", event.target.value)} placeholder="Apresente a peça ou coleção em poucas palavras" /></label>
                <label><span>Texto do botão</span><input maxLength={120} value={draft.ctaLabel} onChange={event => setField("ctaLabel", event.target.value)} placeholder="Ver produto" /></label>
                <label><span>Texto alternativo da foto</span><input maxLength={255} value={draft.imageAlt} onChange={event => setField("imageAlt", event.target.value)} placeholder="Descreva o produto fotografado" /></label>
              </div></section>
              <section className="promo-edit-section"><div className="promo-section-title-row"><div><h2>Fotografias do produto</h2><p>Escolha uma imagem para cada formato. Sem foto mobile, a versão desktop é usada.</p></div></div><div className="promo-media-grid">
                <MediaField label="Foto desktop" src={draft.imageUrl} fallback={publicHeroFallback} onUrlChange={value => setField("imageUrl", value)} onFile={file => readLocalImage("imageUrl", file)} onRemove={() => setField("imageUrl", "")} inputValue={draft.imageUrl.startsWith("data:") ? "Imagem local selecionada" : draft.imageUrl} placeholder="Endereço da imagem (opcional)" />
                <MediaField label="Foto mobile" src={draft.mobileImageUrl} fallback={draft.imageUrl || publicHeroFallback} onUrlChange={value => setField("mobileImageUrl", value)} onFile={file => readLocalImage("mobileImageUrl", file)} onRemove={() => setField("mobileImageUrl", "")} inputValue={draft.mobileImageUrl.startsWith("data:") ? "Imagem local selecionada" : draft.mobileImageUrl} placeholder="Opcional — usa a foto desktop" mobileFallback={!draft.mobileImageUrl} />
              </div></section>
              <section className="promo-edit-section"><h2>Destino e organização</h2><div className="promo-field-grid promo-display-grid">
                <label className="promo-field-full"><span>Link de destino</span><input maxLength={500} value={draft.linkUrl} onChange={event => setField("linkUrl", event.target.value)} placeholder="/produtos ou URL da coleção" /></label>
                <label><span>Ordem entre os destaques</span><input type="number" min={1} step={1} value={draft.sortOrder} onChange={event => setField("sortOrder", Math.max(1, Number(event.target.value) || 1))} /><small>O destaque principal sempre aparece primeiro.</small></label>
                <div className="promo-active-control"><span>Situação</span><button type="button" role="switch" aria-checked={draft.isActive} onClick={() => setField("isActive", !draft.isActive)} className={`promo-switch${draft.isActive ? " is-active" : ""}`}><i />{draft.isActive ? "Ativo" : "Inativo"}</button></div>
              </div></section>
              <details className="promo-complementary"><summary>Outras informações cadastradas</summary><p>Estes campos existem no registro, mas ainda não são mostrados pela composição pública atual.</p><div className="promo-field-grid">
                <label><span>Selo</span><input maxLength={80} value={draft.badge} onChange={event => setField("badge", event.target.value)} placeholder="Ex.: NOVA COLEÇÃO" /></label>
                <label><span>Oferta</span><input maxLength={60} value={draft.discountText} onChange={event => setField("discountText", event.target.value)} placeholder="Opcional" /></label>
                <label><span>Complemento da oferta</span><input maxLength={40} value={draft.discountLabel} onChange={event => setField("discountLabel", event.target.value)} placeholder="OFF" /></label>
                <label className="promo-field-full"><span>Estilo de fundo (campo cadastrado)</span><input maxLength={255} value={draft.bgStyle} onChange={event => setField("bgStyle", event.target.value)} /><small>A home atual não aplica este valor no destaque.</small></label>
              </div></details>
              <div className="promo-form-actions"><button type="button" className="promo-button" onClick={returnFromForm}>Cancelar</button><button type="submit" className="promo-button promo-button--primary"><Check size={16} /> Salvar nesta sessão</button></div>
            </form>
            <section className="promo-editor-preview promo-section" aria-label="Prévia em tempo real do conteúdo editado"><StorefrontPanel record={recordForPreview} previewIdentity={mode === "edit" ? `Destaque #${draftId} · edição local` : "Novo rascunho local · sem ID"} viewport={previewViewport} setViewport={setPreviewViewport} image={imageFor(recordForPreview, previewViewport)} isActuallyDisplayed={isActuallyDisplayed(recordForPreview)} primaryRecord={primaryRecord} displayMode={displayMode} displayCount={previewRecords.length} interval={rotationSeconds} reducedMotion={reducedMotion} previewIndex={previewIndex} previewRef={previewRef} setPreviewPaused={setPreviewPaused} stepPreview={stepPreview} choosePreview={choosePreview} editing /><p className="promo-editor-note">A foto e os textos editados são exibidos juntos nesta simulação. A home pública ainda mantém parte do conteúdo editorial fixo.</p></section>
          </div>
        </> : null}
      </main>
      {message ? <div className="promo-toast" role="status">{message}</div> : null}
    </div>
  );
}

function StorefrontPanel({ record, previewIdentity, viewport, setViewport, image, isActuallyDisplayed, primaryRecord, displayMode, displayCount, interval, reducedMotion, previewIndex, previewRef, setPreviewPaused, stepPreview, choosePreview, editing = false }: {
  record: PromoRecord | PromoDraft | null; previewIdentity: string; viewport: PreviewViewport; setViewport: (value: PreviewViewport) => void; image: string;
  isActuallyDisplayed: boolean; primaryRecord: PromoRecord | null; displayMode: DisplayMode; displayCount: number;
  interval: number; reducedMotion: boolean; previewIndex: number; previewRef: React.RefObject<HTMLElement | null>;
  setPreviewPaused: (value: boolean) => void; stepPreview: (direction: -1 | 1) => void; choosePreview: (index: number) => void; editing?: boolean;
}) {
  const isDraft = Boolean(record && !("id" in record));
  const link = record?.linkUrl.trim() || "/produtos";
  const hasOwnPhoto = Boolean(viewport === "mobile" ? (record?.mobileImageUrl || record?.imageUrl) : record?.imageUrl);
  const total = displayCount;
  const transitionKey = record ? `${"id" in record ? record.id : "draft"}:${record.title}` : "empty";
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    setTransitioning(true);
    const timer = window.setTimeout(() => setTransitioning(false), 240);
    return () => window.clearTimeout(timer);
  }, [transitionKey]);
  return <div className="promo-storefront-wrap">
    <div className="promo-storefront-heading"><div><p className="promo-section-eyebrow">PROPOSTA DE APRESENTAÇÃO</p><h2>Prévia da Home</h2><p>{editing ? "Conteúdo em edição" : displayMode === "single" ? "Modo: destaque único" : "Modo: rotação automática"}</p></div><div className="promo-viewport-switch" role="group" aria-label="Formato da prévia"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")} aria-label="Prévia desktop"><Monitor size={16} /> Desktop</button><button type="button" aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")} aria-label="Prévia mobile"><Smartphone size={16} /> Mobile</button></div></div>
    <div className={`promo-storefront-mode${viewport === "mobile" ? " is-mobile" : ""}${transitioning ? " is-transitioning" : ""}`}>
      {record ? <div className="l4-hero-editorial" ref={previewRef as React.RefObject<HTMLDivElement>} onMouseEnter={() => setPreviewPaused(true)} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setPreviewPaused(false); }} onFocusCapture={() => setPreviewPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(":hover")) setPreviewPaused(false); }}>
        <div className="l4-hero-editorial-frame">
          <div className="l4-hero-editorial-copy"><span className="l4-hero-editorial-badge">{record.badge || "DESTAQUE L4CKOS"}</span><p className="l4-hero-editorial-kicker">L4CKOS · PEÇA EM DESTAQUE</p><h3>{record.title || "Título do destaque"}</h3><p className="l4-hero-editorial-description">{record.description || "A descrição cadastrada aparecerá nesta área."}</p><a href={link} className="l4-hero-editorial-link" onClick={event => event.preventDefault()} aria-label={`${record.ctaLabel || "Ver produto"} (prévia local)`}>{record.ctaLabel || "Ver produto"}<span aria-hidden="true">→</span></a></div>
          <div className="l4-hero-editorial-product"><img src={image || publicHeroFallback} alt={record.imageAlt || record.title || "Produto em destaque"} className="l4-hero-editorial-image" /></div>
        </div>
        {displayMode === "rotation" && !editing && total > 1 ? <div className="promo-rotation-controls" aria-label="Controles da rotação demonstrativa"><button type="button" aria-label="Destaque anterior" onClick={() => stepPreview(-1)}><ArrowLeft size={15} /></button><div className="promo-rotation-dots" aria-label={`Destaque ${previewIndex + 1} de ${total}`}>{Array.from({ length: total }, (_, index) => <button key={index} type="button" aria-label={`Mostrar destaque ${index + 1}`} aria-current={index === previewIndex ? "true" : undefined} onClick={() => choosePreview(index)}><i /></button>)}</div><span>{previewIndex + 1} / {total}</span><button type="button" aria-label="Próximo destaque" onClick={() => stepPreview(1)}><ArrowRight size={15} /></button></div> : null}
      </div> : <div className="promo-storefront-empty">Ative um destaque para visualizar a apresentação da home.</div>}
    </div>
    <div className="promo-storefront-foot"><span>{previewIdentity}</span><span>{viewport === "mobile" && !record?.mobileImageUrl ? "Foto desktop usada como fallback" : hasOwnPhoto ? `Destino: ${link}` : "Sem foto cadastrada · fallback público aplicado"}</span></div>
    <div className="promo-preview-honesty"><span className="promo-honesty-mark" aria-hidden="true" />{isDraft ? "Simulação local do conteúdo em edição; nada será publicado." : isActuallyDisplayed ? "Este registro é o primeiro destaque ativo na home atual. A composição dinâmica é demonstrativa." : `A home atual ainda exibe somente o primeiro ativo${primaryRecord ? ` (#${primaryRecord.id})` : ""}; este conteúdo é uma simulação local.`}</div>
    {displayMode === "rotation" && !editing && total > 1 ? <p className="promo-rotation-note">{reducedMotion ? "Rotação automática pausada pela preferência de movimento reduzido." : `Intervalo local: ${interval}s · pausada ao focar ou apontar para o conteúdo.`}</p> : null}
  </div>;
}

function MediaField({ label, src, fallback, onUrlChange, onFile, onRemove, inputValue, placeholder, mobileFallback = false }: {
  label: string; src: string; fallback: string; onUrlChange: (value: string) => void; onFile: (file?: File) => void;
  onRemove: () => void; inputValue: string; placeholder: string; mobileFallback?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className="promo-media-field"><div className="promo-media-title"><span>{label}</span>{mobileFallback ? <small>Usa a foto desktop</small> : src ? <small>Imagem selecionada</small> : <small>Sem imagem própria</small>}</div>
    <div className="promo-media-image">{src ? <img src={src} alt={`Visualização ${label.toLowerCase()}`} /> : <div className="promo-media-empty"><ImagePlus size={20} /><span>Nenhuma foto selecionada</span></div>}</div>
    {mobileFallback ? <p className="promo-media-fallback-note">Na prévia mobile, a foto desktop será usada até você escolher outra.</p> : null}
    <label className="promo-media-url"><span className="sr-only">Endereço da {label.toLowerCase()}</span><input value={inputValue} onChange={event => onUrlChange(event.target.value)} placeholder={placeholder} aria-label={`Endereço da ${label.toLowerCase()}`} /></label>
    <div className="promo-media-actions"><label className="promo-file-button"><ImagePlus size={15} /> Escolher imagem<input ref={inputRef} type="file" accept="image/*" onChange={event => { onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} aria-label={`Enviar ${label.toLowerCase()} local`} /></label><button type="button" disabled={!src} onClick={() => { onRemove(); if (inputRef.current) inputRef.current.value = ""; }}>Remover</button></div>
    <span className="sr-only" aria-live="polite">{mobileFallback ? "Imagem mobile ausente. A imagem desktop será usada como fallback." : ""}</span>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
