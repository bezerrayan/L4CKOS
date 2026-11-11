# STOCK V1 — preparação de migration incremental

Data: 2026-11-10
Escopo: preparação local; nenhuma alteração remota autorizada ou executada.

## PRODUCTION_SCHEMA_INVENTORY

**Estado: attestation parcial disponível; inventário estrutural atual continua incompleto.**

Identidade Railway confirmada por leitura do control plane: projeto `l4ckos-production` (`5937dcf3-18ae-4df8-83f0-5bb60ec9b8db`), ambiente `production` (`7d065409-7cc2-44ba-9fff-5524653b0484`), serviço `MySQL-W5FK` (`24fd928a-dfc3-4757-8a89-1e7e92b98a7d`). A implantação reportada é `38d545bd-2279-478f-b815-344be047b472`, estado SUCCESS; o serviço não tem mudanças staged. O ambiente apresenta uma operação pendente não atribuída a este serviço.

O documento local `docs/database/audited-physical-schema.json` é um inventário sanitizado de **2026-09-27**, MySQL 8.4.11, e declara que não é baseline de aceitação. Ele lista `productVariants`, `orders`, `orderItems` e `stockReservations`, mas não `stockCheckoutAttempts`, `stockCheckoutItems` ou `stockWebhookEvents`. Não foi usado como descrição do schema atual.

Attestation sanitizada de 2026-11-10: deployment temporário de runner `2370a93d-5b19-4df5-a5fc-fa05711ecccc`, instância `ddb795f1-d26f-4b16-aebf-8821e356cdbc`, schema `railway`; informa TLS 1.3, cipher `TLS_AES_128_GCM_SHA256`, CA/leaf SHA-256 e hostname/SAN `mysql-w5fk.railway.internal`. Conforme esclarecido pelo proprietário, esse deployment é do runner, enquanto `38d545bd-2279-478f-b815-344be047b472` pertence ao serviço MySQL.

Inspeção pré-auth atual, via SSH read-only no serviço MySQL-W5FK: a CA pública recuperada de `/var/lib/mysql/ca.pem` tem SHA-256 `bc5d33922ec3d772622d9dcf19fdc95a17c7a1f0106b344e78c1169687c24c54`, igual ao pin independente aprovado em `server/database/mysqlTls.mjs` e ao hash da attestation. A CA está dentro da validade. `openssl s_client -starttls mysql` com `-verify_return_error`, `-verify_hostname mysql-w5fk.railway.internal` e `-tls1_3` retornou `Verification: OK`, peername correto, TLSv1.3 e cipher `TLS_AES_128_GCM_SHA256`. O certificado folha apresentou SAN `DNS:mysql-w5fk.railway.internal`, validade 2026-11-04–2027-11-04 e SHA-256 `6C:8D:62:A0:40:B5:0A:B7:E2:C3:FA:E4:63:4E:2B:A1:89:2A:40:61:B7:87:85:76:BC:47:0F:FB:5C:28:F6:80`. Nenhum pacote de autenticação MySQL foi enviado.

Os campos de conta da attestation dizem `created=false`, `revoked=false`, `dropped=false`, mas `absenceConfirmed=false`; não demonstram uma identidade read-only autorizada existente. A attestation **não contém** versão SQL, colunas, tipos, índices, constraints, FKs ou histórico de migrations. A allowlist registra nove tabelas presentes e as três STOCK novas ausentes (`ALLOWLIST_TABLES_MISSING`).

Colunas, tipos, índices, constraints, FKs e histórico **atuais** de `railway` permanecem desconhecidos. As queries de metadados revisadas estão em `stock-v1-production-metadata-queries-20261110.sql`; nenhuma consulta SQL foi executada por falta de credencial read-only disponível no executor.

## STOCK_SCHEMA_DIFF

**Estado: contrato reconciliado; comparação física atual incompleta.**

Fontes locais verificáveis:

