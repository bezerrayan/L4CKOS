# L4CKOS RC3 Gate P15 — preflight de attestation MySQL

**Resultado:** `ATTESTATION_READY=NO`. Esta etapa consultou apenas metadados administrativos não sensíveis da Railway e arquivos locais. Não abriu conexão MySQL, não executou SQL, não leu valores de variáveis, não modificou serviços e não criou/provisionou uma identidade.

Worktree: `l4ckos-stock-checkout-forwardport/l4ckos-final/l4ckos-store`; HEAD/base confirmado: `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156`. Alterações locais P4–P14 foram preservadas.

## PRODUCTION_TARGET

Metadados read-only da Railway consultados em 2026-11-09:

| Recurso                | Identificação observada                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Projeto                | `l4ckos-production` (`5937dcf3-18ae-4df8-83f0-5bb60ec9b8db`)                        |
| Ambiente               | `production` (`7d065409-7cc2-44ba-9fff-5524653b0484`)                               |
| Serviço de banco       | `MySQL-W5FK` (`24fd928a-dfc3-4757-8a89-1e7e92b98a7d`)                               |
| Configuração de imagem | `mysql:9` (imagem configurada; não prova versão atualmente negociada pelo servidor) |
| Rede                   | endpoint privado `mysql-w5fk`; proxy TCP de porta `3306` configurado                |
| Região                 | `us-west2`, uma réplica reportada na configuração do banco                          |

O serviço de aplicação `Github L4ckos-` (`743f3f4e-af1b-44f7-95c8-bb152e3c2f4b`) também está configurado em `us-west2` no mesmo projeto/ambiente. Isso demonstra uma possível origem privada dentro do Railway, mas não prova que seu processo seja um executor autorizado ou apropriado para consultas de attestation. Não foi identificado um job/runner temporário dedicado. Não usar o processo web de produção como executor ad hoc.

## EXECUTOR e READ_ONLY_IDENTITY

- **Executor possível:** operador autorizado em workload isolado na rede privada Railway, com escopo de execução temporário, ou o DBA executar o roteiro revisado e devolver apenas a saída sanitizada. O backend existente tem endpoint privado e região compatível, mas não é aprovado aqui como executor.
- **Identidade read-only:** não comprovada. A configuração administrativa expõe nomes de variáveis como `MYSQLUSER` e `DATABASE_URL`; nomes não provam principal, grants, alvo da conexão ou autorização. Os valores não foram consultados.
- Não há evidência de usuário dedicado previamente aprovado para attestation.
- Provisionamento futuro precisa ser feito pelo DBA/proprietário autorizado, fora desta rodada: usuário individual/dedicado, sem compartilhamento, com visibilidade somente dos metadados allowlisted do schema confirmado e sem privilégios de escrita, DDL, `FILE`, `PROCESS`, `SUPER`, administração ou acesso a dados operacionais. O DBA deve validar o conjunto mínimo de grants contra a versão real do servidor; não conceder `SELECT` em tabelas operacionais por conveniência.
- O DBA também precisa fornecer o identificador não secreto do principal autorizado, o método de autenticação/rotação sem enviar segredo ao chat, o escopo de schema, grants efetivos revisados e prazo de validade.

## NETWORK_ORIGIN

O código local aceita somente o hostname `mysql-w5fk.railway.internal`. A Railway informa endpoint privado `mysql-w5fk` e proxy TCP 3306 no serviço de banco, e a configuração administrativa coloca banco e aplicação em `us-west2`. Esses fatos são compatíveis com tráfego privado de serviço a serviço, mas não demonstram resolução DNS, caminho efetivo, política de origem nem autorização do principal.

Falta aprovação explícita do DBA para a origem exata (projeto, ambiente, workload e região) e prova de qual workload fará a conexão. O proxy TCP configurado não é autorização para usar um endpoint público. Não houve DNS lookup, túnel, conexão, teste de porta ou tentativa por outro host.

## TLS_EVIDENCE

Evidência do código local `server/database/mysqlTls.mjs`:

- exige o hostname `mysql-w5fk.railway.internal`;
- valida um CA público dedicado embutido contra fingerprint fixado no código;
- configura `rejectUnauthorized: true` e `verifyIdentity: true`.

Limites: isso comprova a política implementada na árvore local, não que a CA foi aprovada pelo operador do banco, que o serviço ativo apresenta cadeia compatível, ou que a aplicação publicada usa a mesma versão. A configuração não força explicitamente `minVersion: TLSv1.3`; não há evidência de versão/cipher negociados nesta rodada. Também não foi apresentada exigência de pinning pelo operador; há pin de CA no cliente, sem evidência de pinning de leaf/SPKI exigido. A validade operacional da CA e sua correspondência com o servidor ativo precisam ser confirmadas por canal confiável antes da attestation.

## PROPOSED_READ_ONLY_QUERIES

Roteiro a ser submetido para revisão e executado somente após identidade, origem, TLS e autorização serem comprovados. Estes comandos são propostas, não foram executados.

### 1. Identidade, schema selecionado e TLS da sessão

```sql
SELECT VERSION() AS server_version,
       DATABASE() AS selected_schema,
       CURRENT_USER() AS authenticated_principal;

SHOW SESSION STATUS
 WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher');
```

Abortar se schema, principal, versão/cipher TLS, projeto/ambiente ou hostname não corresponderem ao alvo e política aprovados. Na cópia compartilhada, sanitizar o principal conforme combinado, preservando uma indicação verificável de que corresponde ao usuário dedicado aprovado. Nunca incluir connection string.

### 2. Inventário limitado de tabelas e colunas

