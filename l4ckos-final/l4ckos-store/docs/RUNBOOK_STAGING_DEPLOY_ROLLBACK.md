# Runbook — staging, dados, deploy e rollback

## A. Cópia segura e anonimização

1. Criar uma instância MySQL exclusiva de staging, sem peering/credencial compartilhada com produção.
2. Gerar backup consistente de produção com conta read-only e `--single-transaction --quick`; criptografar em repouso e limitar acesso.
3. Restaurar diretamente na rede isolada. Não disponibilizar o dump bruto a desenvolvedores.
4. Antes de liberar acesso, conferir `SELECT DATABASE()` e exigir nome/host esperados.
5. Anonimizar dentro de uma transação quando as tabelas permitirem; tokens devem ser removidos, não mascarados.
6. Preservar PK/FK, `productId`, `variantId`, `orderId`, quantidades, preços, status e timestamps necessários à integridade.
7. Executar inventário adicional no `information_schema.COLUMNS` procurando `name|email|cpf|phone|address|street|zip|token|secret|payment|payload`.

Transformações mínimas:

| Tabela/campo | Tratamento |
|---|---|
| users | nome/e-mail sintéticos determinísticos; CPF/telefone nulos; `openId` hash; `asaasCustomerId` nulo |
| userProfiles | telefone nulo |
| userAddresses | destinatário/logradouro/número/complemento/bairro/CEP/cidade anonimizados |
| orders | snapshot de endereço anonimizado; tracking code removido se sensível |
| userPaymentMethods | titular sintético; `last4` e expiry substituídos; nunca copiar token/cartão completo |
| localAuthUsers | e-mail sintético; hash de senha inutilizado |
| passwordResetTokens | excluir todas as linhas |
| payments | IDs do provedor/externalReference com hash consistente; URLs, QR, linha digitável removidos |
| paymentEvents | providerPaymentId com o mesmo hash; payload substituído por JSON redigido |
| notificationOutbox | payload redigido; preservar status/attempts/lease para preflight |
| auditLogs | metadata/before/after redigidos se contiverem PII |
| waitlist/unsubscribe | e-mails sintéticos determinísticos |

Após anonimizar:

- executar busca amostral por domínios reais, CPFs e telefones;
- provar unicidade e FKs;
- criar usuários/clientes sintéticos próprios para E2E de Asaas/Resend;
- destruir o dump bruto conforme a política aprovada.

## B. Checklist de variáveis

| Nome | Obrigatória? | Origem | Sensível? | Validação |
|---|---|---|---|---|
| NODE_ENV | Sim | plataforma | Não | `production` no backend implantado |
| DEPLOY_ENV | Sim | plataforma | Não | `staging` ou `production`, explícito |
| DATABASE_URL | Sim | MySQL | Sim | host/nome exatos + `/ready` |
| EXPECTED_DATABASE_HOST/NAME | Staging | inventário | Não | correspondência fail-closed |
| PRODUCTION_DATABASE_HOST | Staging | inventário | Não | staging deve divergir |
| JWT_SECRET | Sim | secret manager | Sim | aleatório, >=32 chars, teste de sessão |
| FRONTEND_URL / APP_URL | Sim | domínio | Não | links e redirects corretos |
| CORS_ORIGINS | Sim | domínio | Não | allowlist exata, teste allowed/blocked |
| ASAAS_API_URL | Sim | Asaas | Não | sandbox em staging, produção só no go-live |
| ASAAS_API_KEY | Sim | Asaas | Sim | prefixo/conta do ambiente, chamada read-only |
| ASAAS_WEBHOOK_TOKEN | Sim | Asaas/secret manager | Sim | webhook 401 errado e 2xx correto |
| ASAAS_CHECKOUT_BASE_URL | Se usado | Asaas | Não | ambiente correto |
| RESEND_API_KEY | Sim para e-mail | Resend | Sim | envio a destinatário controlado |
| STAGING_EMAIL_ALLOWLIST | Staging | QA | Sensível operacional | destinatário real bloqueado |
| EMAIL_FROM_* / EMAIL_REPLY_TO | Sim por template | domínio Resend | Não | domínio/SPF/DKIM e conteúdo |
| EMAIL_UNSUBSCRIBE_SECRET | Marketing | secret manager | Sim | links assinados e inválidos recusados |
| CRON_SECRET | Sim | secret manager | Sim | >=32 chars; 401/200 |
| OPERATIONAL_JOBS_ENABLED | Sim | plataforma | Não | valor explícito por instância |
| AUTOMATIC_BACKUPS_ENABLED | Sim | plataforma | Não | `false` até storage/restore estarem provados |
| *_JOB_INTERVAL_MS | Recomendado | operação | Não | frequência e sobreposição documentadas |
| MELHOR_ENVIO_API_URL | Se frete externo | Melhor Envio | Não | sandbox em staging |
| MELHOR_ENVIO_TOKEN | Se frete externo | Melhor Envio | Sim | token exclusivo do ambiente |
| MELHOR_ENVIO_FROM_POSTAL_CODE | Sim para frete | operação | Dado operacional | cotação controlada |
| LOCAL_DELIVERY_CEP_PREFIXES | Se entrega local | operação | Não | casos dentro/fora da área |
| GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI + GOOGLE_OAUTH_ENV | Se OAuth | Google | secret no client secret | cliente exclusivo, marcador e redirect exato por ambiente |
| ADMIN_EMAILS / LOCAL_AUTH_ALLOWED_EMAILS | Sim | operação | Dado pessoal | menor privilégio |
| ALLOW_LOCAL_AUTH_IN_PRODUCTION | Sim | segurança | Não | preferencialmente `false` |
| ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION | Sim | segurança | Não | `false` salvo decisão explícita |
| BUILT_IN_FORGE_API_URL/KEY | Se storage proxy | provedor | key sensível | upload/download staging |
| BACKUP_DIR | Sim se backup local | plataforma | Não | persistente, espaço/retention/restore |
| PORT / HOST | Sim | plataforma | Não | bind e healthcheck |
| VITE_API_URL | Sim frontend | deploy | Não | aponta somente ao backend do ambiente |
| VITE_APP_ID / VITE_GOOGLE_CLIENT_ID | Conforme uso | deploy | Não | bundle inspecionado |

