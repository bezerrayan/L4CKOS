import { trpc } from "../../../lib/trpc";
import { useToast } from "../../../contexts/ToastContext";
import { apiUrl } from "../../../const";
import { AdminEmptyState, AdminLoadingState, AdminStatusBadge, AdminSurface, AdminTableWrapper } from "../AdminUI";

function resolveImageUrl(imageUrl: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return apiUrl(imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`);
}

const moderationLabels = {
  published: "Publicada",
  hidden_spam: "Oculta: spam",
  hidden_offensive: "Oculta: ofensiva",
} as const;

const imageLabels = {
  none: "Sem foto",
  pending: "Foto pendente",
  approved: "Foto aprovada",
  rejected: "Foto rejeitada",
} as const;

export function AdminReviewsPanel() {
  const { showToast } = useToast();
  const reviewsQuery = trpc.admin.reviewsList.useQuery(undefined, { refetchOnWindowFocus: false });
  const moderate = trpc.admin.reviewModerate.useMutation({
    onSuccess: () => {
      showToast({ message: "Moderação atualizada", duration: 2200 });
      void reviewsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 3000 }),
  });

  return (
    <AdminSurface
      title="Avaliações verificadas"
      description="Oculte apenas spam ou conteúdo ofensivo e aprove ou rejeite fotos. Nota e comentário não podem ser alterados."
    >
      {reviewsQuery.isLoading ? <AdminLoadingState>Carregando avaliações...</AdminLoadingState> : null}
      {!reviewsQuery.isLoading && !reviewsQuery.data?.length ? (
        <AdminEmptyState title="Nenhuma avaliação recebida" description="Avaliações de compras entregues aparecerão aqui." />
      ) : null}
      {reviewsQuery.data?.length ? (
        <AdminTableWrapper>
          <table>
            <thead>
              <tr><th>Cliente e produto</th><th>Avaliação</th><th>Foto</th><th>Publicação</th><th>Ações permitidas</th></tr>
            </thead>
            <tbody>
              {reviewsQuery.data.map(review => (
                <tr key={review.id}>
                  <td>
                    <div style={styles.stack}>
                      <strong>{review.productName || `Produto #${review.productId}`}</strong>
                      <span>{review.userName || review.userEmail || "Cliente"} · Pedido #{review.orderId}</span>
                      <AdminStatusBadge style={review.verifiedPurchase === 1 ? styles.successBadge : styles.warningBadge}>
                        {review.verifiedPurchase === 1 ? "Compra verificada" : "Legada não verificada"}
                      </AdminStatusBadge>
                    </div>
                  </td>
                  <td>
                    <div style={styles.stack}>
                      <strong>{review.rating}/5 estrelas</strong>
                      <span style={styles.comment}>{review.comment}</span>
                      <small>{new Date(review.createdAt).toLocaleDateString("pt-BR")}</small>
                    </div>
                  </td>
                  <td>
                    <div style={styles.stack}>
                      <AdminStatusBadge style={review.imageStatus === "pending" ? styles.warningBadge : review.imageStatus === "approved" ? styles.successBadge : undefined}>
                        {imageLabels[review.imageStatus]}
                      </AdminStatusBadge>
                      {review.imageUrl ? <img src={resolveImageUrl(review.imageUrl)} alt="Foto pendente da avaliação" style={styles.image} /> : null}
                      {review.imageStatus === "pending" ? (
                        <div style={styles.actions}>
                          <button disabled={moderate.isPending} onClick={() => moderate.mutate({ reviewId: review.id, imageStatus: "approved" })}>Aprovar foto</button>
                          <button disabled={moderate.isPending} onClick={() => moderate.mutate({ reviewId: review.id, imageStatus: "rejected" })}>Rejeitar foto</button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <AdminStatusBadge style={review.moderationStatus === "published" ? styles.successBadge : styles.dangerBadge}>
                      {moderationLabels[review.moderationStatus]}
                    </AdminStatusBadge>
                  </td>
                  <td>
                    <div style={styles.actions}>
                      {review.moderationStatus !== "published" ? (
                        <button disabled={moderate.isPending} onClick={() => moderate.mutate({ reviewId: review.id, moderationStatus: "published" })}>Republicar</button>
                      ) : (
                        <>
                          <button disabled={moderate.isPending} onClick={() => moderate.mutate({ reviewId: review.id, moderationStatus: "hidden_spam" })}>Ocultar spam</button>
                          <button disabled={moderate.isPending} onClick={() => moderate.mutate({ reviewId: review.id, moderationStatus: "hidden_offensive" })}>Ocultar ofensivo</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableWrapper>
      ) : null}
    </AdminSurface>
  );
}

const styles = {
  stack: { display: "grid", gap: 7, minWidth: 180 },
  comment: { maxWidth: 340, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#d0d0d0", lineHeight: 1.5 },
  image: { width: 96, height: 96, objectFit: "cover", border: "1px solid #333" },
  actions: { display: "flex", flexWrap: "wrap", gap: 7 },
  successBadge: { color: "#86efac", borderColor: "rgba(134,239,172,.28)" },
  warningBadge: { color: "#fbbf24", borderColor: "rgba(251,191,36,.28)" },
  dangerBadge: { color: "#fda4af", borderColor: "rgba(253,164,175,.28)" },
} as const;
