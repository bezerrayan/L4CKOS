import { useMemo, useState } from "react";
import { ExternalLink, Image as ImageIcon, Search, Star, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiUrl } from "../../../const";
import { AdminEmptyState, AdminLoadingState, AdminSurface } from "../AdminUI";
import "./AdminReviewsPanel.css";

export type AdminReviewModerationStatus = "published" | "hidden_spam" | "hidden_offensive";
export type AdminReviewImageStatus = "none" | "pending" | "approved" | "rejected";
export type AdminReviewRecord = {
  id: number;
  productId: number;
  productName: string | null;
  userName: string | null;
  userEmail: string | null;
  orderId: number | null;
  rating: number;
  comment: string | null;
  sizePerception: "small" | "true_to_size" | "large" | null;
  imageUrl: string | null;
  imageStatus: AdminReviewImageStatus;
  moderationStatus: AdminReviewModerationStatus;
  verifiedPurchase: number;
  createdAt: Date | string;
  moderatedAt?: Date | string | null;
};

export type AdminReviewModerationInput = {
  reviewId: number;
  moderationStatus?: AdminReviewModerationStatus;
  imageStatus?: "approved" | "rejected";
};

type ReviewFilter = "all" | AdminReviewModerationStatus | "photo_pending";
type AdminReviewsPanelProps = {
  reviews?: AdminReviewRecord[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isPending?: boolean;
  pendingReviewId?: number;
  initialSelectedReviewId?: number | null;
  onModerate?: (input: AdminReviewModerationInput) => Promise<void>;
  onOpenOrder: (orderId: number) => void;
  onOpenProduct: (productId: number, productName: string) => void;
};

const statusLabels: Record<AdminReviewModerationStatus, string> = {
  published: "Publicada",
  hidden_spam: "Oculta por spam",
  hidden_offensive: "Oculta por conteúdo ofensivo",
};
const imageLabels: Record<AdminReviewImageStatus, string> = {
  none: "Ausente",
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
};
const sizeLabels = { small: "Vestiu pequeno", true_to_size: "Tamanho ideal", large: "Vestiu grande" } as const;
const filterLabels: Array<{ value: ReviewFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "published", label: "Publicadas" },
  { value: "hidden_spam", label: "Ocultas · spam" },
  { value: "hidden_offensive", label: "Ocultas · conteúdo ofensivo" },
  { value: "photo_pending", label: "Foto pendente" },
];

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function dateTimeValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function resolveImageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return apiUrl(value.startsWith("/") ? value : `/${value}`);
}

function Stars({ value }: { value: number }) {
  return <span className="admin-reviews__stars" aria-label={`${value} de 5 estrelas`}>
    <span aria-hidden="true">{[1, 2, 3, 4, 5].map(star => <Star key={star} size={16} fill={star <= value ? "currentColor" : "none"} />)}</span>
    <strong>{value}/5</strong>
  </span>;
}

function filterReview(review: AdminReviewRecord, filter: ReviewFilter) {
  if (filter === "all") return true;
  if (filter === "photo_pending") return review.imageStatus === "pending";
  return review.moderationStatus === filter;
}

