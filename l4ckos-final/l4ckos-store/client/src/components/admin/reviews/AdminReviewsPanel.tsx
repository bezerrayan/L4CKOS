import { ExternalLink, Image, MessageSquareText, ShieldCheck, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { trpc } from "../../../lib/trpc";
import { useToast } from "../../../contexts/ToastContext";
import { apiUrl } from "../../../const";
import { AdminEmptyState, AdminLoadingState, AdminStatusBadge, AdminSurface } from "../AdminUI";
import "./AdminReviewsPanel.css";

function resolveImageUrl(imageUrl: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return apiUrl(imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`);
}

const moderationLabels = {
  published: "Publicada",
  hidden_spam: "Oculta por spam",
  hidden_offensive: "Oculta por conteúdo ofensivo",
} as const;

const imageLabels = {
  none: "Sem foto",
  pending: "Foto aguardando análise",
  approved: "Foto aprovada",
  rejected: "Foto rejeitada",
} as const;

const sizeLabels = {
  small: "Vestiu pequeno",
  true_to_size: "Tamanho ideal",
  large: "Vestiu grande",
} as const;

type AdminReviewsPanelProps = {
  onOpenOrder: (orderId: number) => void;
  onOpenProduct: (productId: number, productName: string) => void;
};

export function AdminReviewsPanel({ onOpenOrder, onOpenProduct }: AdminReviewsPanelProps) {
  const { showToast } = useToast();
  const reviewsQuery = trpc.admin.reviewsList.useQuery(undefined, { refetchOnWindowFocus: false });
  const moderate = trpc.admin.reviewModerate.useMutation({
    onSuccess: () => {
      showToast({ message: "Moderação atualizada", duration: 2200 });
      void reviewsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 3000 }),
  });
  const reviews = reviewsQuery.data ?? [];
  const summary = {
    total: reviews.length,
    pendingImages: reviews.filter(review => review.imageStatus === "pending").length,
    hidden: reviews.filter(review => review.moderationStatus !== "published").length,
  };

  function moderatePublication(
    reviewId: number,
    moderationStatus: "published" | "hidden_spam" | "hidden_offensive",
  ) {
    if (
      moderationStatus !== "published"
      && !window.confirm(
        moderationStatus === "hidden_spam"
          ? "Ocultar esta avaliação por spam?"
          : "Ocultar esta avaliação por conteúdo ofensivo?",
      )
    ) {
      return;
    }
    moderate.mutate({ reviewId, moderationStatus });
  }

  return (
    <AdminSurface
      title="Avaliações verificadas"
      description="Modere publicação e fotos sem alterar a nota ou o comentário original do cliente."
    >
      {reviewsQuery.isLoading ? <AdminLoadingState>Carregando avaliações...</AdminLoadingState> : null}
      {!reviewsQuery.isLoading && reviews.length === 0 ? (
        <AdminEmptyState title="Nenhuma avaliação recebida" description="Avaliações de compras pagas e entregues aparecerão aqui." />
      ) : null}
      {reviews.length > 0 ? (
        <div className="l4-admin-reviews">
          <div className="l4-admin-reviews__summary" aria-label="Resumo das avaliações">
            <div>
              <MessageSquareText size={17} aria-hidden="true" />
              <span>Total recebido</span>
              <strong>{summary.total}</strong>
            </div>
            <div>
              <Image size={17} aria-hidden="true" />
              <span>Fotos pendentes</span>
              <strong>{summary.pendingImages}</strong>
            </div>
            <div>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>Publicações ocultas</span>
              <strong>{summary.hidden}</strong>
            </div>
          </div>

          <div className="l4-admin-reviews__list">
            {reviews.map(review => {
              const isCurrentReviewPending = moderate.isPending && moderate.variables?.reviewId === review.id;
              const productName = review.productName || `Produto #${review.productId}`;
              const customerName = review.userName || review.userEmail || "Cliente";

              return (
                <article className="l4-admin-review-card" key={review.id}>
                  <header className="l4-admin-review-card__header">
                    <div className="l4-admin-review-card__identity">
                      <span className="l4-admin-review-card__eyebrow">Avaliação #{review.id}</span>
                      <button type="button" onClick={() => onOpenProduct(review.productId, productName)}>
                        {productName}
                      </button>
                      <p>{customerName}{review.userEmail && review.userName ? ` · ${review.userEmail}` : ""}</p>
                    </div>
                    <div className="l4-admin-review-card__badges">
                      <AdminStatusBadge style={review.verifiedPurchase === 1 ? styles.verifiedBadge : styles.legacyBadge}>
                        {review.verifiedPurchase === 1 ? "Compra verificada" : "Legada não verificada"}
                      </AdminStatusBadge>
                      <AdminStatusBadge style={review.moderationStatus === "published" ? styles.publishedBadge : styles.hiddenBadge}>
                        {moderationLabels[review.moderationStatus]}
                      </AdminStatusBadge>
                    </div>
                  </header>

                  <div className="l4-admin-review-card__content">
                    <section className="l4-admin-review-card__review" aria-label="Conteúdo da avaliação">
                      <div className="l4-admin-review-card__rating" aria-label={`${review.rating} de 5 estrelas`}>
                        <span aria-hidden="true">
                          {[1, 2, 3, 4, 5].map(value => (
                            <Star key={value} size={17} fill={value <= review.rating ? "currentColor" : "none"} />
                          ))}
                        </span>
                        <strong>{review.rating}/5</strong>
                      </div>
                      <blockquote>{review.comment || "O cliente não escreveu um comentário."}</blockquote>
                      <div className="l4-admin-review-card__metadata">
                        <span>{review.sizePerception ? sizeLabels[review.sizePerception] : "Percepção de tamanho não informada"}</span>
                        <span>{new Date(review.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                      </div>
                    </section>

                    <section className="l4-admin-review-card__photo" aria-label="Foto da avaliação">
                      <div className="l4-admin-review-card__section-title">
                        <span>Foto do cliente</span>
                        <AdminStatusBadge style={review.imageStatus === "pending" ? styles.pendingBadge : review.imageStatus === "approved" ? styles.approvedBadge : undefined}>
                          {imageLabels[review.imageStatus]}
                        </AdminStatusBadge>
                      </div>
                      {review.imageUrl ? (
                        <a
                          className="l4-admin-review-card__image-link"
                          href={resolveImageUrl(review.imageUrl)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Abrir foto da avaliação de ${productName}`}
                        >
                          <img
                            src={resolveImageUrl(review.imageUrl)}
                            alt={`Foto enviada na avaliação de ${productName}`}
                            loading="lazy"
                            decoding="async"
                          />
                          <span><ExternalLink size={14} aria-hidden="true" /> Abrir foto</span>
                        </a>
                      ) : (
                        <div className="l4-admin-review-card__no-photo">
                          <Image size={20} aria-hidden="true" />
                          <span>Nenhuma foto enviada</span>
                        </div>
                      )}
                      {review.imageStatus === "pending" ? (
                        <div className="l4-admin-review-card__button-row">
                          <button
                            className="l4-admin-review-button l4-admin-review-button--primary"
                            type="button"
                            disabled={isCurrentReviewPending}
                            onClick={() => moderate.mutate({ reviewId: review.id, imageStatus: "approved" })}
                          >
                            Aprovar foto
                          </button>
                          <button
                            className="l4-admin-review-button"
                            type="button"
                            disabled={isCurrentReviewPending}
                            onClick={() => moderate.mutate({ reviewId: review.id, imageStatus: "rejected" })}
                          >
                            Rejeitar
                          </button>
                        </div>
                      ) : null}
                    </section>
                  </div>

                  <footer className="l4-admin-review-card__footer">
                    <div className="l4-admin-review-card__links">
                      {review.orderId ? (
                        <button type="button" onClick={() => onOpenOrder(review.orderId as number)}>
                          Abrir pedido #{review.orderId}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => onOpenProduct(review.productId, productName)}>
                        Abrir produto no admin
                      </button>
                      <Link to={`/produto/${review.productId}`} target="_blank" rel="noreferrer">
                        Ver na loja <ExternalLink size={13} aria-hidden="true" />
                      </Link>
                    </div>
                    <div className="l4-admin-review-card__moderation">
                      {review.moderationStatus !== "published" ? (
                        <button
                          className="l4-admin-review-button l4-admin-review-button--primary"
                          type="button"
                          disabled={isCurrentReviewPending}
                          onClick={() => moderatePublication(review.id, "published")}
                        >
                          Republicar avaliação
                        </button>
                      ) : (
                        <>
                          <button
                            className="l4-admin-review-button"
                            type="button"
                            disabled={isCurrentReviewPending}
                            onClick={() => moderatePublication(review.id, "hidden_spam")}
                          >
                            Ocultar como spam
                          </button>
                          <button
                            className="l4-admin-review-button l4-admin-review-button--danger"
                            type="button"
                            disabled={isCurrentReviewPending}
                            onClick={() => moderatePublication(review.id, "hidden_offensive")}
                          >
                            Ocultar por conteúdo ofensivo
                          </button>
                        </>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </AdminSurface>
  );
}

const styles = {
  verifiedBadge: { color: "#f3f4f6", borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.055)" },
  legacyBadge: { color: "#fbbf24", borderColor: "rgba(251,191,36,.28)" },
  publishedBadge: { color: "#fda4af", borderColor: "rgba(244,63,94,.3)", background: "rgba(159,18,57,.10)" },
  hiddenBadge: { color: "#cbd5e1", borderColor: "rgba(148,163,184,.28)" },
  pendingBadge: { color: "#fbbf24", borderColor: "rgba(251,191,36,.28)" },
  approvedBadge: { color: "#e5e7eb", borderColor: "rgba(229,231,235,.22)" },
} as const;
