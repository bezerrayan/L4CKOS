# L4CKOS RC3 P16 — runner local para attestation MySQL

**Estado:** runner one-shot, imagem local e harness MySQL descartável implementados. O teste comprovou leitura completa de metadata com `REFERENCES` sem permitir leitura de linhas nas tabelas STOCK. Nenhuma identidade ou grant remoto foi criado; nenhuma conexão/SQL de produção foi executada; nenhuma imagem ou serviço Railway foi publicado/criado.

Worktree: `l4ckos-stock-checkout-forwardport/l4ckos-final/l4ckos-store`; base `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156`. O trabalho local P4–P15 foi preservado.

## Artefatos

- `scripts/mysql-schema-attestation.mjs`: CLI one-shot; host privado fixo; CA TLS local validada por SHA-256; verificação de hostname; TLS mínimo 1.3; timeout de conexão/consulta; SQL fixo e allowlisted; JSON sanitizado; encerra a conexão em sucesso ou falha.
- `scripts/mysql-attestation-runner/Dockerfile`: imagem Node `22.23.2`, dependência `mysql2@3.16.3` lockada, usuário `node`, sem servidor HTTP e entrypoint que termina após uma execução.
- `scripts/run-mysql-schema-attestation-tests.sh`: MySQL 8.4.11 descartável, TLS 1.3 sintético, grants de teste, porta somente loopback e limpeza de container/certificados no encerramento.
- `server/database/mysqlSchemaAttestation.test.ts`: testes unitários e de integração MySQL.

O runner executa apenas `SELECT` fixo em `INFORMATION_SCHEMA`, a identidade/TLS da sessão, `SHOW GRANTS` e, opcionalmente, a leitura delimitada do histórico de migrations após confirmação explícita. Não recebe SQL do usuário, não lê linhas operacionais e não envia DDL/DML. A conexão não seleciona schema default; o schema esperado é filtro parametrizado e aparece no JSON.

## Privilégios mínimos comprovados

