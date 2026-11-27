import { useState } from "react";
import type { StockPixPaymentV1 } from "../../../shared/stockCheckoutV1";

type Props = {
  pix?: StockPixPaymentV1 | null;
  /** Asaas-hosted payment page, kept as the alternative path. */
  checkoutUrl?: string | null;
};

/** Same `data:` handling as the legacy PIX charge screen; the server sends the bare base64 PNG. */
export function pixQrCodeSource(qrCodeBase64: string): string {
  return qrCodeBase64.startsWith("data:image") ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inline PIX payment for a STOCK attempt: QR Code + "Pix Copia e Cola", with the Asaas link as an alternative.
 * Presentational only: it never creates or changes a payment.
 */
export function StockPixInstructions({ pix, checkoutUrl }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  if (!pix && !checkoutUrl) return null;

  const copyPaste = pix?.copyPaste;
  const handleCopy = async () => {
    if (!copyPaste) return;
    setCopyState((await copyToClipboard(copyPaste)) ? "copied" : "failed");
  };

  return (
    <div className="l4-checkout-pix" data-testid="stock-pix-instructions">
      {pix?.qrCodeBase64 ? <img src={pixQrCodeSource(pix.qrCodeBase64)} alt="QR Code PIX" width={220} height={220} /> : null}
      {copyPaste ? (
        <>
          <label className="l4-checkout-pix-label" htmlFor="stock-pix-copy-paste">Pix Copia e Cola</label>
          <textarea id="stock-pix-copy-paste" readOnly value={copyPaste} onFocus={event => event.currentTarget.select()} />
          <button type="button" onClick={() => void handleCopy()}>Copiar código PIX</button>
          <p className="l4-checkout-pix-feedback" role="status" aria-live="polite">
            {copyState === "copied" ? "Código copiado." : copyState === "failed" ? "Não foi possível copiar automaticamente. Selecione o código acima e copie." : ""}
          </p>
        </>
      ) : null}
      {!pix ? <p>Não foi possível exibir o QR Code agora. Use o link abaixo ou atualize o status.</p> : null}
      {checkoutUrl ? <a href={checkoutUrl} target="_blank" rel="noreferrer">{pix ? "Abrir no Asaas" : "Continuar pagamento"}</a> : null}
    </div>
  );
}
