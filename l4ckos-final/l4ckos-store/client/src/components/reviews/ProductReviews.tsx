import { Star } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { apiUrl } from "../../const";
import "./reviews.css";
const labels = { small: "Veste pequeno", true_to_size: "Tamanho ideal", large: "Veste grande" } as const;
function Stars({ value }: { value: number }) { return <span className="l4-review-stars">{[1,2,3,4,5].map(n => <Star key={n} size={16} fill={n <= value ? "currentColor" : "none"} />)}</span>; }
export function ProductReviews({ productId }: { productId: number }) {
 const query = trpc.products.reviews.useQuery(productId,{enabled:productId>0,refetchOnWindowFocus:false}); const reviews=query.data ?? [];
 if (query.isLoading) return <section className="l4-reviews"><p>Carregando avaliações...</p></section>;
 if (query.isError) return <section className="l4-reviews"><p>Não foi possível carregar as avaliações agora.</p></section>;
 if (!reviews.length) return <section className="l4-reviews"><p>Ainda não há avaliações verificadas para este produto.</p></section>;
 const average=reviews.reduce((n,r)=>n+r.rating,0)/reviews.length;
 return <section className="l4-reviews"><header className="l4-reviews-heading"><div><p>Avaliações verificadas</p><h2>O que clientes acharam</h2></div><div><strong>{average.toFixed(1)}</strong><Stars value={Math.round(average)}/><span>{reviews.length} avaliações</span></div></header><div className="l4-review-list">{reviews.map(r=><article key={r.id} className="l4-review-item"><header><div><strong>{r.userName}</strong><span className="l4-review-verified">Compra verificada</span></div><time>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</time></header><Stars value={r.rating}/>{r.comment ? <p>{r.comment}</p>:null}{r.sizePerception ? <small>{labels[r.sizePerception]}</small>:null}{r.imageUrl ? <img className="l4-review-photo" src={r.imageUrl.startsWith("http")?r.imageUrl:apiUrl(r.imageUrl)} alt={`Foto de ${r.userName}`} loading="lazy"/>:null}</article>)}</div></section>;
}
