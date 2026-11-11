# RC3 Gate P4: candidata local STOCK

## Origem e isolamento

- Worktree: `/home/yan/Documentos/l4ckos/worktrees/l4ckos-stock-checkout-forwardport`
- Pacote: `l4ckos-final/l4ckos-store`
- Base detached: `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156` (`fix(db): enforce dedicated MySQL TLS verification`)
- Árvore no início: limpa; diff inicial vazio.
- Identidade do repositório: `https://github.com/bezerrayan/L4CKOS.git`.
- A worktree de origem tinha 586 entradas modificadas/não rastreadas. Ela não foi usada para editar nem limpa; os arquivos TLS/MySQL rastreados na base foram preservados nesta candidata.
- A referência de staging `26152c3ac6ab6a1635e628a7d722047307ad7c45` existe localmente. O diff contém mudanças PREORDER, admin e operações que foram excluídas deste incremento.

## Contrato mínimo de schema STOCK

Este é um contrato lógico para revisão. Não é migration, não foi aplicado e não comprova o schema de qualquer banco remoto. Uma implementação MySQL deverá validar o contrato em banco local descartável antes de qualquer promoção.

| Estrutura | Situação na base de produção | Necessidade STOCK | Attestation remota |
| --- | --- | --- | --- |
| `products` | Definida em `drizzle/schema.ts` e migrations legadas; tem nome/preço/estoque | Reutilizar produto e preço como fallback apenas se o contrato permitir; checkout variantado exige variante válida | Obrigatória; DDL e dados não foram observados |
| `productVariants` | Definida; tem `productId`, `sku`, `price`, `stock`; não tem identidade canônica completa | Necessita `size`, `color`, `isActive` e identidade única produto/cor/tamanho; preço permanece em centavos | Obrigatória; não assumir colunas ou constraints remotas |
| `orders` | Definida em schema/migration legados | Necessita chave única de tentativa e fingerprint; correlação do pedido com pagamento e estado terminal coerentes | Obrigatória; não assumir colunas/índices remotos |
| `orderItems` | Definida; snapshot atual insuficiente para identidade de variante | Necessita `variantId` e snapshots imutáveis de SKU, tamanho, cor, preço unitário em centavos e quantidade | Obrigatória |
| `payments` | Não definida na base consultada | Desnecessária no contrato mínimo: uma correlação de pagamento pode ficar no pedido. Uma tabela própria só deve entrar se o desenho de múltiplas tentativas exigir | Não aplicável ao contrato mínimo |
| `stockReservations` | Definida no nível do produto, sem `variantId` | Necessita reserva por variante, tentativa, quantidade, expiração e estado; transição ativa→consumida/liberada deve ser única | Obrigatória; tabela real e índices não foram verificados |
| `asaasWebhookEvents` | Definida em schema e migration `0013`; `eventId` único e `payloadHash` disponível | Reutilizável para deduplicação síncrona se a estrutura remota for compatível; evento repetido com hash divergente é conflito | Obrigatória |
| `asaasWebhookInbox` | Não definida na base consultada | Desnecessária para processamento síncrono mínimo; passa a ser necessária se entrega assíncrona/retry durável for adotada | Não aplicável ao contrato mínimo |
| `notificationOutbox` | Não definida na base consultada | Desnecessária para reserva/pagamento STOCK; notificações não fazem parte deste incremento | Não aplicável ao contrato mínimo |
| `auditLogs` | Definida na base | Reutilizável para trilha operacional, mas não substitui unicidade transacional de tentativa/evento; não necessária ao núcleo de estoque | Obrigatória se for usada em produção |

### Invariantes requeridos do futuro DDL/adapter

