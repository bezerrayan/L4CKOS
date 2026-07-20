import { useState, type ChangeEvent, type FormEvent } from "react";
import { Star } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { apiUrl } from "../../const";
import { csrfFetch } from "../../lib/csrf";
import { useToast } from "../../contexts/ToastContext";
import { getApiErrorDisplay } from "../../utils/apiError";
import "./reviews.css";

type EligibleReview = {
  productId: number;
  productName: string;
  productImage: string | null;
  orderId: number;
};

const initialForm = {
  rating: 0,
  comment: "",
  sizePerception: "" as "" | "small" | "true_to_size" | "large",
  image: null as File | null,
};

function resolveProductImage(imageUrl: string | null) {
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return apiUrl(imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`);
}

export function ReviewPurchaseArea() {
  const { showToast } = useToast();
  const utils = trpc.useUtils();
  const eligibilityQuery = trpc.products.reviewEligibility.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const createReview = trpc.products.reviewCreate.useMutation();
  const [selected, setSelected] = useState<EligibleReview | null>(null);
  const [form, setForm] = useState(initialForm);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const eligible = eligibilityQuery.data ?? [];

  if (!eligibilityQuery.isLoading && eligible.length === 0) return null;

  function openForm(item: EligibleReview) {
    setSelected(item);
    setForm(initialForm);
    setFeedback("");
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null;
    if (image && image.size > 3 * 1024 * 1024) {
      setFeedback("A foto deve ter no máximo 3 MB.");
      event.target.value = "";
      return;
    }
    setForm(current => ({ ...current, image }));
    setFeedback("");
  }

  async function uploadImage(productId: number, image: File) {
    const body = new FormData();
    body.append("productId", String(productId));
    body.append("file", image);
    const response = await csrfFetch(apiUrl("/api/review-images"), {
      method: "POST",
      credentials: "include",
      body,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      throw new Error(payload?.message || payload?.error || "Não foi possível enviar a foto.");
    }
    return String(payload.token);
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (form.rating < 1) return void setFeedback("Selecione uma nota de 1 a 5 estrelas.");
    if (form.comment.trim().length < 10) return void setFeedback("Conte um pouco mais sobre sua experiência.");
    if (!form.sizePerception) return void setFeedback("Informe como o tamanho vestiu.");

    setUploading(Boolean(form.image));
    setFeedback("");
    try {
      const imageToken = form.image ? await uploadImage(selected.productId, form.image) : undefined;
      await createReview.mutateAsync({
        productId: selected.productId,
        rating: form.rating,
        comment: form.comment.trim(),
        sizePerception: form.sizePerception,
        imageToken,
      });
      await Promise.all([
        eligibilityQuery.refetch(),
        utils.products.reviews.invalidate(selected.productId),
      ]);
      setSelected(null);
      setForm(initialForm);
      showToast({ message: form.image ? "Avaliação publicada. A foto será revisada." : "Avaliação publicada.", duration: 3200 });
    } catch (error) {
      setFeedback(getApiErrorDisplay(error, "Não foi possível enviar sua avaliação.").message);
    } finally {
      setUploading(false);
    }
  }

  const pending = uploading || createReview.isPending;

  return (
    <section className="l4-review-purchase-area" aria-labelledby="review-purchase-title">
      <div className="l4-profile-section-heading">
        <div>
          <p>Sua experiência</p>
          <h2 id="review-purchase-title">Avalie sua compra</h2>
          <span>Disponível somente para produtos pagos e entregues.</span>
        </div>
      </div>

      {eligibilityQuery.isLoading ? <p className="l4-profile-empty-line">Verificando compras entregues...</p> : (
        <div className="l4-review-eligible-list">
          {eligible.map(item => (
            <article key={item.productId}>
              {item.productImage ? <img src={resolveProductImage(item.productImage)} alt="" /> : <div className="l4-review-product-placeholder" />}
              <div>
                <strong>{item.productName}</strong>
                <span>Pedido #{item.orderId} · Compra verificada</span>
              </div>
              <button type="button" onClick={() => openForm(item)}>Avaliar produto</button>
            </article>
          ))}
        </div>
      )}

      {selected ? (
        <form className="l4-review-form" aria-live="polite" onSubmit={event => void submitReview(event)}>
          <div className="l4-review-form-heading">
            <div><span>Avaliando</span><strong>{selected.productName}</strong></div>
            <button type="button" onClick={() => setSelected(null)} disabled={pending}>Cancelar</button>
          </div>

          <fieldset>
            <legend>Qual é a sua nota?</legend>
            <div className="l4-review-rating-input">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} ${star === 1 ? "estrela" : "estrelas"}`}
                  aria-pressed={form.rating === star}
                  onClick={() => setForm(current => ({ ...current, rating: star }))}
                >
                  <Star fill={star <= form.rating ? "currentColor" : "none"} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            Comentário
            <textarea
              value={form.comment}
              onChange={event => setForm(current => ({ ...current, comment: event.target.value }))}
              maxLength={1000}
              rows={5}
              placeholder="Conte como foi sua experiência com o produto."
            />
            <small>{form.comment.length}/1000</small>
          </label>

          <fieldset>
            <legend>Como o tamanho vestiu?</legend>
            <div className="l4-review-size-options">
              {([
                ["small", "Pequeno"],
                ["true_to_size", "Ideal"],
                ["large", "Grande"],
              ] as const).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="size-perception"
                    value={value}
                    checked={form.sizePerception === value}
                    onChange={() => setForm(current => ({ ...current, sizePerception: value }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Foto <small>opcional · JPG, PNG ou WEBP · até 3 MB</small>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} />
          </label>
          {feedback ? <p className="l4-review-feedback" role="alert">{feedback}</p> : null}
          <button className="l4-review-submit" type="submit" disabled={pending}>
            {pending ? "Enviando avaliação..." : "Publicar avaliação"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
