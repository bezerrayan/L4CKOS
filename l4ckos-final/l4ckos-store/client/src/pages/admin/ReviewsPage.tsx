import { useEffect, useMemo, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useToast } from "../../contexts/ToastContext";
import { AdminReviewsPanel, type AdminReview, type AdminReviewFilters } from "../../components/admin/reviews/AdminReviewsPanel";

export function ReviewsPage() {
  const { showToast } = useToast();
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState<AdminReviewFilters>({ moderationStatus: "", imageStatus: "", verifiedPurchase: "", productId: "" });
  const [cursor, setCursor] = useState<number | undefined>();
  const [items, setItems] = useState<AdminReview[]>([]);
  const input = useMemo(() => { const productId = Number(filters.productId); return { ...(filters.moderationStatus ? { moderationStatus: filters.moderationStatus } : {}), ...(filters.imageStatus ? { imageStatus: filters.imageStatus } : {}), ...(filters.verifiedPurchase ? { verifiedPurchase: filters.verifiedPurchase === "verified" } : {}), ...(Number.isInteger(productId) && productId > 0 ? { productId } : {}), ...(cursor ? { cursor } : {}), limit: 30 }; }, [cursor, filters]);
  const query = trpc.admin.reviewsList.useQuery(input);
  useEffect(() => { if (!query.data) return; const page = query.data.items as AdminReview[]; setItems(current => cursor ? [...current, ...page.filter(review => !current.some(existing => existing.id === review.id))] : page); }, [cursor, query.data]);
  const mutation = trpc.admin.reviewModerate.useMutation({ onSuccess: () => { showToast({ message: "Moderação atualizada", duration: 2200 }); setCursor(undefined); setItems([]); void utils.admin.reviewsList.invalidate(); }, onError: error => { if ((error as any)?.data?.code === "CONFLICT") { showToast({ message: "Esta avaliação foi alterada por outro administrador. A lista foi atualizada.", duration: 3400 }); setCursor(undefined); setItems([]); void utils.admin.reviewsList.invalidate(); return; } const messages: Record<string, string> = { UNAUTHORIZED: "Sua sessão não autoriza esta operação.", FORBIDDEN: "Você não tem permissão para moderar avaliações.", NOT_FOUND: "Avaliação não encontrada.", BAD_REQUEST: "A ação de moderação não é válida para esta avaliação." }; showToast({ message: messages[(error as any)?.data?.code] || "Não foi possível atualizar a moderação.", duration: 3200 }); } });
  return <AdminReviewsPanel reviews={items} filters={filters} loading={query.isLoading} loadingMore={query.isFetching && Boolean(cursor)} hasMore={Boolean(query.data?.nextCursor)} pendingReviewId={mutation.variables?.reviewId} onFiltersChange={next => { setFilters(next); setCursor(undefined); setItems([]); }} onLoadMore={() => setCursor(query.data?.nextCursor ?? undefined)} onModerate={(review, update) => mutation.mutate({ reviewId: review.id, expectedModerationStatus: review.moderationStatus, expectedImageStatus: review.imageStatus, ...update })} />;
}
