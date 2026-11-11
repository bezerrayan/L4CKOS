# Checkout frontend — expectativas para o backend (Claude → Codex)

Branch `launch/claude-checkout` (base `ede02fc` + snapshot do WIP de frontend do worktree `stock-checkout-forwardport`).
Nada aqui altera schema, migrations, estoque transacional ou o gate de produção.

## O que o frontend consome (tRPC, autenticado)
- `stockCheckout.create(StockCheckoutHttpRequestV1)` → `StockCheckoutResponseV1` (`status: pending|reconciliation_required`, `orderId`, `checkoutUrl`, `amountCents`, `replayed`). Resposta de criação **nunca** é exibida como pagamento aprovado.
- `stockCheckout.resume({ attemptId })` → `StockAttemptResumeV1` (`reserved|creating|pending|ambiguous|paid|failed|expired|cancelled`, `canStartNewAttempt`, `checkoutUrl` só em `pending`).
- Erros TRPC usados na UI: `UNAUTHORIZED`, `CONFLICT` (mensagem com "estoque" ⇒ estoque; com "análise" ⇒ desfecho desconhecido), `NOT_FOUND`, `BAD_REQUEST`, `SERVICE_UNAVAILABLE`, `TOO_MANY_REQUESTS`. Qualquer outro erro/rede ⇒ "desfecho desconhecido" e a tela consulta `resume` antes de permitir nova tentativa.
- `GET/POST /api/shipping/quote` devolve `options[]` (preço em **reais**). O pedido STOCK só aceita `optionId: "local-plano-piloto"`.

## Pedidos ao Codex
1. Expor `variants[]` com `size`, `color`, `isActive`, `stock` por variante em `products.getById` (hoje o front só trata STOCK se vierem todos os campos).
2. Incluir `canStartNewAttempt` e `checkoutUrl` conforme o doc P9; emitir `cancelled` quando houver cancelamento persistido (UI já trata).
3. Confirmar o `StockCheckoutResponseV1` final e o mapeamento CONFLICT estoque vs. análise (hoje depende de texto da mensagem; preferível um `appError.code`).
4. Decidir/entregar recuperação de tentativa sem `localStorage` (por usuário/pedido) — limpar o navegador perde o `attemptId`.
5. **Frete (regra de negócio, não alterado por mim):** `server/services/shippingService.ts` devolve a opção "Entrega local - Plano Piloto" para QUALQUER CEP quando `MELHOR_ENVIO_TOKEN` está ausente (`return options.length > 0 ? options : [buildLocalOption()]`). Confirmar se é intencional.

## Correções de frontend nesta entrega
- `Pagamento`: removido fallback de frete fabricado (antes: falha de rede ⇒ "Entrega local R$ 0,00" para qualquer CEP). Agora erro + retry, checkout bloqueado até haver opção real do backend.
- `Pagamento`: `subtotal` enviado ao `/api/shipping/quote` estava dividido por 100 (valor declarado/seguro 100× menor que o recotado no servidor em `orders.ts`). Corrigido para reais.
- Estados de tentativa STOCK centralizados em `client/src/stock/stockAttemptView.ts` (PT-BR, `role="status"`), mensagens de erro sem códigos internos.

## Sprint 2 — reconciliação com `docs/stock-checkout-backend-contract-v1.md` (launch/codex-core)
- Contratos reutilizados sem cópia paralela: `shared/stockCheckoutV1.ts` (idêntico ao do Codex), `trpc.stockCheckout.create|resume`. Em `launch/claude-checkout` os arquivos de backend **não** estão presentes (WIP não commitado no worktree do Codex); typecheck/build foram validados em branch temporária `tmp/claude-codex-integration` (descartável) com cópia dos arquivos do Codex.
- Erros mapeados por código tRPC conforme o contrato: `UNAUTHORIZED`, `FORBIDDEN` (gate fechado), `SERVICE_UNAVAILABLE`, `CONFLICT`, `NOT_FOUND`, `BAD_REQUEST`.
- Retomada: somente `stockCheckout.resume({ attemptId })`. Sem lista de tentativas no backend, a recuperação usa o registro local (`localStorage`, por usuário) e exibe o estado devolvido pelo servidor; limpar o navegador perde o `attemptId` (pendência de backend: busca por usuário/pedido).
- Estoque visível: o carrinho é revalidado contra `products.getById` (preço, estoque por variante, atividade); itens esgotados/limitados bloqueiam **novas** tentativas, mas não a retomada (reservas próprias reduzem o estoque exibido).
- Dependência de teste de componentes: nenhuma instalada. Para testes de interação (foco/teclado) seriam necessários, como devDependencies, `jsdom` e `@testing-library/react` (+ `@testing-library/user-event`) — **aguardando aprovação**.
