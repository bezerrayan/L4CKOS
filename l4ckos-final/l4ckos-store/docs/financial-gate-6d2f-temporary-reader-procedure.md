# Gate 6D-2F — procedimento proposto para leitor temporário

**Status: proposta local para revisão. Não executar.** Nenhuma conta, grant ou consulta remota foi criada/realizada por este documento. O procedimento só vale para o projeto/ambiente/serviço MySQL isolado explicitamente autorizado no pedido operacional. O nome interno do schema deve ser confirmado antes da sessão.

## 1. Identidade e privilégio

Não há evidência local de uma conta read-only dedicada e disponível no alvo isolado. `l4ckos_app` é uma conta da aplicação no material legado e não deve ser reutilizada. O nome `l4ckos_financial_read` em documentação anterior é apenas uma proposta, não uma identidade comprovada. A conta metadata-only proposta no runner P16 também é outro propósito/alvo e não concede a leitura necessária às contagens.

Antes da provisão, o DBA deve registrar em canal de custódia:

- responsável autorizador e executor da provisão/revogação;
- host/origem exata que o MySQL verá; não aceitar `%` ou fallback;
- schema exato; somente `railway` se confirmado para o alvo;
- política TLS do serviço, CA/hostname aprovados e exigência de TLS;
- nome/host novos, comprovadamente ausentes no baseline;
- validade curta e identificador opaco da execução.

Perfil de dados proposto: `SELECT` somente nas colunas abaixo, sem roles, grants globais, `GRANT OPTION`, `PROCESS`, `EVENT`, `FILE`, `TRIGGER`, DML, DDL ou administração:

| Tabela               | Coluna permitida |
| -------------------- | ---------------- |
| `payments`           | `id`             |
| `paymentEvents`      | `id`             |
| `asaasWebhookEvents` | `id`             |
| `asaasWebhookInbox`  | `eventId`        |
| `auditLogs`          | `id`             |
| `notificationOutbox` | `id`             |
| `orderEmailEvents`   | `id`             |
| `userPaymentMethods` | `id`             |

**Limite de segurança:** esses grants limitam colunas, mas MySQL não restringe a operação a `COUNT`. Um principal com `SELECT(id)` também poderia selecionar valores individuais da coluna. A garantia de consulta agregada depende então de executor imutável/revisado, segredo nunca entregue ao operador da query, allowlist fechada e ausência de interface SQL arbitrária. Se essa garantia operacional não for aceita, parar; uma view/procedure agregada com `EXECUTE` exigiria desenho, DDL e autorização adicionais.

O perfil acima não dá acesso a `preorderCapacityReservations` nem a payloads de webhook, nomes, endereços, documentos ou conteúdo de pagamentos.

## 2. Provisão controlada — somente após autorização específica de alteração MySQL

1. Fixar SHA e hash do executor fechado; confirmar a tupla Railway completa, alvo/schema, versão, TLS e origem do runner por evidência independente.
2. DBA confirma que o principal novo não existe; se existir, aborta sem alterar a conta.
3. Criar uma conta única por execução, inicialmente bloqueada, `REQUIRE SSL`, `MAX_USER_CONNECTIONS 1`, com senha aleatória de uso único entregue diretamente ao secret manager/entrada privada do runner. Nunca pôr segredo em SQL versionado, argv, logs, manifesto, Railway API, chat ou saída.
4. Conceder exclusivamente os oito `SELECT` de coluna da tabela. O DBA compara `SHOW GRANTS` ao perfil antes de desbloquear. Ausência de tabela/coluna, role ativa ou grant adicional aborta; não adaptar o escopo durante a execução.
5. Desbloquear por janela curta e entregar a credencial apenas ao executor aprovado.

O DBA deve completar e revisar este modelo para a versão, schema e origem confirmados. Os placeholders não são valores operacionais; nunca preencher nem registrar credenciais neste documento.

### Modelo de SQL para revisão do DBA

Abaixo está apenas um modelo, com placeholders não executáveis. O DBA deve confirmar sintaxe/host/TLS para a versão do MySQL do alvo, substituir placeholders fora do chat e submeter o diff de privilégios a revisão independente. Não usar `%` como host.

