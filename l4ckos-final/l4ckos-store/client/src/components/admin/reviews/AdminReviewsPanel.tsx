import type { ChangeEvent, ReactNode } from "react";
import { apiUrl } from "../../../const";
import { AdminEmptyState, AdminSurface } from "../AdminUI";
import "./AdminReviewsPanel.css";

type ModerationStatus = "published" | "hidden_spam" | "hidden_offensive";
type ImageStatus = "none" | "pending" | "approved" | "rejected";

export type AdminReview = {
  id: number;
  productId: number;
  productName?: string | null;
  userName?: string | null;
  rating: number;
  comment?: string | null;
  sizePerception?: "small" | "true_to_size" | "large" | null;
  verifiedPurchase: number;
  moderationStatus: ModerationStatus;
  imageUrl?: string | null;
  imageStatus: ImageStatus;
  createdAt: Date | string;
};

export type AdminReviewFilters = {
  moderationStatus: "" | ModerationStatus;
  imageStatus: "" | ImageStatus;
  verifiedPurchase: "" | "verified" | "legacy";
  productId: string;
};

type Props = {
  reviews: AdminReview[];
  filters: AdminReviewFilters;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  pendingReviewId?: number;
  onFiltersChange: (next: AdminReviewFilters) => void;
  onLoadMore: () => void;
  onModerate: (review: AdminReview, update: { moderationStatus?: ModerationStatus; imageStatus?: "approved" | "rejected" }) => void;
};

const moderationLabel: Record<ModerationStatus, string> = {
  published: "Publicada",
  hidden_spam: "Oculta por spam",
  hidden_offensive: "Oculta por conteúdo ofensivo",
};
const imageLabel: Record<ImageStatus, string> = {
  none: "Sem foto",
  pending: "Foto pendente",
  approved: "Foto aprovada",
  rejected: "Foto rejeitada",
};
const sizeLabel: Record<NonNullable<AdminReview["sizePerception"]>, string> = {
  small: "Vestiu pequeno",
  true_to_size: "Tamanho ideal",
  large: "Vestiu grande",
};

