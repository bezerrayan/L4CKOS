import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Image as ImageIcon, Search, Star, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminReviewsPanel, type AdminReviewRecord } from "../components/admin/reviews/AdminReviewsPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminReviewsVisualPreview.css";

type ModerationStatus = "published" | "hidden_spam" | "hidden_offensive";
type ImageStatus = "none" | "pending" | "approved" | "rejected";
type Review = {
  id: number; productId: number; productName: string; userName: string; userEmail: string;
  orderId: number | null; rating: number; comment: string | null;
  sizePerception: "small" | "true_to_size" | "large" | null; imageUrl: string | null;
  imageStatus: ImageStatus; moderationStatus: ModerationStatus; verifiedPurchase: boolean; createdAt: string;
};
type Filter = "all" | ModerationStatus | "photo_pending";

const fixtures: Review[] = [
  { id: 482, productId: 142, productName: "Camiseta Clã 14 Bis", userName: "Marina Costa", userEmail: "marina.costa@example.test", orderId: 3186, rating: 5, comment: "A estampa ficou muito bonita e o tecido é confortável. O caimento correspondeu ao tamanho que costumo usar.", sizePerception: "true_to_size", imageUrl: "/images/hero/camiseta-cla-14-bis-recorte.png", imageStatus: "pending", moderationStatus: "published", verifiedPurchase: true, createdAt: "2026-10-18T14:32:00-03:00" },
  { id: 481, productId: 138, productName: "Camiseta Ritmo Noturno", userName: "Rafael Nogueira", userEmail: "rafael.nogueira@example.test", orderId: 3181, rating: 4, comment: "Boa qualidade e chegou bem embalada. A manga ficou um pouco mais justa do que eu esperava.", sizePerception: "small", imageUrl: null, imageStatus: "none", moderationStatus: "published", verifiedPurchase: true, createdAt: "2026-10-17T10:05:00-03:00" },
  { id: 480, productId: 142, productName: "Camiseta Clã 14 Bis", userName: "Camila Freire", userEmail: "camila.freire@example.test", orderId: 3160, rating: 5, comment: "Produto excelente. A estampa e o acabamento são muito bons.", sizePerception: "true_to_size", imageUrl: "/images/hero/camiseta-cla-14-bis-recorte.png", imageStatus: "approved", moderationStatus: "published", verifiedPurchase: true, createdAt: "2026-10-15T18:47:00-03:00" },
  { id: 479, productId: 131, productName: "Camiseta Horizonte", userName: "Bruno Almeida", userEmail: "bruno.almeida@example.test", orderId: null, rating: 2, comment: "Texto demonstrativo sinalizado para revisão da equipe.", sizePerception: null, imageUrl: null, imageStatus: "none", moderationStatus: "hidden_offensive", verifiedPurchase: false, createdAt: "2026-10-14T09:20:00-03:00" },
  { id: 478, productId: 138, productName: "Camiseta Ritmo Noturno", userName: "Joana Martins", userEmail: "joana.martins@example.test", orderId: 3132, rating: 3, comment: "A descrição corresponde ao produto. Meu pedido chegou dentro do prazo.", sizePerception: "large", imageUrl: null, imageStatus: "none", moderationStatus: "hidden_spam", verifiedPurchase: true, createdAt: "2026-10-12T16:11:00-03:00" },
  { id: 477, productId: 125, productName: "Camiseta Linha de Frente", userName: "Pedro Ribeiro", userEmail: "pedro.ribeiro@example.test", orderId: 3104, rating: 5, comment: null, sizePerception: null, imageUrl: null, imageStatus: "none", moderationStatus: "published", verifiedPurchase: true, createdAt: "2026-10-10T11:00:00-03:00" },
];

const navGroups = [
  { heading: "Visão geral", items: ["Dashboard / KPIs"] },
  { heading: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { heading: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { heading: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];
const statusLabel: Record<ModerationStatus, string> = { published: "Publicada", hidden_spam: "Oculta por spam", hidden_offensive: "Oculta por conteúdo ofensivo" };
const imageLabel: Record<ImageStatus, string> = { none: "Sem foto", pending: "Foto aguardando análise", approved: "Foto aprovada", rejected: "Foto rejeitada" };
const sizeLabel = { small: "Vestiu pequeno", true_to_size: "Tamanho ideal", large: "Vestiu grande" };
const filterLabels: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Todas" }, { value: "published", label: "Publicadas" },
  { value: "hidden_spam", label: "Ocultas · spam" }, { value: "hidden_offensive", label: "Ocultas · conteúdo ofensivo" },
  { value: "photo_pending", label: "Foto pendente" },
];
const dateLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function Stars({ value }: { value: number }) {
  return <span className="reviews-stars" aria-label={`${value} de 5 estrelas`}><span aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} fill={n <= value ? "currentColor" : "none"} />)}</span><strong>{value}/5</strong></span>;
}

