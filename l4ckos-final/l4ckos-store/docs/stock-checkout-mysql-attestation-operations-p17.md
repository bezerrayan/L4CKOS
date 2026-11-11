# L4CKOS RC3 P17 — ficha operacional da attestation MySQL

**Escopo:** preparação local. Não executa SQL remoto, não conecta ao MySQL, não publica imagem e não cria/implanta job Railway.

## PREFLIGHT_STATUS

**PREPARED_WITH_BLOCKERS.** O alvo informado pelo proprietário é projeto `l4ckos-production`, ambiente `production`, serviço `MySQL-W5FK`, região `us-west2`, DNS privado `mysql-w5fk.railway.internal`. Os metadados coincidem com o registro local P15, mas não foram reconsultados nesta rodada. Nenhuma identidade administrativa autorizada foi identificada por nome/credencial operacional. O nome do schema e a origem exata que o MySQL verá para o job temporário não estão comprovados.

P15 registrou a imagem configurada do serviço como `mysql:9`; isso não comprova a versão do servidor em execução. O teste local `REFERENCES` foi feito em MySQL 8.4.11. O runner coletará a versão real da sessão, mas o DBA deve confirmar a compatibilidade da permissão para a versão ativa antes do grant.

## Artefato validado

- Imagem local P16: `l4ckos-mysql-attestation-runner:p16`.
- ID local: `sha256:20636aa50de67d63f86a1d6e042674fc0569e2d5ffe110108f626f94c4c3aacf`.
- Node: `v22.23.2`; build local PASS; testes MySQL 8.4.11: 12/12 PASS.
- Essa identidade é o digest/ID da imagem local. **Ainda não há origem registry nem digest remoto verificável**, pois a imagem não foi publicada. Uma tag ou ID local não basta para selecionar a imagem no Railway.

## PRIVILEGED_OPERATION — modelo, não executar

Operador: DBA do serviço MySQL autorizado pelo proprietário. Identidade administrativa existente, nome do operador e mecanismo auditável de execução ainda precisam ser confirmados. Não usar root compartilhado.

Principal: `l4ckos_schema_attestor_p17_<run-id>` com host MySQL exatamente igual à origem de rede aprovada para o job. Evitar `%` e curingas. O endereço/origem do job só poderá ser confirmado após existir o serviço isolado; portanto, criar o principal antes disso não é seguro.

Prazo: validade operacional máxima de **30 minutos a partir do primeiro GRANT**. MySQL não aplica esse prazo automaticamente à conta; o DBA deve agendar revogação imediata e um limite rígido T+30min. Se o job não iniciar no prazo, revogar e reiniciar o procedimento com novo principal/run-id.

O conjunto de grants permitido é `USAGE` e `REFERENCES` em cada tabela existente desta allowlist, individualmente:

```text
users, products, productVariants, orders, orderItems, stockReservations,
auditLogs, asaasWebhookEvents, userAddresses, stockCheckoutAttempts,
stockCheckoutItems, stockWebhookEvents
```

Sem `SELECT` nessas tabelas, `CREATE`, `ALTER`, DML, `TRIGGER`, roles, grant global ou `GRANT OPTION`. `REFERENCES` expõe a metadata necessária, sem leitura de linhas; o runner recusa privilégios inesperados. O histórico `__drizzle_migrations` permanece desativado. Caso seja confirmado como mecanismo efetivo, exige aprovação separada para `SELECT` somente nessa tabela.

Operação administrativa a executar **somente depois de aprovada** e após confirmar schema/origem. Conceder somente linhas `GRANT` cujas tabelas retornaram da consulta allowlisted:

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

CREATE USER 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>'
  IDENTIFIED BY '<secret aleatório fornecido por canal seguro>' REQUIRE SSL;

GRANT REFERENCES ON `<schema-aprovado>`.`products`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`users`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`productVariants`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`orders`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`orderItems`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockReservations`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`auditLogs`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`asaasWebhookEvents`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`userAddresses`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockCheckoutAttempts`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockCheckoutItems`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
GRANT REFERENCES ON `<schema-aprovado>`.`stockWebhookEvents`
  TO 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';

SHOW GRANTS FOR 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
```

Cada `GRANT` cuja tabela não exista deve ser omitido; não adaptar a allowlist.

Antes de entregar a credencial ao job, comparar os grants com a lista exata esperada e confirmar ausência de `SELECT`, roles, privilégios de escrita/DDL e `GRANT OPTION`. Não imprimir senha nem connection string.

Revogação, executada imediatamente após coleta, falha ou ao atingir T+30min:

```sql
REVOKE ALL PRIVILEGES, GRANT OPTION
  FROM 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
DROP USER 'l4ckos_schema_attestor_p17_<run-id>'@'<origem-exata-do-job>';
```

Depois, confirmar `SHOW GRANTS`/ausência da conta em evidência sanitizada pelo DBA e remover as variáveis secretas do serviço.

## RAILWAY_JOB_SPEC

