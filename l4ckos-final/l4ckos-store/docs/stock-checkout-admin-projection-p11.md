# RC3 Gate P11: projeção administrativa STOCK

> Reconciliação posterior: o exemplo de migration abaixo usou `isActive DEFAULT 1` e foi supersedido pelo contrato P13 e pela candidata 0027. A política vigente para novas linhas e variantes históricas não revisadas é `isActive DEFAULT 0`; não aplicar o SQL antigo deste documento.

## Modelo de dados

O `stockCheckoutAttempts` continua sendo a fonte financeira STOCK: contém a tentativa, estado do provider, referência de pagamento, eventos deduplicados e snapshots. `orders` é uma projeção operacional transacional, não uma segunda fonte de pagamento. Não foi criada tabela `payments` paralela.

Na criação da tentativa, a transação MySQL cria uma linha em `orders` com `userId` autenticado, valor calculado, `stockAttemptId` único e status `pending/unconfirmed`; insere `orderItems` com `variantId`, SKU, tamanho, cor, preço unitário e quantidade; cria a tentativa STOCK e reserva por variante. O ID numérico de `orders` é a referência externa/canônica para provider e webhooks, e a FK da tentativa aponta para esse pedido.

Quando chega pagamento definitivo, a mesma transação valida/deduplica evento, associa `stockPaymentId`, muda tentativa para paga, consome inventário e muda o pedido para `paid/confirmed`, com `paymentConfirmationSource=asaas_webhook` e referência do pagamento. Falha em qualquer escrita aborta toda a transação; retry do evento é possível porque a reivindicação do webhook também sofre rollback. Falha definitiva/cancelamento libera a reserva e projeta `orders.status=cancelled`. Expiração segura sem provider também cancela a projeção. Estados ambíguos mantêm a reserva e o pedido pendente.

As consultas existentes de pedidos usam `orders`, `users`, `stockReservations` e `products`; o adapter grava as reservas com `orderId`, `userId` e `productId` esperados por essas consultas e os snapshots de variante usados pela lista/detalhe administrativo. A propriedade do cliente continua sendo `orders.userId`. O fixture confirmou as linhas, snapshots e query de listagem equivalente; a função Drizzle real não foi conectada ao banco do harness porque `getDb()` preserva o guard TLS de produção, que recusa host loopback. Não enfraqueci esse guard.

As rotas admin existentes continuam mostrando e atualizando a projeção. Pagamento STOCK não pode ser confirmado manualmente, pedido STOCK não pode ser reaberto/cancelado pelo formulário genérico, e transição para processamento/expedição/entrega é rejeitada se faltar snapshot completo de endereço. O checkout V1 ainda não persiste endereço; então expedição permanece bloqueada até contrato autorizado para gravar esse dado.

## Delta de schema proposto

As colunas abaixo são um contrato para revisão, não uma migration. Nenhum SQL de produção foi executado. Antes de preparar DDL aplicável, verificar schema remoto, valores existentes, collations, signedness, índices duplicados, constraints e dados legados.

```sql
-- productVariants: catálogo canônico STOCK; preencher identidade antes de ativar as restrições.
ALTER TABLE productVariants
  ADD COLUMN size VARCHAR(60) NULL,
  ADD COLUMN color VARCHAR(60) NULL,
  ADD COLUMN reservedStock INT NOT NULL DEFAULT 0,
  ADD COLUMN isActive INT NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX productVariants_sku_unique ON productVariants (sku);
CREATE UNIQUE INDEX productVariants_product_color_size_unique ON productVariants (productId, color, size);
-- CHECK: 0 <= reservedStock <= stock; isActive IN (0,1).

-- Projeção única da tentativa e associação auditável do pagamento.
ALTER TABLE orders
  ADD COLUMN stockAttemptId VARCHAR(120) NULL,
  ADD COLUMN stockPaymentId VARCHAR(120) NULL;
CREATE UNIQUE INDEX orders_stockAttempt_unique ON orders (stockAttemptId);
CREATE UNIQUE INDEX orders_stockPayment_unique ON orders (stockPaymentId);

-- Snapshots imutáveis em linhas de pedido existentes.
ALTER TABLE orderItems
  ADD COLUMN variantId INT NULL,
  ADD COLUMN skuSnapshot VARCHAR(120) NULL,
  ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
  ADD COLUMN colorSnapshot VARCHAR(60) NULL;
-- Após confirmar signedness dos IDs: FK variantId -> productVariants.id.

-- Correlaciona as reservas existentes com tentativa/variante e conserva identidade histórica.
ALTER TABLE stockReservations
  ADD COLUMN attemptId VARCHAR(120) NULL,
  ADD COLUMN variantId INT NULL,
  ADD COLUMN skuSnapshot VARCHAR(120) NULL,
  ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
  ADD COLUMN colorSnapshot VARCHAR(60) NULL,
  ADD COLUMN unitPriceCents INT NULL;
CREATE UNIQUE INDEX stockReservations_attempt_variant_unique ON stockReservations (attemptId, variantId);
CREATE INDEX stockReservations_order_idx ON stockReservations (orderId);
CREATE INDEX stockReservations_user_product_idx ON stockReservations (userId, productId);
CREATE INDEX stockReservations_variant_status_idx ON stockReservations (variantId, status);
CREATE INDEX stockReservations_attempt_status_idx ON stockReservations (attemptId, status);
-- FK adicional para stockCheckoutAttempts.attemptId, criada junto com as tabelas do fixture.
-- stockReservations.variantId também referencia productVariants.id.
```

