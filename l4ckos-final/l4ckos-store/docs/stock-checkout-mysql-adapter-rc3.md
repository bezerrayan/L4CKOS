# RC3 Gate P5: adapter MySQL STOCK

## Origem e isolamento

- Worktree detached: `/home/yan/Documentos/l4ckos/worktrees/l4ckos-stock-checkout-forwardport`
- SHA-base/HEAD: `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156`
- Repositório: `bezerrayan/L4CKOS`; branch vazia por estar detached.
- Preservado: os arquivos P4 de domínio, testes e relatório não foram removidos nem substituídos.
- Os três arquivos TLS MySQL conferem com a base; `mysqlTls.mjs` SHA-256 `cbca4e4152a6722695f7f4181a88a0d118c6ca595224e91b3406fa0dd36cc7e0`.
- Nenhuma outra worktree foi modificada. O adapter não altera rotas, configuração do checkout ou provider real.

## Adapter e transações

`server/stock/mysqlStockCheckoutStore.ts` implementa `StockCheckoutStore` em torno de um pool MySQL injetado. Não cria pools nem conexões próprias fora de `pool.getConnection()` dentro do boundary transacional, portanto mantém os guards TLS/identidade aplicados ao pool chamador.

Cada operação abre uma transação `READ COMMITTED`; qualquer exceção executa rollback antes de devolver a conexão ao pool. Se rollback também falhar, o adapter retorna `AggregateError` preservando os dois erros.

### Bloqueios e overselling

- Lê as variantes pedidas em ordem crescente de `variantId`, com `FOR UPDATE OF v`; o join confirma que o produto existe.
- A reserva volta a bloquear a linha com `SELECT ... FOR UPDATE`, valida atividade/saldo e executa `UPDATE ... WHERE stock - reservedStock >= quantity`.
- `reservedStock` é atualizado na mesma transação da linha de reserva. A constraint `reservedStock <= stock` dá uma segunda barreira.
- IDs de variante são bloqueados em ordem estável. Reservas são liberadas/consumidas em ordem de variante, depois de bloquear a tentativa, evitando ordem de lock divergente.
- Consumo reduz estoque disponível e reservado em conjunto; atualização de tentativa, saldo e estado de reserva confirmam ou fazem rollback como unidade.

### Idempotência e falha

- `attemptId` é PK; `orderId` também é único. A tentativa e snapshots são inseridos antes das reservas na mesma transação. Duas criações concorrentes se resolvem pela constraint única; a vencedora é recarregada e comparada pelo fingerprint. Payload diferente falha.
- Preço, SKU, tamanho, cor e quantidade vêm do catálogo e ficam no snapshot. Replay usa o preço congelado mesmo após alteração no catálogo.
- Correlação de pagamento é única e só pode repetir com o mesmo payment ID e URL.
- A chave do provider continua estável (`stock:<orderId>`). Os testes usam provider sintético; o adapter não cria cobranças.
- Falha definitiva antes da criação da cobrança move a tentativa a released e devolve unidades na transação. Timeout/resultado desconhecido mantém a reserva ativa para reconciliação; retry usa a mesma chave.
- O webhook grava `eventId` e hash na mesma transação das transições. Mesmo ID/hash retorna duplicate; mesmo ID com outro hash retorna conflict. Assinatura, associação e valor continuam validados na camada de domínio.
- Evento de pagamento chama `markPaid` e consome no mesmo transaction boundary; eventos distintos para a mesma confirmação não consomem estoque de novo. Cancelamento/falha marca released e libera uma única vez.

## Schema MySQL 8.4 sintético

Fixture executada: `server/stock/fixtures/mysql8-stock-schema.sql`. É exclusivamente teste descartável, não migration. O teste só aceita host loopback, database `l4ckos_stock_test`, usuário `stock_test` e MySQL 8.4.11.

