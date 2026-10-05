# Backup e restore de dados — etapa 1

Esta implementação preserva **dados** sobre um schema já preparado. Não é
bootstrap, migration, ledger ou aceite de baseline. Não execute `db:push`,
`0020` ou SQL legado para preparar um banco existente. Nenhuma operação remota
foi realizada nesta implementação.

## Inventário e implementação anterior

O código anterior em `server/db.ts` produzia JSON `{exportedAt,warnings,data}`,
com 13 SELECTs em paralelo pelo ORM compartilhado. Incluía users, products,
productVariants, productImages, orders, orderItems, coupons, productReviews,
stockReservations, userProfiles, userAddresses, userPaymentMethods e auditLogs.
Ausência de tabela virava warning/array vazio. Não havia snapshot multi-tabela,
versão de formato/schema ou checksum. O restore apagava dados e inseria arrays
pelo ORM, sem transação global, omitindo colunas físicas extras e eventos.

`audited-physical-schema.json` preserva metadados sanitizados do inventário
read-only de 2026-09-27, MySQL 8.4.11: 25 tabelas, 303 colunas, índices,
constraints e FKs. Não contém linhas, credenciais ou identificação de conexão.
É evidência histórica, não comprovação do estado remoto atual nem baseline.
`server/database/fixtures/audited-schema.json` contém SHOW CREATE sanitizado
(sem contadores AUTO_INCREMENT) exclusivamente para reproduzir esse schema nos
testes sintéticos. Não é um bootstrap final, não é carregado pelo runtime e
não deve ser executado em remoto. A migration 0013 é usada apenas para testar
a tabela opcional num banco novo de teste.

## Manifesto explícito

`server/database/tableManifest.ts`, versão 1, exige estas 25 tabelas:

```text
users products productVariants productImages coupons orders orderItems
payments paymentEvents notificationOutbox stockReservations orderEmailEvents
auditLogs cartItems favorites localAuthUsers passwordResetTokens userProfiles
userAddresses userPaymentMethods productReviews productReviewUploads
promoBanners waitlist_emails emailUnsubscribes
```

Classificações: `KNOWN`, `OPTIONAL_PENDING_RECONCILIATION`, `UNKNOWN`.
`asaasWebhookEvents` é a única opcional: ausência pré-0020 é registrada
explicitamente, presença passa a integrar o backup integralmente. Restore exige
o mesmo conjunto presente/ausente no destino; divergência exige preparar e
revisar o schema separadamente. Tabela conhecida ausente ou qualquer objeto
inesperado gera erro, nunca omissão silenciosa. O teste compara também todas as
23 tabelas ORM com o manifesto. Inclusão de tabela futura exige revisão/versionamento.

payments, paymentEvents, notificationOutbox e extensões físicas continuam
`UNKNOWN_REQUIRES_EVIDENCE` quanto à adoção funcional. O manifesto conhece sua
existência para preservação; nenhum repository, dispatch ou writer financeiro
foi criado.

## Snapshot e formato

Uma conexão mysql2 dedicada lê todas as tabelas InnoDB com `REPEATABLE READ` e
`START TRANSACTION WITH CONSISTENT SNAPSHOT`. Leituras são sequenciais na mesma
conexão; commit encerra o snapshot antes de escrever o arquivo. Inventário antes
e após as leituras detecta mudança estrutural. Não executar DDL concorrente.
Objetos não InnoDB, views, triggers, routines e events são rejeitados; exigem
um plano de preservação próprio. Versão MySQL 8.4 é exigida.

JSON v1 contém `formatVersion`, `createdAt`, `applicationCommit` (SHA completo ou
null quando indisponível), `databaseEngine`, `databaseVersion`,
`tableManifestVersion`, `schemaFingerprint`, `absentOptionalTables`, `tables` e
`artifactChecksum`. Cada tabela inclui schema observado, checksum de schema,
rowCount, checksum de linhas e todas as colunas físicas de todas as linhas.
O schema é apenas metadado de comparação: restore nunca o executa.