Além das alterações em tabelas legadas, as tabelas `stockCheckoutAttempts`, `stockCheckoutItems` e `stockWebhookEvents` do fixture precisam ser criadas segundo `server/stock/fixtures/mysql8-stock-schema.sql`; essa definição não é migration definitiva. O fixture sintético modela a projeção e usa IDs assinados compatíveis com o `drizzle/schema.ts` atual. Ele difere da base declarada: `productVariants` ainda não declara `size`, `color`, `reservedStock` e `isActive`; `orders` não declara as duas referências STOCK; `orderItems` não declara snapshots; e `stockReservations` legada não declara tentativa/variante. DDL e backfill são bloqueadores concretos. O adapter falhará fechado se essas estruturas estiverem ausentes.

Rollback de DDL ainda não foi definido: índices/colunas poderiam ser removidos apenas depois de provar que não existem tentativas ou pedidos STOCK referenciados. Não há rollback executável sem attestation e backup restaurável.

## Harness HTTP e recuperação

O teste `stockCheckout.integration.mysql.test.ts` sobe um Express/tRPC real em loopback, com sessão sintética baseada em cookie, banco MySQL 8.4 descartável e provider fake. O webhook é uma rota exclusiva do harness e usa segredo sintético; ela não é registrada no servidor normal. O runtime padrão continua ausente do contexto e o gate público continua fechado.

Casos exercitados: criação/reserva, replay sem segunda chamada fake, leitura autenticada, 404 para outro usuário, sessão anônima, payload extra rejeitado, webhook inválido/válido/duplicado, pagamento confirmado e inventário consumido, projeção administrativa e snapshot de variante, usuário estrangeiro sem visibilidade, falha injetada após atualização de confirmação com rollback de tentativa/pedido/estoque/evento, retry recuperado, cancelamento terminal e runtime ausente.

Vitest focado: 43/43 PASS. MySQL 8.4 descartável: 25/25 PASS. `pnpm check` PASS. `pnpm build` PASS.

Não foi executado browser E2E. O harness usa sessão de teste e não está conectado a Vite/React; a infraestrutura de banco da aplicação mantém a restrição TLS para o host autorizado. O caminho de listagem foi verificado por consulta SQL equivalente sobre a fixture, não por `admin.ordersList` real. O HTTP E2E testou `appRouter.stockCheckout` real; a rota de webhook existe apenas no harness local.

## Bloqueios

- Attestation remota de schema, incluindo signedness, collation, estado dos produtos/variantes, índices/constraints e histórico de migrations.
- Backfill revisado para `size`, `color`, SKU e atividade nas variantes legadas. Não inferir cor/tamanho de `name` sem regra aprovada.
- Endereço de entrega persistido com snapshot antes de permitir expedição. O adapter não copia endereço V1.
- Teste navegador com sessão local real e rotas reais.
- Revisão de auditoria/admin, especialmente mudança de status de expedição e cancelamento/refund.
- Backup externo restaurável e homologação sandbox Asaas antes de qualquer rollout.

`REMOTE_CHANGES=NONE`