- Todas as operações de pedido, snapshots e reserva pertencem a uma transação InnoDB.
- A reserva precisa ser atômica por `variantId`: update condicional de unidades disponíveis ou lock de linha mais soma de reservas ativas, com serialização para toda tentativa concorrente.
- Tentativa tem chave única e fingerprint dos itens. Repetição idêntica retorna a mesma ordem/correlação; reutilização da chave com outro payload falha.
- SKU, tamanho, cor, quantidade e preço são copiados do catálogo autoritativo para `orderItems`; preço do cliente é ignorado.
- Uma confirmação válida consome a reserva somente na primeira transição de pagamento pendente para pago. Falha/cancelamento libera somente na primeira transição pendente para terminal.
- O evento de webhook usa `eventId` único e hash do payload; assinatura deve ser validada antes da mutação. Pagamento e valor devem corresponder à tentativa.
- A chave de idempotência do provider é estável (`stock:<orderId>`). Resultado ambíguo do provider mantém reserva para reconciliação; não liberar inventário diante de timeout incerto.
- O gate público deve executar antes de qualquer consulta, reserva ou IO financeiro. O middleware já existente em `paymentRoutes.ts` permanece fail-closed.

Nenhum DDL foi executado ou proposto em arquivo SQL nesta rodada. Antes de desenhar DDL aplicável, fazer attestation read-only do schema de produção e validar o contrato em MySQL descartável isolado.

## Implementação nesta candidata

`server/stock/stockCheckout.ts` define um núcleo de domínio STOCK sem dependência de PREORDER: valida `variantId`, pertencimento, atividade, dimensões, preço autoritativo, snapshots, tentativa idempotente, reserva via porta atômica, correlation idempotente do provider, deduplicação/validação de webhook e transições de consumo/liberação. O contrato exige que a implementação de `StockCheckoutStore` use transações SQL e restrições únicas. Não há adapter MySQL nesta rodada, pois a base/schema remoto não está atestado.

O checkout público existente não foi conectado ao núcleo. Ele continua fechado pelo middleware de `PUBLIC_SITE_MODE=store` e `PUBLIC_CHECKOUT_ENABLED=true`; nenhum flag foi habilitado. A futura integração também depende de compatibilidade com o frontend.

Comportamento reaproveitado de staging: gate fail-closed antes de handlers; preço calculado no servidor; tentativa/evento com idempotência; reservas e confirmação como transições controladas; uso de chave estável do provider. Não foram portados serviços PREORDER, lotes, recuperação financeira, admin, logística, migrações `0021–0025` ou código incidental.

## Estado dos gates locais

- Typecheck: bloqueado antes da compilação (`tsc: not found`); build: bloqueado antes da compilação (`vite: not found`); teste sintético Vitest: bloqueado antes da execução (`vitest: not found`). A worktree está sem `node_modules`; não instalei dependências implicitamente. Node disponível: `v22.23.2`; gerenciador declarado: pnpm `10.4.1`.
- A suíte sintética Vitest cobre gate fechado sem IO, ownership/atividade/preço/snapshot, concorrência da última unidade, replay e payload alterado, falha definitiva versus resultado ambíguo do provider, webhook inválido, mismatch de valor, deduplicação, consumo e liberação. Os casos Vitest foram escritos, mas não executados.
- Smoke sintético direto em Node 22.23.2 com TypeScript transform experimental: 4 checks passaram (gate sem IO, concorrência da última unidade, pagamento + replay duplicado e liberação em falha definitiva). Isso não substitui typecheck, Vitest ou MySQL.
- MySQL: sem adapter e sem banco descartável configurado; testes MySQL não executados.
- Dados de teste planejados/implementados são sintéticos; nenhum Railway, Asaas ou MySQL remoto foi acessado.

## Veredito

`IMPLEMENTATION_STATUS=incremento de domínio local; não integrado ao runtime`

`PRODUCTION_ATTESTATION_REQUIRED=sim`

Bloqueios antes de considerar deploy: attestation de schema de produção; validação de compatibilidade/DDL em MySQL descartável e depois revisão de compatibilidade com schema atestado; backup externo comprovadamente restaurável; homologação Asaas sandbox; revisão frontend; adapter MySQL transacional; execução dos gates locais com dependências instaladas em ambiente aprovado.

`REMOTE_CHANGES=NONE`