Nunca copiar secrets entre staging e produção. Rotacionar qualquer segredo exposto fora do secret manager.

## C. Deploy seguro

| Ordem | Ação | GO | NO-GO |
|---:|---|---|---|
| 1 | Congelar release por commit/tag e registrar checksums | Artefato reproduzível | Worktree sujo ou SHA divergente |
| 2 | Confirmar staging verde e checklist externa completa | Todos os blockers fechados | Qualquer etapa não executada |
| 3 | Gerar backup consistente | Dump concluído | Erro/warning/espaço insuficiente |
| 4 | Restaurar backup em base temporária | Contagem/checksum/preflight OK | Restore nunca testado ou divergente |
| 5 | Ativar manutenção e pausar checkout/jobs/escritas | Escritas zeradas | Jobs/processos ainda escrevendo |
| 6 | Rodar preflight P0/P1 read-only | Zero blocker | Qualquer blocker |
| 7 | Aplicar migrations statement a statement | Estado registrado após cada DDL | Falha/lock fora da janela |
| 8 | Validar `information_schema` e preflight pós | Schema exato | Coluna/index/constraint ausente |
| 9 | Implantar backend compatível com jobs desabilitados | `/health` e `/ready` OK | DB down/500/config errada |
| 10 | Smoke test API/webhook seguro | Auth/idempotência OK | Mutação inesperada |
| 11 | Implantar frontend | Bundle/rotas/API corretos | API/asset/status quebrado |
| 12 | Configurar/verificar webhook | Entrega e reenvio idempotentes | 401/500/evento perdido |
| 13 | Habilitar jobs numa única estratégia | Execução/alertas OK | Duplicidade/sem secret |
| 14 | Smoke pedido controlado | Cadeia completa rastreável | Qualquer elo ausente |
| 15 | Liberar checkout gradualmente | Métricas/alertas acompanhados | Erro, estoque ou gateway degradado |

## D. Rollback e contingência