export default function AdminReviewsVisualPreview() {
  const [reviews, setReviews] = useState(fixtures);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const mobile = useIsMobile(900);
  const menuRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const liveFilter = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return reviews.filter(review => {
      const searchMatch = !query || [review.productName, review.userName, review.userEmail, review.comment ?? "", String(review.id), String(review.productId)].some(item => item.toLocaleLowerCase("pt-BR").includes(query));
      const filterMatch = filter === "all" || (filter === "photo_pending" ? review.imageStatus === "pending" : review.moderationStatus === filter);
      const ratingMatch = ratingFilter === "all" || review.rating === Number(ratingFilter);
      return searchMatch && filterMatch && ratingMatch;
    });
  }, [filter, ratingFilter, reviews, search]);
  const counts = useMemo(() => Object.fromEntries(filterLabels.map(item => [item.value, reviews.filter(review => item.value === "all" || (item.value === "photo_pending" ? review.imageStatus === "pending" : review.moderationStatus === item.value)).length])) as Record<Filter, number>, [reviews]);
  const selected = reviews.find(review => review.id === selectedId) ?? null;

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("[aria-current=page]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuTriggerRef.current?.focus(); }
      if (event.key === "Tab" && menuRef.current) {
        const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [menuOpen, mobile]);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    detailRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetails();
      if (event.key === "Tab" && detailRef.current) {
        const items = Array.from(detailRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])"));
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  // closeDetails is intentionally recreated; selection controls lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function closeDetails() {
    setSelectedId(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }
  function updateSelected(change: Partial<Pick<Review, "moderationStatus" | "imageStatus">>, label: string) {
    if (!selected) return;
    setReviews(current => current.map(review => review.id === selected.id ? { ...review, ...change } : review));
    setNotice(`${label} simulada localmente. Nenhuma alteração foi publicada.`);
  }

  const summary = [
    { label: "Avaliações", value: reviews.length },
    { label: "Publicadas", value: reviews.filter(review => review.moderationStatus === "published").length },
    { label: "Ocultas", value: reviews.filter(review => review.moderationStatus !== "published").length },
    { label: "Fotos pendentes", value: reviews.filter(review => review.imageStatus === "pending").length },
  ];

  if (new URLSearchParams(window.location.search).get("integration-panel") === "1") {
    const mockState = new URLSearchParams(window.location.search).get("state");
    const mockReviews: AdminReviewRecord[] = reviews.map(review => ({
      ...review,
      imageUrl: review.imageUrl ? `${window.location.origin}${review.imageUrl}` : null,
      verifiedPurchase: review.verifiedPurchase ? 1 : 0,
    }));
    return <div className="l4-orders-preview l4-reviews-preview">
      {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
      <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="reviews-preview-navigation" ref={menuRef} aria-label="Navegação administrativa">
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA DE INTEGRAÇÃO</small></div>
        <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
        <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item === "Avaliações" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
        <AdminSidebarProfile name="Administradora de demonstração" email="admin.demo@example.test" preview />
      </aside>
      <main className="orders-main-column">
        <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="reviews-preview-navigation" onClick={() => setMenuOpen(true)}><span aria-hidden="true">☰</span> Menu administrativo</button>
        <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Componente Avaliações integrado</span><span className="orders-preview-fake-label">MOCK LOCAL · SEM API</span></div>
        <AdminReviewsPanel
          reviews={mockState === "empty" ? [] : mockReviews}
          initialSelectedReviewId={Number(new URLSearchParams(window.location.search).get("details")) || null}
          isLoading={mockState === "loading"}
          isError={mockState === "error"}
          onRetry={() => window.location.reload()}
          onModerate={async input => {
            if (mockState === "moderation-error") throw new Error("Falha de demonstração; nenhuma alteração foi feita.");
            setReviews(current => current.map(review => review.id === input.reviewId ? {
              ...review,
              ...(input.moderationStatus ? { moderationStatus: input.moderationStatus } : {}),
              ...(input.imageStatus ? { imageStatus: input.imageStatus } : {}),
            } : review));
          }}
          onOpenOrder={orderId => setNotice(`Pedido fictício #${orderId} · nenhuma consulta foi realizada.`)}
          onOpenProduct={(productId, productName) => setNotice(`${productName} · produto fictício #${productId}.`)}
        />
      </main>
    </div>;
  }

  return <div className="l4-orders-preview l4-reviews-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="reviews-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={Boolean(selected) || (mobile && !menuOpen)}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA VISUAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item === "Avaliações" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>

    <main className="orders-main-column" inert={Boolean(selected)}>
      <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="reviews-preview-navigation" onClick={() => setMenuOpen(true)}><span aria-hidden="true">☰</span> Menu administrativo</button>
      <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Prévia de Avaliações</span><span className="orders-preview-fake-label">AMBIENTE LOCAL · DADOS FICTÍCIOS</span></div>
      <header className="orders-preview-heading reviews-heading"><div><p className="orders-preview-eyebrow">Comercial · Moderação</p><h1>Avaliações de Produtos</h1><p>Consulte as avaliações e modere a publicação e as fotos anexadas.</p></div></header>

      <section className="reviews-summary" aria-label="Resumo das avaliações">{summary.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</section>
      <section className="reviews-list-section" aria-labelledby="reviews-list-title">
        <div className="reviews-list-head"><div><h2 id="reviews-list-title">Avaliações recebidas</h2><span aria-live="polite">{liveFilter.length} de {reviews.length} avaliações</span></div>
          <label className="reviews-search"><span className="reviews-search-icon" aria-hidden="true"><Search size={17} /></span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por produto, autor ou texto" aria-label="Buscar avaliações" />{search && <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}><X size={16} /></button>}</label>
          <div className="reviews-rating-filter"><span>Nota</span><Select value={ratingFilter} onValueChange={setRatingFilter}><SelectTrigger aria-label="Filtrar por nota" className="reviews-select-trigger"><SelectValue /></SelectTrigger><SelectContent className="reviews-select-content">{["all", "5", "4", "3", "2", "1"].map(value => <SelectItem key={value} value={value} className="reviews-select-item">{value === "all" ? "Todas" : `${value} ${value === "1" ? "estrela" : "estrelas"}`}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="reviews-filters" role="group" aria-label="Filtrar avaliações">{filterLabels.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{counts[item.value]}</span></button>)}</div>
        <div className="reviews-table-wrap">
          <div className="reviews-table-head" aria-hidden="true"><span>Produto / autor</span><span>Avaliação</span><span>Data</span><span>Situação</span><span /></div>
          {liveFilter.map(review => <article className="reviews-row" key={review.id}>
            <div className="reviews-product"><span><strong>{review.productName}</strong><small>{review.userName} · #{review.id}{review.verifiedPurchase ? " · Compra verificada" : " · Não verificada"}</small></span></div>
            <div className="reviews-row-rating"><Stars value={review.rating} /><p>{review.comment || "Sem comentário escrito"}</p></div>
            <time className="reviews-row-date" dateTime={review.createdAt}>{dateLabel(review.createdAt)}</time>
            <div className="reviews-state-cell"><span className={`reviews-state reviews-state--${review.moderationStatus}`}><i aria-hidden="true" />{statusLabel[review.moderationStatus]}</span>{review.imageStatus === "pending" ? <small>Foto pendente</small> : null}</div>
            <button className="reviews-view" type="button" ref={element => { if (selectedId === review.id && element) detailTriggerRef.current = element; }} aria-expanded={selectedId === review.id} aria-controls="review-details" onClick={event => { detailTriggerRef.current = event.currentTarget; setSelectedId(review.id); }}>Ver detalhes <ChevronRight size={16} aria-hidden="true" /></button>
          </article>)}
          {!liveFilter.length ? <div className="reviews-empty">Nenhuma avaliação corresponde à busca e aos filtros selecionados.</div> : null}
        </div>
        <p className="reviews-preview-note">Busca, filtros e moderação são demonstrativos e afetam somente estas fixtures locais.</p>
      </section>
      {notice ? <p className="reviews-live-note" role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dispensar mensagem"><X size={15} /></button></p> : null}
    </main>

    {selected ? <>
      <button type="button" className="reviews-backdrop" aria-label="Fechar detalhes da avaliação" onClick={closeDetails} />
      <aside ref={detailRef} id="review-details" className="reviews-detail" role="dialog" aria-modal="true" aria-labelledby="review-detail-title" tabIndex={-1}>
        <header className="reviews-detail-header"><div><span>DETALHE DA AVALIAÇÃO</span><h2 id="review-detail-title">Avaliação #{selected.id}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={closeDetails}><X size={19} /></button></header>
        <div className="reviews-detail-scroll">
          <section className="reviews-detail-product"><div><span>PRODUTO AVALIADO</span><strong>{selected.productName}</strong><small>Produto #{selected.productId}</small></div><span className={`reviews-state reviews-state--${selected.moderationStatus}`}><i aria-hidden="true" />{statusLabel[selected.moderationStatus]}</span></section>
          <section className="reviews-detail-block"><h3>Avaliação</h3><Stars value={selected.rating} /><blockquote>{selected.comment || "O cliente não escreveu um comentário."}</blockquote>{selected.sizePerception ? <p className="reviews-detail-meta">Tamanho: <strong>{sizeLabel[selected.sizePerception]}</strong></p> : null}<p className="reviews-detail-meta">Criada em <time dateTime={selected.createdAt}>{dateLabel(selected.createdAt)}</time></p><p className="reviews-public-visibility">{selected.moderationStatus !== "published" ? "Oculta na loja." : !selected.verifiedPurchase ? "Publicada, mas não aparece na loja porque a compra não está verificada." : "Publicada e elegível para exibição no produto."}</p></section>
          <section className="reviews-detail-block"><h3>Autor e compra</h3><dl><div><dt>Cliente</dt><dd>{selected.userName}</dd></div><div><dt>E-mail</dt><dd>{selected.userEmail}</dd></div><div><dt>Verificação</dt><dd>{selected.verifiedPurchase ? "Compra verificada" : "Compra não verificada"}</dd></div>{selected.orderId ? <div><dt>Pedido relacionado</dt><dd>#{selected.orderId}</dd></div> : null}</dl></section>
          <section className="reviews-detail-block reviews-detail-block--photo"><div className="reviews-detail-section-title"><div><span className="reviews-detail-kicker">MODERAÇÃO DA FOTO</span><h3>Foto anexada</h3></div><span className={`reviews-photo-state reviews-photo-state--${selected.imageStatus}`}><i aria-hidden="true" />{imageLabel[selected.imageStatus]}</span></div>
            {selected.imageUrl ? <figure className="reviews-photo"><img src={selected.imageUrl} alt="Imagem fictícia do produto Clã 14 Bis anexada à avaliação" /><figcaption>Imagem fictícia · Clã 14 Bis</figcaption></figure> : <p className="reviews-no-photo"><ImageIcon size={17} />Nenhuma foto enviada</p>}
            {selected.imageStatus === "pending" && selected.imageUrl ? <div className="reviews-actions"><button type="button" className="reviews-button reviews-button--primary" onClick={() => updateSelected({ imageStatus: "approved" }, "Aprovação da foto")}>Aprovar foto</button><button type="button" className="reviews-button" onClick={() => updateSelected({ imageStatus: "rejected" }, "Rejeição da foto")}>Rejeitar foto</button></div> : null}
          </section>
          <section className="reviews-detail-block reviews-detail-block--publication"><div className="reviews-detail-section-title"><div><span className="reviews-detail-kicker">MODERAÇÃO DA AVALIAÇÃO</span><h3>Publicação da avaliação</h3></div><span className={`reviews-state reviews-state--${selected.moderationStatus}`}><i aria-hidden="true" />{statusLabel[selected.moderationStatus]}</span></div><p className="reviews-moderation-help">Este estado é independente da análise da foto.</p>
            {selected.moderationStatus === "published" ? <div className="reviews-actions reviews-actions--stack"><button type="button" className="reviews-button" onClick={() => updateSelected({ moderationStatus: "hidden_spam" }, "Ocultação por spam")}>Ocultar como spam</button><button type="button" className="reviews-button reviews-button--danger" onClick={() => updateSelected({ moderationStatus: "hidden_offensive" }, "Ocultação por conteúdo ofensivo")}>Ocultar por conteúdo ofensivo</button></div> : <button type="button" className="reviews-button reviews-button--primary" onClick={() => updateSelected({ moderationStatus: "published" }, "Republicação")}>Republicar avaliação</button>}
          </section>
          <p className="reviews-detail-local">Prévia local · ações simuladas, sem publicação real.</p>
          {selected.orderId ? <p className="reviews-detail-link">Pedido relacionado <span>#{selected.orderId} · Somente referência nesta prévia</span></p> : null}
        </div>
      </aside>
    </> : null}
  </div>;
}
