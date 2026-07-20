import { Star } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { apiUrl } from "../../const";
import "./reviews.css";

interface ProductReviewsProps {
  productId: number;
}

const sizeLabels = {
  small: "Veste pequeno",
  true_to_size: "Tamanho ideal",
  large: "Veste grande",
} as const;

function resolveReviewImage(imageUrl: string) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return apiUrl(imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`);
}

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="l4-review-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map(star => (
        <Star key={star} size={17} fill={star <= rating ? "currentColor" : "none"} aria-hidden="true" />
      ))}
    </span>
  );
}

export function ProductReviews({ productId }: ProductReviewsProps) {
  const reviewsQuery = trpc.products.reviews.useQuery(productId, {
    enabled: productId > 0,
    refetchOnWindowFocus: false,
  });
  const data = reviewsQuery.data;

  if (reviewsQuery.isLoading || !data || data.summary.total === 0) return null;

  const sizeTotal = Object.values(data.summary.sizeDistribution).reduce((sum, value) => sum + value, 0);
  const dominantSize = sizeTotal
    ? (Object.entries(data.summary.sizeDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof sizeLabels)
    : null;

  return (
    <section className="l4-reviews" aria-labelledby="product-reviews-title">
      <div className="l4-reviews-heading">
        <div>
          <p>Avaliações verificadas</p>
          <h2 id="product-reviews-title">O que clientes acharam</h2>
        </div>
        <div className="l4-reviews-score" aria-label={`Média ${data.summary.average} de 5 em ${data.summary.total} avaliações`}>
          <strong>{data.summary.average.toFixed(1)}</strong>
          <span>
            <Stars rating={Math.round(data.summary.average)} label={`${data.summary.average} de 5 estrelas`} />
            {data.summary.total} {data.summary.total === 1 ? "avaliação" : "avaliações"}
          </span>
        </div>
      </div>

      <div className="l4-reviews-summary">
        <div className="l4-review-distribution" aria-label="Distribuição das notas">
          {[5, 4, 3, 2, 1].map(star => {
            const count = data.summary.ratingDistribution[star] ?? 0;
            const percentage = (count / data.summary.total) * 100;
            return (
              <div key={star}>
                <span>{star} estrelas</span>
                <i><b style={{ width: `${percentage}%` }} /></i>
                <small>{count}</small>
              </div>
            );
          })}
        </div>
        <div className="l4-review-sizing">
          <span>Percepção de tamanho</span>
          <strong>{dominantSize ? sizeLabels[dominantSize] : "Ainda sem respostas"}</strong>
          {sizeTotal > 0 ? <small>Baseado em {sizeTotal} {sizeTotal === 1 ? "resposta" : "respostas"}</small> : null}
        </div>
      </div>

      <div className="l4-review-list">
        {data.reviews.map(review => (
          <article key={review.id} className="l4-review-item">
            <header>
              <div>
                <strong>{review.userName}</strong>
                <span className="l4-review-verified">Compra verificada</span>
              </div>
              <time dateTime={new Date(review.createdAt).toISOString()}>
                {new Date(review.createdAt).toLocaleDateString("pt-BR")}
              </time>
            </header>
            <Stars rating={review.rating} label={`${review.rating} de 5 estrelas`} />
            <p>{review.comment}</p>
            {review.sizePerception ? <small className="l4-review-size">{sizeLabels[review.sizePerception]}</small> : null}
            {review.imageUrl ? (
              <img
                className="l4-review-photo"
                src={resolveReviewImage(review.imageUrl)}
                alt={`Foto enviada por ${review.userName} na avaliação do produto`}
                loading="lazy"
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