| Falha | Resposta | Restore de banco? |
|---|---|---|
| Frontend com bug | Reverter deployment frontend | Não |
| Backend com bug, schema compatível | Reverter backend e pausar jobs | Não |
| Migration parcial | Pausar escrita; inspecionar schema; retomar do primeiro statement ausente | Normalmente não; só com dano de dados comprovado |
| Webhook quebrado | Pausar fulfillment automático; corrigir endpoint; solicitar reenvio/reconciliar | Não |
| Asaas indisponível | Bloquear novas tentativas ou manter estado `unknown`; reconciliar por externalReference | Não |
| Resend indisponível | Preservar outbox e retry; não repetir efeito financeiro | Não |
| Job duplicando | Desabilitar scheduler/instância; preservar leases; auditar dedupe | Não, salvo corrupção comprovada |
| Estoque inconsistente | Fechar checkout; snapshot/backup; reconciliar reservas/pedidos; decisão auditada | Apenas se a correção dirigida for menos segura que restore |
| Escrita destrutiva/corrupção ampla | Isolar banco, preservar evidência, calcular perda desde backup | Possivelmente sim, com plano de replay dos eventos novos |

Não executar “down migration” destrutiva por padrão. Depois que o novo código recebeu pedidos, um restore antigo pode perder vendas, payments e webhooks. A decisão deve comparar correção forward, replay e restore, com reconciliação Asaas obrigatória.

## E. Recuperação específica da migration 0015

A `0015_schema_drift_alignment.sql` contém três DDLs e o MySQL confirma cada uma por autocommit. Em caso de interrupção, não reinicie o arquivo inteiro sem inspecionar o estado físico.

1. Pausar backend, jobs e qualquer escrita.
2. Executar `scripts/preflight-schema-drift.sql`. Qualquer `BLOCKER`, especialmente `waitlist_created_at_nulls`, impede a continuação.
3. Detectar o último statement confirmado:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'productImages' AND COLUMN_NAME = 'color') OR
    (TABLE_NAME = 'promoBanners' AND COLUMN_NAME IN ('imageUrl','mobileImageUrl','imageAlt','linkUrl')) OR
    (TABLE_NAME = 'waitlist_emails' AND COLUMN_NAME = 'created_at')
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

4. Retomar pelo primeiro statement ausente, preservando a ordem:
   - statement 1: adiciona `productImages.color`;
   - statement 2: adiciona, em um único `ALTER TABLE`, as quatro colunas de `promoBanners`;
   - statement 3: torna `waitlist_emails.created_at` `NOT NULL DEFAULT CURRENT_TIMESTAMP`.
5. Executar `scripts/check-schema-drift.mjs` e só religar o backend se o processo terminar com código 0 e `/ready` responder HTTP 200.

Reexecução segura:

- Os statements 1 e 2 não são idempotentes: após sucesso, reexecutá-los causa `Duplicate column`. Inspecione todas as colunas e pule o statement já confirmado.
- O statement 2 é uma única unidade DDL. Se as quatro colunas existirem com o contrato correto, ele foi confirmado. Se houver estado inesperadamente parcial, não execute o statement original; aplique apenas os `ADD COLUMN` ausentes após revisão.
- O statement 3 é repetível quando o preflight registra zero `created_at IS NULL`, mas deve ser pulado se tipo, nulabilidade e default já estiverem corretos.
- Nunca invente cor, mídia, link ou timestamp para fazer a migration passar. Registros históricos de imagem/banner permanecem `NULL`; timestamps legados nulos exigem classificação manual.

Ensaio local de 2026-08-28: falha controlada após o statement 1 deixou cinco blockers; a retomada pelos statements 2 e 3 terminou com zero blocker, zero warning do MySQL e readiness saudável.

## F. Subida do staging isolado

Este procedimento não autoriza acesso nem alteração em produção. Use um projeto/serviço, banco, usuário, chaves e namespaces criados exclusivamente para staging.

### 1. Provisionar banco

1. Criar uma instância MySQL exclusiva e um database vazio cujo nome contenha `staging`.
2. Criar usuário próprio com acesso somente a esse database.
3. Registrar host e nome em `EXPECTED_DATABASE_HOST` e `EXPECTED_DATABASE_NAME`.
4. Registrar os identificadores não secretos de produção em `PRODUCTION_DATABASE_HOST` e `PRODUCTION_DATABASE_NAME`; a aplicação os usa apenas para impedir cruzamento.
5. Executar, com secrets fornecidos pelo secret manager:

```bash
APP_ENV=staging SEED_STAGING=true pnpm staging:provision-db
```

O comando só aceita banco vazio, aplica `0000` a `0015` statement a statement, recusa warnings, executa o drift checker e termina em `GO` ou `NO-GO`.

### 2. Configurar variáveis