- `database/bootstrap/v2/productVariants.sql` define `productVariants` com `id`, `productId`, `name`, `sku`, `price`, `stock`, timestamps, `size`, `color`, `optionKey`; inclui PK, unique `(productId, optionKey)`, índice em `productId` e CHECK `stock >= 0`. Não declara FK para `products`.
- `database/migrations/0025_product_variant_identity.sql` adiciona `isActive` com default `0` e CHECK booleano. Isso preserva as variantes existentes inativas, mas não demonstra se foi aplicado em produção.
- `database/bootstrap/v2/orders.sql` inclui `checkoutAttemptId` e `checkoutFingerprint`; o primeiro é único.
- `database/bootstrap/v2/orderItems.sql` inclui `variantId`, snapshots do item e `salesModeAtPurchase` com default `STOCK`; declara FK para `orders` e `productionBatches`, mas não declara FK de `variantId`.
- `database/bootstrap/v2/stockReservations.sql` define reserva ligada a `orders` e opcionalmente `orderItems`, com índice único de `orderItemId` e CHECK de quantidade positiva. Não declara FK para `products` ou `productVariants`.
- As fontes acima não contêm definições de `stockCheckoutAttempts`, `stockCheckoutItems` ou `stockWebhookEvents`.

P13 confirma que os quatro objetos existentes exigem expansão: `productVariants` (size/color/reservedStock/isActive e uniques/check/FK), `orders` (três correlações STOCK e uniques), `orderItems` (variantId e snapshots nullable) e `stockReservations` (correlação/tentativa, variante, snapshots e unitPriceCents nullable). P13 também descreve as três tabelas novas; os tipos concretos de attempts/items/eventos foram reconciliados com `server/stock/fixtures/mysql8-stock-schema.sql` e o adapter `server/stock/mysqlStockCheckoutStore.ts` no worktree de origem. A evidência de 10/11 confirma a ausência física das três tabelas STOCK, mas não resolve a estrutura das quatro existentes.

Delta reconciliado:

- `productVariants`: adicionar `size`/`color VARCHAR(60) NULL`, `reservedStock INT NOT NULL DEFAULT 0`, `isActive INT NOT NULL DEFAULT 0`; unique SKU e `(productId,color,size)`; checks de estoque reservado e boolean; FK de produto. `0` mantém todas as linhas preexistentes inativas, sem ativação/backfill.
- `orders`: adicionar `stockAttemptId`, `stockPaymentId`, `shippingOptionId VARCHAR(120) NULL`; unique nos dois IDs de correlação e índice `(status,createdAt)`.
- `orderItems`: adicionar `variantId INT NULL`, `skuSnapshot VARCHAR(120) NULL`, `sizeSnapshot/colorSnapshot VARCHAR(60) NULL`; índice e relações order/product/variant.
- `stockReservations`: adicionar `attemptId VARCHAR(120) NULL`, `variantId INT NULL`, snapshots SKU/tamanho/cor e `unitPriceCents INT NULL`; unique `(attemptId,variantId)`, índices de consulta e relações attempt/variant/order/product. Campos ficam nullable para as reservas antigas.
- `stockCheckoutAttempts`: PK `attemptId VARCHAR(120)`; owner, fingerprint SHA-256, `orderId`, estados enumerados, `amountCents BIGINT`, payment/URL e timestamps; uniques em order/payment, índices de status/owner/expiração, FK para order.
- `stockCheckoutItems`: PK `(attemptId,lineNumber)`; snapshots imutáveis de produto/variante/SKU/tamanho/cor/preço/quantidade/total; FKs para attempt/variant/product e CHECK quantidade positiva.
- `stockWebhookEvents`: PK `eventId VARCHAR(191)`, hash SHA-256 e `receivedAt`; sua tabela separada ainda depende de decisão de owner único contra o ledger legado.

## MIGRATION_ARTIFACT

**Estado: CANDIDATO LOCAL PREPARADO; não aprovado para aplicação.**

O SQL isolado está em `database/migrations/stock-v1/0027_stock_v1_incremental.sql`. Ele não entra no journal Drizzle nem reexecuta `0008–0017`. Inclui precondições sobre schema/alvo, tabelas, engines, IDs signed INT, colunas base de projeção/pagamento/endereço, PKs e collations; interrompe diante de estado parcial. `isActive` usa default inativo `0`; colunas históricas STOCK são nullable; não há DML/backfill. Uniques e FKs deixam o mecanismo MySQL recusar duplicatas/orphans sem consultar ou imprimir linhas comerciais. A criação de `stockWebhookEvents` segue o adapter local, mas não resolve o blocker P13/P14 de owner único do ledger webhook.

O candidato só aceita o baseline legacy genérico especificado nos comentários e fixture. A attestation atual não traz os metadados necessários para afirmar que produção corresponde a esse baseline. Qualquer aplicação futura exige comparar a saída estrutural antes e revisar o SQL contra ela. Em falha após DDL, o procedimento deixa a rotina candidata para inspeção; a execução não tenta compensar/reverter automaticamente.