```sql
CREATE USER '<principal_unico>'@'<host_exato>'
  IDENTIFIED BY '<segredo_entregue_fora_do_SQL>'
  REQUIRE SSL
  WITH MAX_USER_CONNECTIONS 1
  ACCOUNT LOCK;

GRANT SELECT (`id`) ON `railway`.`payments`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`paymentEvents`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`asaasWebhookEvents`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`eventId`) ON `railway`.`asaasWebhookInbox`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`auditLogs`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`notificationOutbox`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`orderEmailEvents`
  TO '<principal_unico>'@'<host_exato>';
GRANT SELECT (`id`) ON `railway`.`userPaymentMethods`
  TO '<principal_unico>'@'<host_exato>';

-- Só após comparar SHOW GRANTS e validar a ausência de roles/grants extras:
ALTER USER '<principal_unico>'@'<host_exato>' ACCOUNT UNLOCK;

-- Cleanup somente da conta nova desta execução:
ALTER USER '<principal_unico>'@'<host_exato>' ACCOUNT LOCK;
-- Confirmar, por observação independente, que a conexão desta conta encerrou.
DROP USER '<principal_unico>'@'<host_exato>';
```

Antes da concessão, o DBA verifica a existência e nulabilidade das oito colunas usando seu fluxo administrativo separado. O runner não recebe privilégio de metadata amplo. Se a coluna não existir, ou se `id`/`eventId` for nullable e isso alterar a semântica esperada de `COUNT(coluna)`, parar e pedir revisão do escopo; não substituir por `COUNT(*)` nem ampliar grants.

## 3. Sessão de auditoria e queries fixas

O runner deverá usar TLS com validação de CA e hostname, múltiplas instruções desativadas, transação de leitura consistente (`READ ONLY`), timeout, sem retry, sem SQL de entrada do usuário. Antes das queries, comparar `DATABASE()`, `CURRENT_USER()`, `USER()`, `CURRENT_ROLE()`, versão e TLS/cipher ao manifesto aprovado; validar `SHOW GRANTS FOR CURRENT_USER()` contra o perfil. A saída de identidade/grants deve ser sanitizada antes de qualquer registro.

As únicas queries de negócio permitidas são:

```sql
SELECT COUNT(id) FROM payments;
SELECT COUNT(id) FROM paymentEvents;
SELECT COUNT(id) FROM asaasWebhookEvents;
SELECT COUNT(eventId) FROM asaasWebhookInbox;
SELECT COUNT(id) FROM auditLogs;
SELECT COUNT(id) FROM notificationOutbox;
SELECT COUNT(id) FROM orderEmailEvents;
SELECT COUNT(id) FROM userPaymentMethods;
```

O executor deve bindar/fixar o schema aprovado sem concatenar entrada do usuário e produzir apenas nome da tabela, valor agregado e estado de execução. Não ler linhas, não consultar outras tabelas e não chamar provedor. Resultado diferente do baseline aprovado (zero em todas) interrompe a auditoria para análise, sem tentativa de corrigir ou apagar dados.

## 4. Parada e cleanup verificável

Parar sem query de negócio se houver divergência de projeto/ambiente/serviço/schema/principal/origem/TLS, grant inesperado, role ativa, query não allowlisted, timeout, conexão perdida, divergência de estado ou saída não sanitizável. Não fazer fallback para credenciais da API, conta administrativa, outro host ou outro ambiente.

Após sucesso ou falha:

1. Encerrar a conexão própria e registrar apenas seu identificador opaco.
2. DBA bloqueia a conta imediatamente e usa observação independente para confirmar que a conexão própria não permanece ativa. Não matar conexões de terceiros; se a verificação falhar, manter bloqueada e escalar.
3. Revogar/remover somente a conta criada por esta execução; confirmar ausência da conta/grants por leitura administrativa sanitizada. Contas preexistentes nunca são removidas.
4. Apagar a credencial temporária do secret manager/runner e destruir qualquer contexto local temporário; manter apenas recibo sanitizado com hashes, alvo, principal redigido, horário, contagens e resultado do cleanup.
5. Qualquer falha de cleanup significa `CLEANUP=FAIL`, Gate bloqueado e nenhuma nova tentativa automática.

## 5. Critérios de decisão

- **PASS identidade:** alvo/schema/TLS/origem e principal correspondem ao plano independente; grants exatos; sem roles ou privilégios extras.
- **PASS auditoria:** somente oito aggregates executados; todos iguais ao baseline aprovado; nenhuma leitura individual; conexão encerrada.
- **PASS cleanup:** principal temporário removido e ausência confirmada; segredo apagado; recibo sanitizado preservado.
- Qualquer resultado ausente, parcial, incerto ou divergente é **FAIL/BLOCKED**, não PASS. Gate 6D-2F permanece PARTIAL até evidência final revisada.

## Autorizações separadas ainda necessárias

1. Consulta read-only de identidade/grants/schema pelo principal elegível, uma vez identificado.
2. Se não existir principal elegível: autorização do DBA para a alteração MySQL temporária exatamente descrita acima.
3. Depois de PASS nos gates anteriores: autorização separada para executar as oito queries.
4. Provisão/remediação estrutural ou mudança de configuração não é autorizada por nenhuma das etapas anteriores.