O teste inicial em MySQL confirmou que uma permissão de coluna expõe só parte da metadata e pode fazer um schema parecer incompleto. O teste seguinte comprovou que `REFERENCES` tabela a tabela permite listar todas as colunas, índices e constraints, mas `SELECT * FROM orders` é negado. MySQL expõe metadata de objetos aos quais o usuário tem privilégio; `REFERENCES` é necessário para criar FKs contra uma tabela, e esse usuário não recebe `CREATE`, `ALTER` ou qualquer privilégio na tabela filha. Portanto, o principal não consegue ler linhas nem modificar estruturas por conta própria ([visibilidade de INFORMATION_SCHEMA](https://dev.mysql.com/doc/refman/8.4/en/information-schema-introduction.html), [privilégio REFERENCES](https://dev.mysql.com/doc/refman/8.4/en/privileges-provided.html), [requisito de FK](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)).

A allowlist cobre só dependências do contrato STOCK V1 e reconciliação do webhook legado:

```text
users, products, productVariants, orders, orderItems, stockReservations,
auditLogs, asaasWebhookEvents, userAddresses, stockCheckoutAttempts,
stockCheckoutItems, stockWebhookEvents
```

`payments`, `asaasWebhookInbox`, `notificationOutbox`, `productReviews` e `productReviewUploads` foram excluídas: P13 as classifica como desnecessárias ao núcleo STOCK V1 atual. `REFERENCES` é concedido somente nas tabelas allowlisted que o DBA primeiro confirmar como existentes. A ausência de resultado não distingue tabela ausente de falta de grant; `uncoveredAllowlistTables` sinaliza essa ambiguidade.

O processo exige estes gates antes de conectar:

```text
MYSQL_ATTESTATION_APPROVED=YES
MYSQL_ATTESTATION_PRIVILEGE_ACK=REFERENCES_METADATA_ONLY
```

Eles não substituem a aprovação formal, não são credenciais e não habilitam host diferente. `SHOW GRANTS` é verificado no início; a execução falha em `SELECT` operacional, roles, grants globais, privilégios inesperados, `TRIGGER` ou `GRANT OPTION`. O executor só receberá `USAGE` e `REFERENCES` tabela a tabela, sem acesso a linhas.

### Triggers

O privilégio `TRIGGER` permite operações DDL e é recusado. A lista de triggers fica `not_attested`; isso não significa que não existem triggers. Um DBA/executor administrativo autorizado deve fornecer a consulta separada abaixo, que devolve apenas nome, tabela, timing e evento, sem `DEFINER` nem `ACTION_STATEMENT`. Não conceder `TRIGGER` ao runner ([acesso à metadata de triggers](https://dev.mysql.com/doc/refman/8.4/en/information-schema-triggers-table.html), [privilégios MySQL](https://dev.mysql.com/doc/refman/8.4/en/privileges-provided.html)).

Consulta futura separada — não executada:

```sql
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
  FROM INFORMATION_SCHEMA.TRIGGERS
 WHERE TRIGGER_SCHEMA = '<schema-aprovado>'
   AND EVENT_OBJECT_TABLE IN (
     'users', 'products', 'productVariants', 'orders', 'orderItems',
     'stockReservations', 'auditLogs', 'asaasWebhookEvents', 'userAddresses',
     'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents'
   )
 ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;
```

### Histórico de migrations

O runner não presume que `__drizzle_migrations` existe nem que Drizzle é o mecanismo efetivo. A leitura opcional exige `MYSQL_ATTESTATION_HISTORY_MODE=drizzle-confirmed`, `MYSQL_ATTESTATION_HISTORY_TABLE_CONFIRMED=__drizzle_migrations` e o acknowledge separado `MYSQL_ATTESTATION_HISTORY_ROW_READ_ACK=MIGRATION_TABLE_ONLY`. Nesse modo, a conta precisa de `SELECT` somente nessa tabela fixa e lê `id`, `hash` e `created_at`, após verificar as colunas. Esse grant não é usado para tabelas operacionais; sem confirmação, qualquer `SELECT` faz o runner falhar. Não habilitar a opção antes da confirmação do DBA.

## Operação A — provisionamento pelo DBA (proposta, não executada)

Um DBA/executor administrativo autorizado deve:

1. Confirmar o database/schema exato, a origem que o MySQL verá para o serviço Railway e um `run-id` opaco único.
2. Consultar somente `INFORMATION_SCHEMA.TABLES`, filtrado pelo schema aprovado e pela allowlist acima, para descobrir quais tabelas existem. Não ampliar a lista.
3. Criar principal temporário com host de origem exato, senha aleatória por secret manager/canal seguro e `REQUIRE SSL`.
4. Conceder `REFERENCES` somente nos objetos allowlisted existentes. Não criar role, grant de schema/global, `SELECT`, `TRIGGER`, `CREATE`, `ALTER`, DML ou acesso a `mysql.*`/`INFORMATION_SCHEMA` como grant.
5. Conferir os grants efetivos. Se precisar do histórico confirmado, conceder adicionalmente `SELECT` somente em `__drizzle_migrations`, após consentimento específico para ler apenas esse ledger.
6. Revogar e apagar a conta imediatamente após a saída; remover o secret do serviço temporário.

Modelo para o executor autorizado. Substituir placeholders somente fora do chat; gerar os GRANTs por tabela **apenas para nomes retornados como existentes**. Não executar nesta rodada:

```sql
SELECT TABLE_NAME
  FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = '<schema-aprovado>'
   AND TABLE_NAME IN (
     'users', 'products', 'productVariants', 'orders', 'orderItems',
     'stockReservations', 'auditLogs', 'asaasWebhookEvents', 'userAddresses',
     'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents'
   )
 ORDER BY TABLE_NAME;

CREATE USER 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>'
  IDENTIFIED BY '<segredo gerado fora do chat>' REQUIRE SSL;

GRANT REFERENCES ON `<schema-aprovado>`.`users`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`products`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`productVariants`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`orders`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`orderItems`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockReservations`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`auditLogs`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`asaasWebhookEvents`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`userAddresses`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockCheckoutAttempts`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockCheckoutItems`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockWebhookEvents`
  TO 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
```

Revogação imediata:

```sql
REVOKE ALL PRIVILEGES, GRANT OPTION
  FROM 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
DROP USER 'l4ckos_schema_attestor_<run-id>'@'<origem-exata-aprovada>';
```

Não adaptar grants durante a execução quando um objeto estiver ausente ou sem cobertura. A saída informa a tabela como `uncovered`; o responsável decide se esse estado é esperado. Para migrações, consultar apenas o histórico confirmado e sanitizado.

## Operação B — execução one-shot

Variáveis do container; credenciais do principal entram como secrets de serviço, sem compartilhar variáveis de conexão da aplicação:

```text
MYSQL_ATTESTATION_APPROVED=YES
MYSQL_ATTESTATION_PRIVILEGE_ACK=REFERENCES_METADATA_ONLY
MYSQL_ATTESTATION_HOST=mysql-w5fk.railway.internal
MYSQL_ATTESTATION_DATABASE=<schema aprovado>
MYSQL_ATTESTATION_USER=<principal temporário>
MYSQL_ATTESTATION_PASSWORD=<secret do principal>
MYSQL_ATTESTATION_RUN_ID=<id opaco do run>
MYSQL_ATTESTATION_TIMEOUT_MS=20000
```

O schema não é selecionado como database default; seu nome só filtra metadata. O host, CA e política TLS são fixos no runner. O certificado local está pinado por fingerprint e hostname, e o cliente exige TLS 1.3; falta confirmação do DBA de que esse CA/fingerprint corresponde ao servidor atualmente ativo. Nenhum handshake remoto foi feito.

## Plano Railway (não executado)

O runner local foi construído com `scripts/mysql-attestation-runner/Dockerfile`; tag local `l4ckos-mysql-attestation-runner:p16`, imagem não publicada. Depois de aprovar as operações, o procedimento é:

1. Publicar a imagem revisada em registry autorizado, fixada por digest imutável; registrar digest. Isso ainda não ocorreu.
2. No projeto `l4ckos-production` / ambiente `production`, criar um serviço temporário do tipo Docker image usando esse digest, região `us-west2`, sem source de branch, volume, cron, porta/health server ou domínio público.
3. Manter uma réplica e configurar `Restart Policy: Never`; deixar o `ENTRYPOINT` executar uma vez e terminar. A Railway documenta tarefas curtas e que `Never` impede restart automático ([tarefas curtas](https://docs.railway.com/overview/advanced-concepts), [restart policy](https://docs.railway.com/deployments/restart-policy)).
4. Vincular o serviço ao mesmo projeto e ambiente do MySQL, habilitando somente a rede privada para alcançar `mysql-w5fk.railway.internal`; verificar que não existe endpoint público ([private networking](https://docs.railway.com/networking/private-networking)).
5. Inserir somente as variáveis acima nas configurações do serviço; marcar credenciais como sealed/secret após confirmar que o runtime recebe os valores. Nunca exibir nem recuperar secrets pela CLI ([variáveis sealed](https://docs.railway.com/variables)).
6. Revisar imagem/digest, projeto, ambiente, região, rede, restart, ausência de endpoint e nomes das variáveis. Iniciar uma vez; coletar a linha JSON e ID do deployment; não reiniciar.
7. O DBA revoga/apaga o principal. Remover variables e excluir deployment/serviço temporário. Reter só JSON sanitizado e registro de auditoria aprovado.

Criar o serviço pode gerar cobrança de compute/logs. A Railway e o DBA mantêm operações separadas: o job só usa o principal read-only de metadata; não usa credenciais administrativas.

## Resultado local

- MySQL descartável 8.4.11: **12/12 PASS** (após execução final); TLS 1.3, CA/hostname bons e ruins, leitura completa de metadata com `REFERENCES`, bloqueio de leitura de linhas, ausência de grants, SELECT não autorizado, trigger recusado, histórico opcional, timeout/cleanup, sanitização e SQL de metadata allowlisted.
- Docker build local `l4ckos-mysql-attestation-runner:p16`: **PASS**; Node `v22.23.2`; imagem não publicada.
- CLI sem flags: falha antes de conectar com JSON sanitizado.
- `pnpm check:server`: **PASS**. Build completo da aplicação não foi necessário; imagem valida o runner isolado.
- `git diff --check` e Prettier: **PASS**.

## Próxima ação e aprovação

A ação mínima é o responsável/proprietário do banco aprovar por escrito: (a) provisionamento por um DBA autorizado de principal temporário limitado a `REFERENCES` nos objetos allowlisted existentes, na origem exata do runner; (b) confirmação por canal confiável do schema, CA/fingerprint, hostname e TLS 1.3 atuais; e (c) publicação da imagem por digest e criação/execução do serviço one-shot em produção Railway. A aprovação deve indicar operador do DBA, TTL, destinatário do JSON e procedimento imediato de revogação/exclusão. Segredos permanecem fora do chat.

Para ler histórico, triggers ou metadata com privilégios diferentes, será necessária autorização separada. A permissão `TRIGGER` não será concedida ao runner; o DBA produz metadata limitada em consulta independente. A ausência de evidência de qualquer requisito mantém a execução bloqueada.

Nenhuma conta, grant, SQL remoto, imagem publicada, serviço, variável ou configuração remota foi alterada nesta rodada.

**REMOTE_CHANGES=NONE.**
