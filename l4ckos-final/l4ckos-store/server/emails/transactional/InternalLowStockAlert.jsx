import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailSectionTitle } from "../components/EmailSectionTitle.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function InternalLowStockAlert({ products = [] }) {
  const safeProducts = Array.isArray(products) ? products : [];

  return (
    <EmailLayout
      preview="Produtos abaixo do limite de estoque"
      title="Estoque abaixo do limite."
      subtitle="Alerta operacional interno"
      footerNote="Mensagem automática destinada à equipe operacional da L4CKOS."
    >
      <EmailStatusBadge tone="warning">Operação interna</EmailStatusBadge>
      <EmailText>
        {safeProducts.length === 1
          ? "Um produto atingiu o limite configurado de estoque baixo."
          : `${safeProducts.length} produtos atingiram o limite configurado de estoque baixo.`}
      </EmailText>

      <EmailSectionTitle>Itens monitorados</EmailSectionTitle>
      {safeProducts.length ? (
        safeProducts.map((product, index) => (
          <EmailPanel key={product?.id || `${product?.name || "produto"}-${index}`} title={product?.name || "Produto sem nome"}>
            <EmailInfoRow label="Estoque atual" value={product?.stock ?? "-"} />
          </EmailPanel>
        ))
      ) : (
        <EmailPanel>
          <EmailText style={{ margin: 0 }}>Nenhum item foi informado no alerta.</EmailText>
        </EmailPanel>
      )}
    </EmailLayout>
  );
}