P14 confirma que o journal Drizzle termina em `0007` embora existam SQLs `0008–0017`; `0014` tem múltiplos ALTERs sem separadores, `0015` remove duplicatas de avaliações e `0016` faz backfill financeiro baseado em eventos. Este candidato não edita o journal nem importa nenhum desses SQLs/backfills. Uma aplicação futura requer migration forward-only separada, saída estrutural completa e histórico real; não falsificar nem reescrever o runner/histórico.

## DISPOSABLE_TEST_RESULTS

**PASS em MySQL 9.7.2 descartável**, executado nesta continuação com o fixture sintético novo. O teste prova aplicação, reaplicação como no-op, preservação dos valores legados sintéticos, criação/verificação de FKs, rejeição por CHECK e UNIQUE, e falha por SKU duplicado após expansão de colunas (estado parcial registrado; tabelas STOCK novas não criadas). O teste não se baseia em replays anteriores. Fixture em `database/migrations/stock-v1/fixtures/legacy-baseline.sql`; runner em `database/migrations/stock-v1/run-disposable-mysql97-tests.sh`.

## DATA_INTEGRITY_RISKS

- A attestation de nomes de tabelas não revela se o candidato corresponde ao schema físico; tipos unsigned, colunas divergentes, índices, FKs e constraints ainda podem bloquear ou deixar DDL parcial.
- Sem metadados atuais, tabelas existentes ou drift podem tornar `ALTER TABLE` destrutivo ou parcialmente aplicado.
- DDL MySQL pode efetuar commit implícito; recuperação de falha exige registrar exatamente quais instruções terminaram.
- P14 reproduziu dois contadores/fluxos de estoque independentes (`products.stock` e `productVariants.stock/reservedStock`) e dois possíveis ledgers de webhook; migration de schema não resolve exclusividade de writers ou roteamento financeiro.
- Variantes e pedidos legados não devem ser inferidos, ativados ou convertidos automaticamente. Não fazer backfill financeiro.
- `stockReservations` possui restrições legadas incompletas para relações variant/product na definição local; não adicionar FKs sem comprovar que os dados existentes satisfazem o contrato.
- A lista de tabelas/colunas em um snapshot de setembro não é evidência suficiente de ausência ou presença atual.

## RECOVERY_PLAN

1. Antes de qualquer aplicação futura, capturar e aprovar snapshot estrutural e histórico read-only, conferir backup restaurável e comparar fingerprints.
2. Aplicar apenas o arquivo exato aprovado, isolado, com checksum registrado e procedimento que pare na primeira divergência. Sem runner/histórico confiável, exigir autorização específica para execução isolada; nunca inserir histórico fictício.
3. Em falha, parar imediatamente, preservar logs e estado parcial, não repetir nem reparar automaticamente. Registrar tabelas/colunas/constraints criadas e comparar com o estado prévio.
4. Planejar rollback forward-only/reverso por instrução somente depois de conhecer o estado resultante. Não remover tabelas/colunas com dados nem apagar evidência.
5. Verificar estrutura pós-operação contra o SQL aprovado; não executar backfill ou fluxo de checkout nesta etapa.

## BLOCKERS

1. Attestation de 10/11 é de nomes de tabelas/TLS apenas; faltam metadados físicos completos e histórico real de migrations.
2. Não há credencial local fornecida para um principal read-only existente; o runner P18 está inativo (`/bin/true`) e não tem variáveis de attestation.
3. P13/P14 destacam conflitos de inventário entre `products.stock` e variantes, reservas abertas legadas sem variantId e possíveis writers concorrentes; não estão resolvidos pela migration.
4. Ledger webhook único continua por decidir: legado `asaasWebhookEvents` versus `stockWebhookEvents` do adapter STOCK.
5. O default `isActive=0` do candidato difere do default `1` em `drizzle/schema.ts` no worktree de origem; rollout de código precisa alinhar criação explícita de variantes antes de ativação.
6. Duplicatas de SKU/opção e referências órfãs podem interromper DDL depois das expansões; sem attestation estrutural não se estima risco/tempo/locks.
7. Nenhum grant foi solicitado ou criado. Não se usaram consultas de dados comerciais para o candidato ou os testes.

## PRODUCTION_CHANGES

**Nenhuma.** O SQL foi executado somente em MySQL 9.7.2 descartável sem rede, com dados sintéticos. Não houve DDL/DML remoto, migration de produção, backfill, grant, deploy, alteração do checkout de produção ou liberação de pagamentos. Nenhuma linha comercial foi consultada.
