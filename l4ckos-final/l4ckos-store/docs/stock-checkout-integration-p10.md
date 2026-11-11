# RC3 Gate P10: integração local STOCK

## Escopo e isolamento

- Worktree: `/home/yan/Documentos/l4ckos/worktrees/l4ckos-stock-checkout-forwardport/l4ckos-final/l4ckos-store`
- HEAD/base: `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156`.
- A integração adiciona procedimentos `stockCheckout.create` e `stockCheckout.resume` ao appRouter. Os endpoints legados `orders.*` continuam montados e inalterados.
- `createContext` autentica como antes e não cria pool nem runtime STOCK. Sem injeção de `stockCheckoutRuntime`, os procedimentos STOCK respondem indisponível. O harness de teste injeta somente pool MySQL loopback descartável e provider sintético.
- `create` exige sessão, valida STOCK V1, checa `PUBLIC_CHECKOUT_DISABLED` antes de runtime/DB/provider e usa exclusivamente `ctx.user.id`. `resume` é query read-only, aplica owner dentro do adapter e responde 404 igual para tentativa ausente ou de terceiro.
- O frontend encaminha carrinhos cujos produtos declaram catálogo de variantes para STOCK. Valida `variantId` contra a variante ativa da resposta de catálogo; mistura de item legado e STOCK, ou variante ausente/inativa, bloqueia checkout e não cai silenciosamente no endpoint antigo. Produtos sem catálogo STOCK continuam no fluxo legado.
- O frontend persiste attemptId em localStorage com namespace por usuário. Refresh consulta `resume`; indisponibilidade não cria tentativa nova. Para estado ambíguo, pago, pendente ou criação em andamento, não libera nova cobrança. Falha terminal só permite nova tentativa quando o servidor define `canStartNewAttempt`.
- A tela preserva o layout existente e exibe estado, total calculado no servidor, pedido e link de checkout. O valor enviado pelo cliente não integra o contrato STOCK V1.

## Harness e schema

`scripts/run-stock-mysql-tests.sh` exige Node 22.23.2, pnpm 10.4.1 e imagem local `mysql:8.4.11`; não baixa imagem. Inicia MySQL efêmero publicado apenas em loopback, usa credenciais sintéticas e remove o contêiner ao terminar. O harness roda `mysqlStockCheckoutStore.mysql.test.ts` e `stockCheckout.integration.mysql.test.ts` sem paralelismo entre arquivos porque compartilham o schema descartável.

O schema utilizado é exclusivamente `server/stock/fixtures/mysql8-stock-schema.sql`. Ele cria `products`, `productVariants` e tabelas sintéticas `stockCheckoutAttempts`, `stockCheckoutItems`, `stockReservations` e `stockWebhookEvents`, com InnoDB, FKs, índices únicos para tentativa/pedido/pagamento/evento, identidade SKU/variante, estado e quantidade. O adapter altera estoque reservado/estoque por variante de forma transacional.

Delta em relação ao código/schema-base: o fixture restringe `products` a `id/name`; `productVariants` usa preço em centavos mais colunas `sku`, `size`, `color`, `stock`, `reservedStock`, `isActive`; tabelas de tentativa, snapshots, reserva por variante e deduplicação são próprias do contrato STOCK. O adapter ainda não grava nas tabelas legadas `orders`, `orderItems`, `payments` ou `asaasWebhookEvents`. O evento sintético é persistido em `stockWebhookEvents`. Nada neste fixture prova que o DDL, dados, constraints ou índices do MySQL remoto sejam compatíveis; nenhum DDL foi executado em produção.

O provider é uma função fake que registra uma chamada e retorna URL `sandbox.invalid`; não há chamada de rede nem integração Asaas. Webhook usa o verificador/token já existente e token sintético, testa token inválido, processa evento de pagamento confirmado e replay. A jornada não envia e-mail; não há efeito de e-mail a simular neste fluxo.

## Resultados e cobertura

- Testes focados STOCK: 29/29 PASS (client, retomada, runtime e boundary do webhook).
- MySQL descartável 8.4.11: 22/22 PASS, incluindo 20 casos transacionais prévios e 2 testes de rota tRPC montada.
- O teste da rota valida reserva, valor autoritativo, replay sem segunda chamada do provider, ownership, sessão ausente, rejeição de campo extra `price`, assinatura inválida, webhook válido duplicado, estado pago e consumo da reserva. O gate fechado não cria tentativa e não chama o provider.
- Cobertura MySQL anterior mantém concorrência da última unidade (uma reserva), expiração, falhas/ambiguidade, liberação e consumo transacional.
- Typecheck: `pnpm check` PASS (Node `v22.23.2`, pnpm `10.4.1`).
- Build: `pnpm build` PASS (client Vite e server esbuild).
- O runner exerce procedimentos tRPC com contextos autenticados sintéticos, não cookies/sessões HTTP reais, browser, navegação do produto ou refresh de navegador. Portanto, aceite de jornada de UI/browser E2E não está declarado.

## Bloqueios para rollout

- Attestation de schema de produção e compatibilidade de DDL/dados, incluindo como materializar pedidos e itens no modelo legado.
- Definição de integração entre pedidos STOCK e as telas/rotas existentes de acompanhamento de pedido. A tela Pagamento mostra o status STOCK, mas o adapter não atualiza `orders` legado.
- Compatibilidade do frontend publicada, logística/endereço/frete e confirmação de contrato de resposta.
- Homologação Asaas sandbox real autorizada e revisão operacional de reconciliação.
- E2E de browser com sessão local, seleção no produto, carrinho, refresh e estados terminais.
- O checkout permanece fechado: flags públicas não foram alteradas; o runtime padrão não possui conexão/provider STOCK configurados.

`REMOTE_CHANGES=NONE`