| Tabela | Colunas centrais | Índices/constraints |
| --- | --- | --- |
| `products` | `id`, `name` | PK `id` |
| `productVariants` | `id`, `productId`, `sku`, `size`, `color`, `price`, `stock`, `reservedStock`, `isActive` | PK; SKU único case-insensitive; opção produto/cor/tamanho única; FK para produto; checks de saldo e atividade |
| `stockCheckoutAttempts` | `attemptId`, `fingerprint`, `orderId`, `status`, `amountCents`, `paymentId`, `checkoutUrl`, timestamps terminais | PK tentativa; `orderId` e payment ID únicos; índice status/data |
| `stockCheckoutItems` | `attemptId`, `lineNumber`, `variantId`, `productId`, snapshots SKU/tamanho/cor/preço/quantidade/total | PK tentativa/linha; FKs tentativa/variante/produto; índice variante; check quantidade |
| `stockReservations` | `id`, `attemptId`, `variantId`, `quantity`, `status`, `expiresAt`, `createdAt` | PK; tentativa/variante única; índices variante/status e tentativa/status; FKs; check quantidade |
| `stockWebhookEvents` | `eventId`, `payloadHash`, `receivedAt` | PK `eventId` |

Todos usam InnoDB. A fixture não contém dados pessoais, shipping, provider real, admin, PREORDER ou logística.

### Diferenças e dependências remotas

- Na base de produção, `products`, `productVariants`, `orders`, `orderItems`, `stockReservations`, `asaasWebhookEvents` e `auditLogs` aparecem no schema/migrations legados. Isso não prova o schema implantado.
- O modelo-base de `productVariants` não inclui identidade completa de tamanho/cor/atividade nem contador `reservedStock`; `stockReservations` é legado no nível de produto; `orderItems` não tem o conjunto de snapshots deste adapter.
- `stockCheckoutAttempts`, `stockCheckoutItems` e `stockWebhookEvents` são nomes exclusivos da fixture/candidata. Não são tabelas de produção atestadas.
- A fixture substitui `orders`/ `orderItems` reais por tabelas isoladas da candidata. Nenhuma equivalência ou compatibilidade de DDL foi presumida. `payments`, `asaasWebhookInbox` e `notificationOutbox` não são usados.
- Colunas, tipos, engines, collation, constraints, grants, índices, estado dos dados e compatibilidade de `productVariants`/reservas no MySQL remoto permanecem sem comprovação. Não houve acesso remoto.
- `expiresAt` é registrado, mas esta rodada não implementa sweeper de expiração; reservas ambíguas devem permanecer retidas até reconciliação explícita.
- A adaptação futura às tabelas/colunas reais exige attestation de schema, DDL aprovado e validação local descartável. A fixture não deve ser promovida como migration.

## Runner e resultados

`scripts/run-stock-mysql-tests.sh` exige Node 22.23.2, pnpm 10.4.1 e imagem local `mysql:8.4.11`; não baixa imagem. Inicia um contêiner sem volume, publica uma porta apenas em loopback, cria usuário de teste sem usar root nas conexões da suíte e remove o contêiner ao sair. Credenciais são sintéticas e só existem no contêiner.

- Instalação: `pnpm install --offline --frozen-lockfile`, lockfile preservado e pacotes reutilizados do cache.
- Typecheck `pnpm check`: PASS.
- Build `pnpm build`: PASS.
- Vitest completo `pnpm test`: PASS, 78 testes aprovados; 12 testes MySQL ignorados sem o runner, conforme proteção de alvo.
- Integração `scripts/run-stock-mysql-tests.sh`: PASS, 12 testes em MySQL 8.4.11 descartável.
- Corrida da última unidade: exatamente 1 das 2 tentativas concorrentes reservou; banco terminou com `stock=1`, `reservedStock=1` e 1 reserva ativa.
- Os testes também cobrem duas variantes do mesmo produto, alteração de preço/replay, payload de tentativa conflitante, corrida idempotente na mesma tentativa, rollback durante reserva e consumo, provider sintético definitivo/ambíguo, confirmações duplicadas, conflito de webhook, cancelamento e persistência após criar um pool novo.
- O contêiner foi removido pelo runner. Nenhum Asaas real, Railway, MySQL remoto, push, deploy ou checkout público foi usado/habilitado.

## Estado

`ADAPTER_STATUS=implementado e validado localmente contra o schema sintético; não conectado às rotas`

`MYSQL_SCHEMA_SYNTHETIC=PASS; sem aplicação fora do contêiner descartável`

`REMOTE_CHANGES=NONE`

Próximos gates: attestation do schema de produção; decisão de compatibilidade/DDL; revisão frontend; integração às rotas somente em rodada autorizada; backup externo restaurável e Asaas sandbox antes de qualquer avaliação de release. Este resultado local não autoriza deploy.