Usar `INFORMATION_SCHEMA.TABLES` e `INFORMATION_SCHEMA.COLUMNS`, filtrando por `TABLE_SCHEMA = DATABASE()` e por allowlist revisada do contrato: `products`, `productVariants`, `orders`, `orderItems`, `payments`, `stockReservations`, `stockCheckoutAttempts`, `stockCheckoutItems`, `asaasWebhookEvents`, `asaasWebhookInbox`, `stockWebhookEvents`, `notificationOutbox`, `auditLogs`, `userAddresses`, `productReviews` e `productReviewUploads`.

```sql
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
  FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA, COLLATION_NAME, GENERATION_EXPRESSION
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

Retornar somente nomes de tabela/coluna, tipo, ordem, nullability, default, `EXTRA`, collation e engine. Não selecionar linhas dessas tabelas. Se a lista de relações revelar recurso/schema inesperado, parar e pedir nova revisão; não ampliar o escopo durante a execução.

### 3. Índices e constraints

```sql
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
  FROM INFORMATION_SCHEMA.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
       kcu.COLUMN_NAME, kcu.ORDINAL_POSITION,
       kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
       rc.UPDATE_RULE, rc.DELETE_RULE
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
  LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS kcu
    ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND kcu.TABLE_NAME = tc.TABLE_NAME
   AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS rc
    ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND rc.TABLE_NAME = tc.TABLE_NAME
   AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
   AND tc.TABLE_NAME IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;

SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
  JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS AS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
   AND tc.CONSTRAINT_TYPE = 'CHECK'
   AND tc.TABLE_NAME IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME;
```

Retornar nome/tipo/ordem de índices, colunas de origem/destino e regras de FK/check. Omitir definers, usuários e outros identificadores internos desnecessários.

```sql
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
  FROM INFORMATION_SCHEMA.TRIGGERS
 WHERE TRIGGER_SCHEMA = DATABASE()
   AND EVENT_OBJECT_TABLE IN (
     'products', 'productVariants', 'orders', 'orderItems', 'payments',
     'stockReservations', 'stockCheckoutAttempts', 'stockCheckoutItems',
     'asaasWebhookEvents', 'asaasWebhookInbox', 'stockWebhookEvents',
     'notificationOutbox', 'auditLogs', 'userAddresses', 'productReviews',
     'productReviewUploads'
   )
 ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;
```

Não retornar `DEFINER` nem texto de `ACTION_STATEMENT` nesta etapa.

### 4. Histórico efetivo de migrations

Primeiro, o DBA precisa identificar o mecanismo histórico efetivamente usado e informar o nome exato do objeto, ou declarar que o histórico é externo/manual. O repositório local usa Drizzle e o replay descartável criou `__drizzle_migrations`, mas isso não prova que produção use essa tabela ou o mesmo mecanismo. Depois da confirmação e autorização, inspecionar apenas nomes/colunas desse objeto em `INFORMATION_SCHEMA`; se o objeto e as colunas forem confirmados, retornar somente identificador/tag, hash e timestamp de migration. Se não houver objeto identificável ou houver mais de um histórico possível, parar e solicitar confirmação; não escrever, reconciliar nem inferir aplicação por presença de colunas.

Somente se DBA confirmar o mecanismo Drizzle e a tabela/colunas correspondentes, uma consulta possível é `SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id`. Não a executar se nome, colunas ou mecanismo divergirem.

Não consultar tabelas operacionais, registros de pedidos/pagamentos, payloads, endereços, clientes, amostras, inventário, contagens de dados ou agregados financeiros nesta etapa.

## Checklist para evidência sanitizada

- [ ] Alvo conferido: projeto/ID, ambiente/ID, serviço/ID, schema e hostname privado esperados.
- [ ] DBA aprovou origem precisa do executor e o principal dedicado.
- [ ] Principal conferido como read-only e grants efetivos revisados; nenhuma credencial foi compartilhada.
- [ ] CA obtida por canal confiável, fingerprint conferido com política atual e hostname validado.
- [ ] Sessão reportou TLS/cipher dentro da política aprovada, incluindo TLS 1.3 se exigido.
- [ ] Script allowlisted revisado, com hash registrado; nenhum SQL de dados ou escrita incluído.
- [ ] Saída contém somente metadados permitidos e foi revisada para remoção de secrets/identificadores não autorizados.
- [ ] Histórico de migration foi identificado por DBA antes de qualquer leitura de tags/hashes.
- [ ] Em divergência, consulta abortada e saída parcial preservada para revisão; nenhuma tentativa a outro host.

## BLOQUEIOS E PRÓXIMA AÇÃO

`ATTESTATION_READY=NO` porque identidade read-only aprovada, origem executora autorizada e validade/negociação TLS não foram comprovadas. A região e os endpoints privados observados são metadados administrativos, não autorização de banco.

**AUTHORIZATION_REQUIRED:** DBA/proprietário precisa confirmar por canal autorizado: (1) o alvo acima; (2) o principal dedicado e seu escopo/grants; (3) origem Railway exata permitida; (4) CA/fingerprint e versão mínima de TLS atuais; e (5) se o roteiro allowlisted será executado por operador autorizado ou por executor isolado aprovado. Se for necessário provisionar usuário, isso deve ser feito pelo DBA em procedimento separado e nunca com root compartilhado.

**NEXT_ACTION:** obter essa confirmação e attestation preparada pelo DBA/executor aprovado. Depois revisar a saída sanitizada; este gate não autoriza conexão futura automaticamente. Nenhuma consulta SQL, conexão, túnel, alteração Railway, alteração de arquivo de runtime ou mudança remota ocorreu.

**REMOTE_CHANGES=NONE.**