- Projeto/ambiente/região: `l4ckos-production` / `production` / `us-west2`.
- Serviço: temporário de imagem Docker, execução one-shot, sem branch/source de aplicação, cron, volume, porta, health server, domínio ou proxy público.
- Imagem: somente a imagem P16 cujo digest for publicado e comparado com o artefato aprovado. Registry ainda não escolhido nem autorizado; não substituir por imagem homônima.
- Runtime: uma réplica; `Restart Policy: Never`; `ENTRYPOINT` atual; sem start command; iniciar uma vez e não reiniciar.
- Rede: serviço no mesmo projeto/ambiente do MySQL e rede privada apenas. Confirmar região e hostname interno antes da execução.
- Variáveis não secretas: `MYSQL_ATTESTATION_APPROVED=YES`, `MYSQL_ATTESTATION_PRIVILEGE_ACK=REFERENCES_METADATA_ONLY`, `MYSQL_ATTESTATION_HOST=mysql-w5fk.railway.internal`, `MYSQL_ATTESTATION_DATABASE=<schema confirmado>`, `MYSQL_ATTESTATION_RUN_ID=<id opaco>`, `MYSQL_ATTESTATION_TIMEOUT_MS=20000`.
- Secrets sealed: somente `MYSQL_ATTESTATION_USER` e `MYSQL_ATTESTATION_PASSWORD`; nunca referenciar variáveis compartilhadas da aplicação. Não recuperar ou imprimir valores pela CLI.
- Saída: uma linha JSON do runner; guardar somente JSON sanitizado, deployment ID e digest. Resultado de sucesso local tem `status=partial` enquanto triggers não forem atestados.

O ID local atual não pode ser usado como source no Railway sem publicação em registry. A publicação e criação do serviço são ações remotas e estão pendentes de aprovação específica.

## TLS_VALIDATION

O runner valida a CA fixada em código (`SHA-256 bc5d33922ec3d772622d9dcf19fdc95a17c7a1f0106b344e78c1169687c24c54`), hostname `mysql-w5fk.railway.internal` e TLS mínimo 1.3. P16 provou esses controles somente contra certificado/MySQL sintéticos. Falta DBA confirmar por canal confiável a CA/fingerprint e a política TLS/hostname do servidor ativo. Não testar DNS, porta ou handshake nesta etapa.

## CLEANUP_PLAN

1. Revogar e remover o principal imediatamente após resultado/falha e, em qualquer caso, até T+30min do primeiro GRANT.
2. Confirmar conta removida e ausência dos grants; registrar operador, horário e run-id, sem segredos.
3. Remover as variáveis sealed do serviço.
4. Remover deployment e serviço temporário Railway; confirmar que não há domínio, réplica ativa, restart pendente ou cron.
5. Remover o digest/tag da registry aprovada após registrar o digest e preservar evidência conforme política; reter somente JSON sanitizado e trilha de auditoria.
6. Conferir limpeza de usuário, secret, deployment, serviço e imagem remota. A imagem local não é removida por este procedimento.

## EXACT_EXECUTION_STEPS

1. Obter as aprovações listadas abaixo; DBA confirma schema, identidade administrativa, CA/fingerprint/TLS, região e política de origem.
2. Publicar a imagem P16 em registry aprovado e verificar o digest remoto contra a imagem aprovada.
3. Criar o serviço temporário sem secrets, sem endpoint público, com rede privada e `Restart Policy: Never`; iniciar em estado não executado e confirmar a origem exata que o MySQL verá. Não iniciar o processo ainda.
4. DBA cria a conta para essa origem exata, concede `REFERENCES` por tabela existente, verifica os grants e inicia o limite T+30min.
5. Inserir secrets sealed, conferir nomes sem revelar valores e revisar o deployment/digest/alvo.
6. Executar uma vez. Validar schema do JSON, run-id, schema, principal, TLS 1.3, grants e lista de tabelas cobertas. Como o runner não lê triggers, anexar a evidência sanitizada separada do DBA; sem isso a attestation fica parcial.
7. Revogar/remover a conta primeiro; confirmar; remover secrets e serviço/deployment; remover imagem remota conforme política; conferir limpeza e arquivar JSON sanitizado.

O serviço precisa existir para revelar sua origem de rede, mas a conta não deve existir ainda nessa etapa. Assim, a sequência segura difere da ordem inicial “provisionar, depois publicar/criar job”: preparar o serviço desativado primeiro, confirmar a origem, provisionar a identidade e só então executar.

## REMAINING_APPROVALS

1. **DBA/proprietário:** confirmar nome do DBA executor autorizado, schema, host/origem exata a permitir, TTL de 30 minutos, grants `REFERENCES` e procedimento de revogação.
2. **DBA/proprietário:** confirmar CA/fingerprint atualmente esperado, hostname e exigência TLS 1.3.
3. **Proprietário Railway:** aprovar registry de publicação, criação do serviço temporário no projeto/ambiente/região acima e custo transitório de compute/logs. A autorização P17 cobre preparação, não essas mutações.
4. **Responsável pelo resultado:** designar destinatário e local de retenção do JSON sanitizado e deployment/digest.

Não pedir credenciais em texto aberto; provisionamento de senha e sealed variables ocorre diretamente nos canais aprovados.

## BLOCKERS

- Origem exata do job ainda não existe/não foi descoberta; por isso, não é possível emitir `CREATE USER ... @'<host>'` final seguro.
- Schema/database não foi especificado/atestado.
- Identidade administrativa DBA autorizada e responsável pela revogação não foram nomeados.
- CA/fingerprint do serviço ativo e negociação TLS não foram confirmados.
- A versão ativa não foi atestada; P15 só registrou imagem configurada `mysql:9`, enquanto o teste local usou 8.4.11.
- Imagem ainda é local; registry e digest remoto verificável não existem.
- Triggers exigem evidência separada; o runner não recebe `TRIGGER`.

**REMOTE_CHANGES=NONE.**