SHA-256 usa objetos com chaves ordenadas; checksum das linhas usa representações
canônicas ordenadas, incluindo duplicidades. Exclui apenas o contador
AUTO_INCREMENT do schema (estado do alocador não faz parte deste backup de dados).
Inclui PKs, valores UNIQUE, timestamps e todos os demais valores. DATETIME/
TIMESTAMP permanecem strings, com sessão UTC; BIGINT/DECIMAL permanecem strings;
binários usam `{binaryHex}` reversível. Inteiros não passam por float; formatos
físicos não suportados falham explicitamente. Não há reparo automático de dados.
Checksums detectam corrupção acidental, **não** autenticam um arquivo hostil.
Só restaure artefatos de origem confiável e acesso restrito.

Arquivos são criados com modo 0600 e sem sobrescrever arquivos existentes.
O backup manual usa o mesmo BACKUP_DIR de listagem/restore; falha de escrita
não desvia silenciosamente para /tmp. Novos diretórios de backup usam modo 0700.
Podem conter PII, hashes de senha e tokens necessários ao restore. Não imprima
linhas, connection strings ou valores sensíveis em logs/reports. Os erros do
mecanismo são códigos sanitizados; mensagens nativas SQL não são propagadas.
Criptografia, retenção externa, rotação e disaster recovery são responsabilidades
operacionais separadas. Arquivo no filesystem efêmero não comprova durabilidade.

## Restore seguro

Pré-requisitos: aplicação/workers/providers desligados, MySQL 8.4 local, schema
compatível preparado previamente, todas as tabelas vazias, conexão dedicada e
artefato verificado. Sem merge, DELETE, TRUNCATE, DDL, bootstrap ou backfill.

Guard exige `L4CKOS_LOCAL_RESTORE=1`, ambiente diferente de `production`, host
literal localhost/127.0.0.1/::1 e banco `l4ckos_local_*` ou `l4ckos_test_*`.
Query/fragment de URL são rejeitados para impedir override do destino. Socket
opcional deve ter formato `/tmp/l4ckos-<identificador>/mysqld.sock`. A configuração
efetiva da conexão é comparada ao destino declarado. CLI valida antes de conectar.
O endpoint administrativo mantém sua confirmação, mas respeita os mesmos guards;
restore remoto e restore em runtime production ficam bloqueados.

Uma trava GET_LOCK serializa restores cooperantes. Uma transação única verifica
tabelas vazias com locks `FOR UPDATE`, insere pais antes dos filhos e valida tudo
antes do commit. UNIQUE/CHECK/FK permanecem ativos. FKs inesperadas que contrariem
a ordem explícita são rejeitadas; não existe `FOREIGN_KEY_CHECKS=0`.
Após inserir, valida FKs físicas (inclusive compostas), ownership de orderEmailEvents,
paymentEvents/auditLogs por orderId, contagens e hashes completos. Falha em
qualquer tabela faz rollback integral. Locks não substituem manter o destino
offline; escritor externo não participante da operação não é autorizado.

IDs, centavos, NULLs e estados são preservados. Restore não grava audit novo no
snapshot, não transforma sent em pending, não reinicia tentativas, não regenera
idempotencyKey e não chama providers. orderEmailEvents preserva todos os 16
campos, incluindo processingToken, providerMessageId, scheduledAt e timestamps
de erro/sucesso. UNIQUE(orderId,eventType) permanece obrigatório no schema
compatível e é comprovado no teste real.

## Execução exclusivamente local

Use Node 22.23.2 e dependências já instaladas do lockfile pnpm. CLI não carrega
`.env`. Exemplo com usuário sintético sem senha, via socket de MySQL efêmero com
rede desabilitada (schema de ambos os bancos preparado **separadamente**):

```sh
export PATH=/home/yan/.nvm/versions/node/v22.23.2/bin:$PATH
export NODE_ENV=test
export L4CKOS_LOCAL_RESTORE=1
export L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-reconciliation-socket/mysqld.sock
export DATABASE_URL=mysql://root@localhost/l4ckos_test_source
pnpm exec tsx scripts/database-backup.ts backup /tmp/l4ckos-data.json
export DATABASE_URL=mysql://root@localhost/l4ckos_test_destination
pnpm exec tsx scripts/database-backup.ts restore /tmp/l4ckos-data.json
```