1. Copiar apenas os nomes e comentários de `staging.env.example` para o gerenciador de secrets do serviço.
2. Gerar novos `JWT_SECRET`, `CRON_SECRET` e `ASAAS_WEBHOOK_TOKEN`.
3. Usar conta/chave Asaas sandbox, credenciais Resend controladas, cliente OAuth próprio e storage/namespace próprios.
4. Manter `CHECKOUT_ENABLED=false`, `AUTOMATIC_BACKUPS_ENABLED=false` e o e-mail em `EMAIL_MODE=restricted` no primeiro deploy.
5. Validar que nenhum valor foi copiado do projeto de produção.

### 3. Aplicar migration em banco já existente

Ativar manutenção, fechar checkout e jobs, informar explicitamente o arquivo revisado e a URL de readiness:

```bash
APP_ENV=staging \
MAINTENANCE_MODE=true \
CHECKOUT_ENABLED=false \
OPERATIONAL_JOBS_ENABLED=false \
STAGING_MIGRATION_FILE=drizzle/0015_schema_drift_alignment.sql \
STAGING_READINESS_URL=https://api-staging.l4ckos.com.br/ready \
pnpm staging:migrate
```

O gate executa preflight, `mysqldump`, migration statement a statement, drift e readiness. Um erro ou warning encerra em `NO-GO`; não religue escritas automaticamente.

### 4. Deploy do backend

1. Fixar commit/tag e construir a imagem uma única vez com `RELEASE_VERSION`, `GIT_COMMIT_SHA` e `DEPLOYED_AT`.
2. Implantar a imagem no serviço de backend de staging sem reconstruí-la no servidor.
3. Confirmar que o startup fail-closed aceita a configuração; qualquer `Environment isolation check failed` é `NO-GO`.
4. Manter uma única réplica durante a primeira homologação; ampliar somente após validar leases/idempotência.

### 5. Validar readiness e identidade

```bash
curl -fsS https://api-staging.l4ckos.com.br/health
curl -fsS https://api-staging.l4ckos.com.br/version
curl -fsS https://api-staging.l4ckos.com.br/ready
```

Exigir HTTP 200, `environment=staging`, SHA/versão esperados e componentes `database`, `schema` e `environment` saudáveis. Dependências externas são diagnóstico de configuração/degradação, não autorização para ignorar falhas do banco/schema.

### 6. Deploy do frontend

Construir a partir do mesmo SHA do backend, definindo `VITE_APP_ENV=staging`, `VITE_API_URL=https://api-staging.l4ckos.com.br`, `VITE_RELEASE_VERSION` e `VITE_GIT_COMMIT_SHA`. Inspecionar o bundle e recusar qualquer referência à API de produção.

### 7. Configurar DNS

Criar `staging.l4ckos.com.br` para o frontend de staging e `api-staging.l4ckos.com.br` para o backend de staging. Validar TLS, proxy Cloudflare e origem antes de divulgar o ambiente. Não alterar os registros principais.

### 8. Configurar webhook sandbox

No painel da conta Asaas sandbox, registrar `https://api-staging.l4ckos.com.br/api/webhooks/asaas` com o token exclusivo de staging. Provar 401 sem token/errado e entrega idempotente com token correto usando somente eventos sandbox.

### 9. Configurar cron

Modelo escolhido: scheduler externo. Configurar três chamadas autenticadas para reservations, notifications e reconciliation. Usar `JOB_SCHEDULER_MODE=external`, `JOB_ENDPOINTS_ENABLED=true` e `OPERATIONAL_JOBS_ENABLED=true`; timers internos permanecem desligados. Provar 401 sem/errado token e 200 com o token exclusivo.

### 10. Executar smoke

```bash
APP_ENV=staging \
STAGING_BACKEND_URL=https://api-staging.l4ckos.com.br \
pnpm staging:smoke
```

O smoke recusa alvo de produção. Sem autorização explícita `SMOKE_ASAAS_CHARGE_ENABLED=true`, ele não cria cobrança. Depois, executar manualmente browser cliente/admin, upload controlado, e-mail allowlisted, webhook sandbox e rastreamento por IDs.

### 11. Habilitar checkout staging

Somente após todos os gates: definir `CHECKOUT_ENABLED=true`, manter `APP_ENV=staging` e fazer um novo deploy/config rollout auditável. Criar uma cobrança sandbox controlada, confirmar webhook, estoque, outbox e telas cliente/admin. Qualquer ligação com recurso de produção é `NO-GO` imediato.