function imageSrc(imageUrl: string) {
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : apiUrl(imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`);
}

function updateFilters(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>, filters: AdminReviewFilters, onChange: Props["onFiltersChange"]) {
  onChange({ ...filters, [event.target.name]: event.target.value });
}

function Stars({ rating }: { rating: number }) {
  return <span aria-label={`${rating} de 5 estrelas`}>{"★".repeat(rating)}{"☆".repeat(Math.max(0, 5 - rating))}</span>;
}

export function AdminReviewsPanel({ reviews, filters, loading, loadingMore, hasMore, pendingReviewId, onFiltersChange, onLoadMore, onModerate }: Props) {
  const pendingImages = reviews.filter(review => review.imageStatus === "pending").length;
  const hidden = reviews.filter(review => review.moderationStatus !== "published").length;

  return (
    <AdminSurface title="Avaliações" description="Modere a publicação e as imagens sem alterar a nota ou o comentário enviado pelo cliente.">
      <div className="l4-admin-reviews__filters">
        <select name="moderationStatus" value={filters.moderationStatus} onChange={event => updateFilters(event, filters, onFiltersChange)}>
          <option value="">Todas as publicações</option><option value="published">Publicadas</option><option value="hidden_spam">Ocultas por spam</option><option value="hidden_offensive">Ocultas por conteúdo ofensivo</option>
        </select>
        <select name="imageStatus" value={filters.imageStatus} onChange={event => updateFilters(event, filters, onFiltersChange)}>
          <option value="">Todos os estados de imagem</option><option value="none">Sem foto</option><option value="pending">Foto pendente</option><option value="approved">Foto aprovada</option><option value="rejected">Foto rejeitada</option>
        </select>
        <select name="verifiedPurchase" value={filters.verifiedPurchase} onChange={event => updateFilters(event, filters, onFiltersChange)}>
          <option value="">Verificadas e legadas</option><option value="verified">Compra verificada</option><option value="legacy">Legadas</option>
        </select>
        <input name="productId" inputMode="numeric" placeholder="ID do produto" value={filters.productId} onChange={event => updateFilters(event, filters, onFiltersChange)} />
      </div>

      {loading ? <div className="l4-admin-reviews__loading">Carregando avaliações…</div> : null}
      {!loading && reviews.length === 0 ? <AdminEmptyState title="Nenhuma avaliação encontrada" description="Ajuste os filtros ou aguarde novas avaliações de clientes." /> : null}
      {!loading && reviews.length > 0 ? <div className="l4-admin-reviews">
        <div className="l4-admin-reviews__summary"><Metric label="Carregadas" value={reviews.length} /><Metric label="Fotos pendentes" value={pendingImages} /><Metric label="Ocultas" value={hidden} /></div>
        <div className="l4-admin-reviews__list">{reviews.map(review => <ReviewCard key={review.id} review={review} pending={pendingReviewId === review.id} onModerate={onModerate} />)}</div>
        {hasMore ? <button className="l4-admin-review-button l4-admin-review-button--load" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Carregando…" : "Carregar mais"}</button> : null}
      </div> : null}
    </AdminSurface>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Badge({ children }: { children: ReactNode }) { return <span className="l4-admin-review-badge">{children}</span>; }

function ReviewCard({ review, pending, onModerate }: { review: AdminReview; pending: boolean; onModerate: Props["onModerate"] }) {
  const hasImage = Boolean(review.imageUrl);
  const hide = (moderationStatus: ModerationStatus) => {
    if (moderationStatus !== "published" && !window.confirm(moderationStatus === "hidden_spam" ? "Ocultar esta avaliação por spam?" : "Ocultar esta avaliação por conteúdo ofensivo?")) return;
    onModerate(review, { moderationStatus });
  };
  return <article className="l4-admin-review-card">
    <header><div><span className="l4-admin-review-card__eyebrow">Avaliação #{review.id}</span><strong>{review.productName || `Produto #${review.productId}`}</strong><p>{review.userName || "Cliente"} · {new Date(review.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p></div><div className="l4-admin-review-card__badges"><Badge>{review.verifiedPurchase === 1 ? "Compra verificada" : "Legada não verificada"}</Badge><Badge>{moderationLabel[review.moderationStatus]}</Badge></div></header>
    <div className="l4-admin-review-card__content"><section><div className="l4-admin-review-card__rating"><Stars rating={review.rating} /><strong>{review.rating}/5</strong></div><blockquote>{review.comment || "O cliente não escreveu um comentário."}</blockquote><small>{review.sizePerception ? sizeLabel[review.sizePerception] : "Percepção de tamanho não informada"}</small></section><section className="l4-admin-review-card__photo"><div><strong>Foto do cliente</strong><Badge>{imageLabel[review.imageStatus]}</Badge></div>{hasImage ? <a href={imageSrc(review.imageUrl as string)} target="_blank" rel="noreferrer"><img src={imageSrc(review.imageUrl as string)} alt={`Foto da avaliação de ${review.productName || `produto ${review.productId}`}`} loading="lazy" /><span>Abrir foto</span></a> : <p>Nenhuma foto enviada</p>}{hasImage ? <div className="l4-admin-review-card__actions"><button className="l4-admin-review-button l4-admin-review-button--primary" type="button" disabled={pending || review.imageStatus === "approved"} onClick={() => onModerate(review, { imageStatus: "approved" })}>Aprovar foto</button><button className="l4-admin-review-button" type="button" disabled={pending || review.imageStatus === "rejected"} onClick={() => onModerate(review, { imageStatus: "rejected" })}>Rejeitar foto</button></div> : null}</section></div>
    <footer>{review.moderationStatus !== "published" ? <button className="l4-admin-review-button l4-admin-review-button--primary" type="button" disabled={pending} onClick={() => hide("published")}>Republicar avaliação</button> : <><button className="l4-admin-review-button" type="button" disabled={pending} onClick={() => hide("hidden_spam")}>Ocultar como spam</button><button className="l4-admin-review-button l4-admin-review-button--danger" type="button" disabled={pending} onClick={() => hide("hidden_offensive")}>Ocultar por conteúdo ofensivo</button></>}</footer>
  </article>;
}