Para repetir o teste real isolado, crie um diretório novo para o socket (gravável
pelo UID mysql do container) e use a imagem MySQL 8.4 já disponível localmente:

```sh
mkdir -m 777 /tmp/l4ckos-reconciliation-socket
docker run -d --name l4ckos-reconciliation-mysql --network none \
  -v /tmp/l4ckos-reconciliation-socket:/var/run/mysqld \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4
# Aguarde o socket estar pronto; não publique portas.
L4CKOS_MYSQL_TEST=1 pnpm test
# Após os testes, remover somente este container efêmero:
docker rm -f l4ckos-reconciliation-mysql
```

A suíte cria bancos `l4ckos_test_*` vazios, fixture sintético em todas as tabelas,
backup JSON com arquivo 0600, segundo schema compatível e restore. Depois remove
somente os bancos criados por ela. Um banco preexistente com o mesmo nome causa
falha em CREATE DATABASE, sem sobrescrita/limpeza desse banco. Sem a flag MySQL,
testes reais são explicitamente skipped: isso não satisfaz o gate desta etapa.
Use uma instância efêmera exclusiva; nunca configure esses testes com `.env` remoto.

## Trace monetário da etapa

| Ocorrência/caminho | Classificação e decisão |
| --- | --- |
| schema orderItems, SELECT de reset-test-orders, backup/restore | ORDER_ITEM_UNIT_PRICE: propriedade/coluna física unitPrice, sem alias ORM price |
| orderItems.totalPrice | LINE_TOTAL: snapshot nullable histórico; novas linhas usam aritmética inteira do helper orderItemMoney |
| products.price, variantes, catálogo, checkout server/client | PRODUCT_PRICE: preço atual; preservado, sem replace global |
| orders.totalPrice, confirmação de pagamento, totais administrativos | UNRELATED ao preço unitário: total de pedido com frete/desconto, preservado |
| reserva/JOIN de produto em tracking, detalhes e alerta interno | PRODUCT_PRICE: caminhos atuais de reserva, sem writer novo de snapshot no checkout |
| templates renderOrderItems/EmailOrderSummary e emailService.js | ORDER_ITEM_UNIT_PRICE na apresentação: price/formattedPrice são texto formatado do DTO; unitPrice aceito no template é apresentação, não coluna ORM |
| shippingService/preços de frete e inputs proibidos/testes de segurança | UNRELATED: frete ou validação de input, preservado |
| SQL 0001 e snapshots Drizzle legados | ORDER_ITEM_UNIT_PRICE legado: price físico antigo, mantido imutável como histórico; não executável sobre o banco auditado |
| backups históricos existentes | Dados legados sem manifesto/checksums; rejeitados pelo restore v1, não reescritos |

Não existe writer ativo de orderItems fora do restore neste HEAD. Persistência
nova de snapshots no checkout continua mudança funcional separada, conforme o
design. Helper de novas linhas exige preço em centavos inteiro >=0, quantity
inteira >0 e total dentro de INT. Restore conserva inclusive NULL ou total
histórico diferente de unitPrice*quantity, sem recalcular. Nenhuma migration
foi criada para renome lógico, actorUserId nullable ou restocked.

## Segurança e limites verificados

CONFIRMED no código anterior: apagamento automático sem transação, perda de
colunas/tabelas/eventos e mensagens SQL em warnings podiam comprometer restauração
e expor valores. Resolvido no mecanismo v1 com cobertura física, fail-closed,
rollback e erros sanitizados. HARDENING: guard local, 0600, locks e checksum.
Nenhum pentest remoto ou alegação de equivalência do schema de produção.

O backup JSON novo é completo para dados do manifesto compatível. Continua sem
ser o backup MySQL de disaster recovery com DDL, alocadores, privilégios e retenção
externa exigido antes de uma reconciliação remota. Um GO local para ledger/bootstrap
não autoriza migration, deploy, staging, produção ou envio externo.