export function AdminReviewsPanel({
  reviews: reviewData,
  isLoading = false,
  isError = false,
  onRetry,
  isPending = false,
  pendingReviewId,
  initialSelectedReviewId = null,
  onModerate,
  onOpenOrder,
  onOpenProduct,
}: AdminReviewsPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedReviewId);
  const [actionFeedback, setActionFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingModeration, setPendingModeration] = useState<{ input: AdminReviewModerationInput; message: string } | null>(null);
  const reviews = reviewData ?? [];
  const hasData = reviewData !== undefined;

  const searchedReviews = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return reviews.filter(review => !query || [
      review.productName,
      review.userName,
      review.userEmail,
      review.comment,
      String(review.id),
      String(review.productId),
    ].some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(query)));
  }, [reviews, search]);

  const visibleReviews = useMemo(() => searchedReviews.filter(review => filterReview(review, filter)), [filter, searchedReviews]);
  const filterCounts = useMemo(() => Object.fromEntries(filterLabels.map(item => [
    item.value,
    searchedReviews.filter(review => filterReview(review, item.value)).length,
  ])) as Record<ReviewFilter, number>, [searchedReviews]);
  const selected = reviews.find(review => review.id === selectedId) ?? null;
  const pendingImages = reviews.filter(review => review.imageStatus === "pending").length;
  const published = reviews.filter(review => review.moderationStatus === "published").length;
  const hidden = reviews.length - published;
  const currentActionPending = Boolean(selected && isPending && pendingReviewId === selected.id);
  const productName = (review: AdminReviewRecord) => review.productName || `Produto #${review.productId}`;

  function requestModeration(input: AdminReviewModerationInput, message: string) {
    if (!onModerate || isPending) return;
    setActionError("");
    setActionFeedback("");
    setPendingModeration({ input, message });
  }

  async function confirmModeration() {
    if (!onModerate || !pendingModeration || isPending) return;
    setActionError("");
    setActionFeedback("");
    try {
      await onModerate(pendingModeration.input);
      setActionFeedback("A moderação foi atualizada.");
      setPendingModeration(null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Não foi possível concluir a moderação.";
      setActionError(messageText);
      setPendingModeration(null);
    }
  }

  return (
    <div className="admin-reviews">
      <header className="admin-reviews__heading">
        <div><p>Comercial · Moderação</p><h1>Avaliações de Produtos</h1><span>Consulte as avaliações e modere a publicação e as fotos anexadas.</span></div>
      </header>

      <section className="admin-reviews__summary" aria-label="Resumo das avaliações">
        {[
          ["Avaliações", reviews.length],
          ["Publicadas", published],
          ["Ocultas", hidden],
          ["Fotos pendentes", pendingImages],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{isLoading || (!hasData && isError) ? "—" : value}</strong></div>)}
      </section>

      <AdminSurface title="Avaliações recebidas" description="A publicação e a análise da fotografia são estados independentes.">
        <div className="admin-reviews__controls">
          <span aria-live="polite">{visibleReviews.length} de {searchedReviews.length} avaliações</span>
          <label className="admin-reviews__search"><Search size={17} aria-hidden="true" /><input aria-label="Buscar por produto, autor, texto ou ID" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por produto, autor, texto ou ID" />{search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}><X size={16} /></button> : null}</label>
        </div>
        <div className="admin-reviews__filters" role="group" aria-label="Filtrar avaliações">
          {filterLabels.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{hasData ? filterCounts[item.value] : "—"}</span></button>)}
        </div>
        <p className="admin-reviews__filter-note">Busca e filtros são aplicados à lista carregada; a consulta atual não oferece paginação.</p>

        {isLoading ? <AdminLoadingState>Carregando avaliações…</AdminLoadingState> : null}
        {isError ? <div className="admin-reviews__query-error" role="alert"><div><strong>Não foi possível consultar as avaliações.</strong><span>{hasData ? "Os registros exibidos podem estar desatualizados." : "Nenhum estado de moderação foi presumido."}</span></div>{onRetry ? <button type="button" onClick={onRetry}>Tentar novamente</button> : null}</div> : null}
        {!isLoading && !isError && hasData && reviews.length === 0 ? <AdminEmptyState title="Nenhuma avaliação recebida" description="Avaliações disponíveis para moderação aparecerão aqui." /> : null}

        {!isLoading && (hasData || isError) && reviews.length > 0 ? <div className="admin-reviews__list">
          {visibleReviews.map(review => {
            const pending = isPending && pendingReviewId === review.id;
            return <article className="admin-reviews__row" key={review.id}>
              <div className="admin-reviews__product"><strong>{productName(review)}</strong><span>{review.userName || "Cliente não identificado"} · Avaliação #{review.id}</span></div>
              <div className="admin-reviews__rating"><Stars value={review.rating} /><p>{review.comment || "Sem comentário escrito"}</p></div>
              <time className="admin-reviews__date" dateTime={dateTimeValue(review.createdAt)}>{formatDate(review.createdAt)}</time>
              <div className="admin-reviews__states"><span className={`admin-reviews__state admin-reviews__state--${review.moderationStatus}`}><i aria-hidden="true" />{statusLabels[review.moderationStatus]}</span><span className={`admin-reviews__photo-state admin-reviews__photo-state--${review.imageStatus}`}><i aria-hidden="true" />Foto: {imageLabels[review.imageStatus]}</span></div>
              <button className="admin-reviews__view" type="button" aria-expanded={selectedId === review.id} aria-controls="admin-review-details" disabled={pending} onClick={() => { setActionError(""); setActionFeedback(""); setSelectedId(review.id); }}>Ver detalhes</button>
            </article>;
          })}
          {!visibleReviews.length ? <div className="admin-reviews__empty">Nenhuma avaliação corresponde à busca e aos filtros selecionados.</div> : null}
        </div> : null}
      </AdminSurface>

      <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !currentActionPending && !pendingModeration) { setSelectedId(null); setActionError(""); } }}>
        {selected ? <DialogContent id="admin-review-details" className="admin-reviews__dialog" showCloseButton={false} aria-describedby="admin-review-dialog-description" onOpenAutoFocus={event => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("button[aria-label='Fechar detalhes da avaliação']")?.focus();
        }}>
          <DialogHeader className="admin-reviews__dialog-header">
            <div><span>DETALHE DA AVALIAÇÃO</span><DialogTitle>Avaliação #{selected.id}</DialogTitle><DialogDescription id="admin-review-dialog-description">Detalhes e ações administrativas disponíveis para este registro.</DialogDescription></div>
            <button type="button" aria-label="Fechar detalhes da avaliação" onClick={() => setSelectedId(null)}><X size={18} /></button>
          </DialogHeader>
          <div className="admin-reviews__dialog-scroll">
            <section className="admin-reviews__detail-product"><div><span>PRODUTO AVALIADO</span><strong>{productName(selected)}</strong><small>Produto #{selected.productId}</small></div><span className={`admin-reviews__state admin-reviews__state--${selected.moderationStatus}`}><i aria-hidden="true" />{statusLabels[selected.moderationStatus]}</span></section>
            <section className="admin-reviews__detail-block"><h3>Avaliação</h3><Stars value={selected.rating} /><blockquote>{selected.comment || "O cliente não escreveu um comentário."}</blockquote>{selected.sizePerception ? <p className="admin-reviews__meta">Tamanho: <strong>{sizeLabels[selected.sizePerception]}</strong></p> : null}<p className="admin-reviews__meta">Criada em <time dateTime={dateTimeValue(selected.createdAt)}>{formatDate(selected.createdAt)}</time></p>{selected.moderatedAt ? <p className="admin-reviews__meta">Moderação registrada em <time dateTime={dateTimeValue(selected.moderatedAt)}>{formatDate(selected.moderatedAt)}</time></p> : null}
              <p className="admin-reviews__visibility">{selected.moderationStatus !== "published" ? "Oculta na loja." : selected.verifiedPurchase !== 1 ? "Publicada, mas não aparece na loja porque a compra não está verificada." : "Publicada e elegível para exibição. A fotografia só aparece quando também está aprovada."}</p>
            </section>
            <section className="admin-reviews__detail-block"><h3>Autor e compra</h3><dl><div><dt>Cliente</dt><dd>{selected.userName || "Não identificado"}</dd></div>{selected.userEmail ? <div><dt>E-mail</dt><dd>{selected.userEmail}</dd></div> : null}<div><dt>Verificação</dt><dd>{selected.verifiedPurchase === 1 ? "Compra verificada" : "Compra não verificada"}</dd></div>{selected.orderId ? <div><dt>Pedido relacionado</dt><dd><button type="button" className="admin-reviews__text-link" onClick={() => onOpenOrder(selected.orderId as number)}>Abrir pedido #{selected.orderId}</button></dd></div> : null}</dl></section>
            <section className="admin-reviews__detail-block admin-reviews__photo-block"><div className="admin-reviews__section-title"><div><span>MODERAÇÃO DA FOTO</span><h3>Fotografia anexada</h3></div><span className={`admin-reviews__photo-state admin-reviews__photo-state--${selected.imageStatus}`}><i aria-hidden="true" />{imageLabels[selected.imageStatus]}</span></div>
              {selected.imageUrl ? <a className="admin-reviews__image-link" href={resolveImageUrl(selected.imageUrl)} target="_blank" rel="noreferrer"><img src={resolveImageUrl(selected.imageUrl)} alt={`Foto anexada à avaliação do produto ${productName(selected)}`} loading="lazy" decoding="async" /><span><ExternalLink size={14} aria-hidden="true" />Abrir foto</span></a> : <p className="admin-reviews__no-photo"><ImageIcon size={17} aria-hidden="true" />Nenhuma foto enviada</p>}
              {selected.imageStatus === "pending" && selected.imageUrl ? <div className="admin-reviews__actions"><button type="button" className="is-primary" disabled={isPending || !onModerate} onClick={() => void requestModeration({ reviewId: selected.id, imageStatus: "approved" }, "Aprovar a fotografia anexada a esta avaliação?")}>{currentActionPending ? "Processando…" : "Aprovar foto"}</button><button type="button" disabled={isPending || !onModerate} onClick={() => void requestModeration({ reviewId: selected.id, imageStatus: "rejected" }, "Rejeitar a fotografia anexada? A situação da avaliação não será alterada.")}>Rejeitar foto</button></div> : null}
            </section>
            <section className="admin-reviews__detail-block admin-reviews__publication-block"><div className="admin-reviews__section-title"><div><span>MODERAÇÃO DA AVALIAÇÃO</span><h3>Publicação</h3></div><span className={`admin-reviews__state admin-reviews__state--${selected.moderationStatus}`}><i aria-hidden="true" />{statusLabels[selected.moderationStatus]}</span></div><p className="admin-reviews__moderation-help">A situação de publicação não altera o estado da fotografia.</p>
              {selected.moderationStatus === "published" ? <div className="admin-reviews__actions admin-reviews__actions--stack"><button type="button" disabled={isPending || !onModerate} onClick={() => void requestModeration({ reviewId: selected.id, moderationStatus: "hidden_spam" }, "Ocultar esta avaliação por spam?")}>Ocultar como spam</button><button type="button" className="is-danger" disabled={isPending || !onModerate} onClick={() => void requestModeration({ reviewId: selected.id, moderationStatus: "hidden_offensive" }, "Ocultar esta avaliação por conteúdo ofensivo?")}>Ocultar por conteúdo ofensivo</button></div> : <button type="button" className="admin-reviews__republish" disabled={isPending || !onModerate} onClick={() => void requestModeration({ reviewId: selected.id, moderationStatus: "published" }, "Republicar esta avaliação na loja quando elegível?")}>{currentActionPending ? "Processando…" : "Republicar avaliação"}</button>}
            </section>
            {actionError ? <p className="admin-reviews__action-message is-error" role="alert">{actionError}</p> : null}
            {actionFeedback ? <p className="admin-reviews__action-message" role="status">{actionFeedback}</p> : null}
            {selected.orderId ? <p className="admin-reviews__related-link">Pedido relacionado · <button type="button" onClick={() => onOpenOrder(selected.orderId as number)}>#{selected.orderId}</button></p> : null}
            <button type="button" className="admin-reviews__product-link" onClick={() => onOpenProduct(selected.productId, productName(selected))}>Abrir produto na gestão</button>
          </div>
        </DialogContent> : null}
      </Dialog>

      <AlertDialog open={Boolean(pendingModeration)} onOpenChange={open => { if (!open && !isPending) setPendingModeration(null); }}>
        {pendingModeration ? <AlertDialogContent className="admin-reviews__confirm" onEscapeKeyDown={event => { if (isPending) event.preventDefault(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar moderação</AlertDialogTitle>
            <AlertDialogDescription>{pendingModeration.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <button type="button" disabled={isPending} onClick={() => setPendingModeration(null)}>Cancelar</button>
            <button type="button" className="is-primary" disabled={isPending} onClick={() => void confirmModeration()}>{isPending ? "Processando…" : "Confirmar"}</button>
          </AlertDialogFooter>
        </AlertDialogContent> : null}
      </AlertDialog>
    </div>
  );
}
