# L4CKOS — Plano de execução da publicação staging

## Correção RC2 do ledger/inbox — 10/10/2026 UTC (09/10 Brasília)

Implementação e ensaios exclusivamente locais. **Regressão final concluída: 531 PASS / 0 FAIL / 0 ignorados; GO para consolidação local, conforme fechamento abaixo.** As revisões NO-GO abaixo ficam preservadas como histórico, não como aceite da versão corrigida.

Causa raiz: chave duplicada era confundida com evento concluído, inclusive failed/processing. O hash não era um conteúdo recuperável. A correção distingue conclusão real, processamento transacional e pendência recuperável.

Arquitetura RC2: migration incremental 0023 cria `asaasWebhookInbox` (InnoDB, eventId com comparação binária e PK, envelope mínimo, hash, received/processing/processed/failed/rejected, tentativas, erro controlado, próxima tentativa e conclusão). Nenhuma migration antiga foi modificada. Envelope exclui cliente, cartão, contato, headers e tokens; sourcePayloadHash preserva comparação com ledger legado sem armazenar esses dados. A identidade da inbox usa hash canônico do envelope financeiro, independentemente da ordem das propriedades e dos campos pessoais omitidos.

Autenticação precede persistência nos dois aliases. ID real do evento é obrigatório; não se usa paymentId como substituto, pois pagamentos podem gerar eventos distintos. Falha de autenticação → 401; envelope inválido → 400; conflito de identidade/conteúdo → 409; persistência indisponível → 503. Recebimento grava received antes do processamento. A conclusão financeira, reservas/estoque/auditoria, ledger processed e inbox processed compartilham uma transação MySQL, incluindo transações aninhadas por savepoints. Falha/crash faz rollback das regras; o envelope permanece recuperável. Concorrência usa row lock NOWAIT: entrega em andamento recebe 503, jamais duplicate concluído. HTTP 200 somente após commit de processamento ou para evento já processed. Rejeição definitiva fica rejected, sem retries automáticos e sem ACK 200; validações iniciais continuam 409/422. Falhas recuperáveis ficam failed, sem ACK, com retry após 60s. Estado processing ocorre dentro da transação; não há lease persistida/órfã que autorize ACK falso.

Worker iniciado junto ao backend, a cada 30s, até 25 eventos por rodada, com exclusão local de tick sobreposto e row locks entre processos. Retoma received/failed/processing a partir do envelope salvo, sem depender de reenvio do Asaas. Manutenção bloqueia HTTP nos dois aliases e suspende worker; retomada recupera os envelopes anteriores. Counts de pendências/rejeições/legados sem payload são emitidos sem conteúdo. A recuperação não cria cobranças ou reembolsos; eventual resolução por provider é consulta de pagamento existente, não efeito financeiro. Todos os providers foram mockados nos ensaios.

Envelope terminal é apagado após 30 dias; eventId/hash/estado são preservados como tombstone idempotente. Pendências não são apagadas. Acesso ao conteúdo fica restrito ao DB e caminhos internos de processamento, sem rota pública de leitura; grants/backup e proteção de armazenamento reais permanecem gates de staging. Logs novos não incluem payload, token ou erro bruto. Notificações existentes foram movidas para depois do commit financeiro: falha de notificação não desfaz pagamento nem dispara replay financeiro. Não foi criada nova outbox de e-mail; queda entre commit e envio pode exigir reconciliação da notificação, sem justificar reenvio financeiro.

**Limite histórico explícito:** registros antigos failed/processing sem inbox continuam sem conteúdo reconstruível. Worker os conta como legacy_requires_authenticated_redelivery; nunca os confirma automaticamente. Reenvio autenticado com payload original migra o evento para inbox e permite recuperar; os dois estados foram testados no MySQL. Payload legado desconhecido não é inventado nem backfilled. Antes da janela real, listar essas pendências e reconciliar com eventos arquivados no Sandbox/reenvio autorizado é gate remoto obrigatório.

0023 usa manifest-v4 e contract-v4 incrementais; a CLI local de schema usa a sequência 0021/0022/0023 para bootstrap novo ou apenas entradas pendentes para banco existente. manifest-v3 e contrato v3 continuam fontes fixas do executor 0022. Backup/restore reconhece inbox e formato de inventário 3, preservando leitura dos formatos 1/2. Ensaio de restore de inbox pendente comprovou recuperação independente no clone restaurado.

Executor 0022: lock de janela adquirido antes da quarentena arbitra duas ativações completas. Recovery separada revalida identidade/capability e inventário salvo, adota a barreira sem desbloquear, identifica um dos quatro fingerprints parciais exatos e exige digest da proposta de continuação. Executa somente DDL restante; dados antigos/FKs e ledger são verificados. Conclusão real e ledger são transacionais, com execução de recuperação auditada e preservação do errorCode anterior. Nenhum histórico é apagado. TTL de plano/backup e guard de recovery continuam obrigatórios; recuperação além do TTL exige plano específico revisado, não extensão silenciosa.

**Sequência futura corrigida (não executada):** manutenção/quarentena + backup/restore contemporâneo → 0022 governada → snapshot/backup v3 e revisão/autorização específica do executor restrito à 0023 → 0023 + validação v4/ledger/dados → backend RC2 → frontend → health/smoke/recovery/fila → retirada explicitamente aprovada. O payload 0022 atual não executa 0023. Não publicar backend RC2 apenas sobre 0022, nem admitir escritores entre as duas migrations. O executor remoto específico 0023 e seus guards/backup v3 ainda devem ser preparados/revisados na fase operacional autorizada; a CLI local não é um bypass para migration remota.

Testes dirigidos já comprovados: 30 casos 0022 incluindo quedas reais de socket em DDL 0/1, continuação forward-only e dois executores completos; suíte financeira/inbox com processo filho encerrado após mutação, concorrência, failed/processing, aliases/auth, cancelamento, fora de ordem, manutenção/retomada, retenção e restore. Rodadas iniciais com erros de fixture/ordenação/COUNT foram corrigidas e não são contadas como aprovação final. Fonte de produção, pedido #12, MySQL staging e chamadas financeiras reais não foram acessados.


### Fechamento final — 2026-10-10T00:34:01+00:00

**GO PARA CONSOLIDAÇÃO DA RC2 (commit local futuro). NO-GO para publicar ou iniciar migration remota nesta etapa.** Bloqueador financeiro corrigido e recuperação obrigatória demonstrada localmente. Nenhum commit foi criado no worktree original; branch `feat/preorder-batch`, HEAD `ce9e84946d2773cdadee61254fc3ba5592f05001`, índice vazio, alterações preservadas.

| Gate final | Resultado |
| --- | --- |
| Vitest completo | **47 arquivos / 531 PASS / 0 FAIL / 0 ignorados** |
| Inbox/ledger 0023 MySQL + envelope | **27 PASS**, incluindo startup real do worker, encerramento de processo filho após mutação, rollback financeiro, redelivery de failed/processing legado, recuperação sem redelivery, duas entregas concorrentes, cancelamento, fora de ordem, aliases/auth, manutenção/retomada, retenção e restore independente |
| Executor 0022 MySQL | **30 PASS**, incluindo quedas reais de socket durante DDL, recuperação forward-only aprovada, duas ativações completas concorrentes, preservação/retirada autorizada da barreira |
| Navegador React, APIs mockadas | **17 PASS** |
| Dois probes anteriormente bloqueados | **Ambos PASS integralmente**, em stagingTransport/staging0021Transport, 9 PASS em cada arquivo |
| Empacotamento 0022 offline | **7 PASS** |
| TypeScript cliente + servidor | `pnpm check` PASS |
| Build frontend + backend | `VITE_DEPLOY_TARGET=staging VITE_API_URL=https://api-staging.l4ckos.com.br VITE_SITE_MODE=store pnpm build` PASS |
| Diff/documentação/exportador | `git diff --check` PASS; links/arquivos e inventário conferidos; AST Python PASS |
| Migration 0022 | Byte a byte com ce9e849, SHA-256 `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`, sem delta |
| Migration 0023 | Somente local, checksum `b0b588463e5318fdc63761fd6a8261827478fe058f2152a8a630fa5fa87bae8a`, fingerprint v4 `0ba16c9b19b698d4933d0abad9a5e4679052fd2aaf78800da42d480e396ef5d2`, replay UP_TO_DATE |

Relatório completo: `/tmp/l4ckos-rc2-final-vitest.json`; log `/tmp/l4ckos-rc2-final-vitest.log`. Rodadas anteriores não são somadas aos 531 casos únicos. A primeira regressão limpa teve 528 PASS; a rodada final inclui três novos casos de revisão e é a evidência prevalente.

Snapshot independente: `/tmp/l4ckos-rc2-snapshot-m9t5i629`, fonte relativa `l4ckos-final/l4ckos-store`, commit de teste **c15bccd87e2ca91316ed666deda622e08ac09080**. Esse SHA pertence exclusivamente ao repositório temporário, não é SHA da RC2 nem commit na branch original. Objetos vieram de fetch de caminho local, sem acesso Git remoto; os 38 caminhos alterados/não rastreados foram copiados explicitamente e 652 arquivos foram comparados byte a byte, com hashes em `/tmp/l4ckos-rc2-snapshot.json`. `.npmrc`, .env privados, dist, node_modules e dumps não foram commitados; node_modules disponível foi ligado somente depois do commit e ignorado. Fonte Git ficou limpa para os probes, sem relaxar guards. A revisão documental deste fechamento é posterior à execução; nenhum arquivo de runtime/SQL foi alterado depois dela.

Comando da regressão final, no cwd do snapshot:

```bash
env -u VITE_DEPLOY_TARGET DATABASE_URL= RESEND_API_KEY= ASAAS_API_KEY= \
VITE_API_URL=same-origin VITE_SITE_MODE=store \
PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
L4CKOS_MYSQL_TEST=1 L4CKOS_LOCAL_SCHEMA=1 \
L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-0022-socket/mysqld.sock \
pnpm exec vitest run --maxWorkers=1 --minWorkers=1 \
--reporter=json --outputFile=/tmp/l4ckos-rc2-final-vitest.json
```

Verificação exclusivamente local: Node 22.23.2, pnpm 10.4.1, Docker Unix local, MySQL 8.4, rede none, sem portas, fixtures sintéticas. Nenhuma instalação/atualização de dependências. Provedores de cobrança/reembolso/e-mail simulados; não houve chamadas financeiras externas. Contêiner local encerrado depois da execução. Nenhuma interface visual alterada.

Revisão de segurança: entrada com autenticação existente e envelope allowlist; quantias textuais inválidas recusadas; segredo/PII não persistidos no envelope; nenhum payload em logs/HTTP; ausência de fallback em memória; transação e bloqueio de linha para efeitos financeiros; identidade do evento comparada exatamente mesmo diante do índice case-insensitive legado. Colisão de IDs diferentes apenas por maiúsculas/minúsculas é rejeição 409 auditável, jamais ACK de um evento diferente. Rejeições e pendências têm contagens visíveis para revisão. Busca dos padrões de chave privada, API key e URL credenciada não encontrou candidatos nos 38 arquivos; não é certificação universal de ausência de segredos.

**Riscos/gates restantes, sem impedir este aceite local:** inventário/reconciliação remota de failed/processing históricos sem envelope e eventos eventualmente já confirmados pelo código antigo; obtenção do payload original/reenvio autenticado autorizado (hash não o reconstrói); revisão dos rejected, inclusive conflitos de identidade; grants/armazenamento/backup e parâmetros reais de durabilidade do MySQL; identidade efetiva e acesso independente de recuperação; backup contemporâneo restaurado antes de cada schema; pacote governado específico 0023 e de recuperação; duração/locks da DDL real; configuração, retenção e observação do worker/fila Asaas; gatilhos/SHA/deploy/startup/health/smoke. Nova falha durante uma continuação 0022 gera nova pendência de recovery e exige proposta específica, não retry cego. Não reabrir escritas usando backend antigo: ele não drena a inbox e mantém o comportamento de ACK anterior. Rollback de código deve manter manutenção/quarentena até disponibilizar processador compatível. Notificações após commit financeiro podem exigir reconciliação própria se o processo cair antes do envio; não autorizam repetir pagamento, estoque ou cobrança.

### Inventário definitivo local

**38 arquivos únicos:** os 19 anteriores preservados, mais 19 caminhos adicionais necessários. Relatório de backup preexistente incluído apenas no inventário, sem alteração de conteúdo. Nenhum backup, secret, `.npmrc`, payload executável ou temporário integra a lista.

```text
database/bootstrap/bootstrap.ts
database/migrations/0023_asaas_webhook_inbox.sql
database/migrations/manifest-v4.json
database/migrations/runner.ts
database/schema/artifacts.ts
database/schema/contract-v4.json
database/staging0022/barrier.ts
database/staging0022/capability.ts
database/staging0022/evidence.ts
database/staging0022/identity.ts
database/staging0022/package.ts
database/staging0022/policy.ts
database/staging0022/publication.ts
database/staging0022/recovery.ts
database/staging0022/restore.ts
database/staging0022/runner.ts
database/staging0022/window.ts
docs/preorder/staging-backup-validation.md
docs/preorder/staging-deployment-execution-plan.md
drizzle/schema.ts
scripts/database-schema.ts
scripts/staging0022-backup.py
scripts/staging0022.ts
server/_core/index.ts
server/controllers/paymentController.ts
server/database/backupRestore.mysql.test.ts
server/database/backupRestore.ts
server/database/preorder.mysql.test.ts
server/database/reconciliation0020.mysql.test.ts
server/database/staging0022.mysql.test.ts
server/database/staging0022Packaging.test.ts
server/database/tableManifest.ts
server/database/webhookInbox.mysql.test.ts
server/database/webhookTransaction.ts
server/db.ts
server/payments/webhookInbox.ts
server/security-hardening.test.ts
tsconfig.server.json
```


---


## Revisão RC2 — 09/10/2026, 23:48 UTC

**NO-GO para consolidar RC2 e iniciar a preparação da janela operacional. Nenhum commit criado.** Este resultado posterior prevalece sobre o aceite histórico abaixo. Nenhuma ação remota foi realizada.

Branch `feat/preorder-batch`; HEAD `ce9e84946d2773cdadee61254fc3ba5592f05001`. Os 18 arquivos da seção 10.8 conferem, mas há também o relatório preexistente não rastreado `staging-backup-validation.md`: **19 arquivos no delta**, inclusão ainda não definida. Relatórios e código preservados, índice vazio, zero arquivos commitados. A inspeção dos arquivos não identificou segredos nos padrões examinados, backups ou temporários no inventário. `.npmrc` e dist não foram adicionados. Isso não certifica ausência universal de segredos.

### Bloqueador financeiro — CONFIRMED, severidade alta

`server/db.ts:172–233`: qualquer chave duplicada retorna `duplicate: true`, sem consultar status ou comparar payload. `paymentController.ts:521–530` converte esse resultado em HTTP 200. Após falha do handler, o registro fica `failed`; sua retentativa recebe ACK sem tratamento. Um registro deixado em `processing` também recebe ACK por esse caminho. O ledger guarda hash e identificadores, sem payload completo; não foi identificado consumidor de recuperação desses registros. A persistência desse marcador não comprova inbox durável recuperável nem processamento financeiro.

Evidência MySQL reexecutada: `reconciliation0020.mysql.test.ts`, teste `runAsaasWebhookOnce uses the real ORM for processing/processed/failed and duplicate eventId`, comprova `failed`, `processedAt: null` e espera `duplicate: true` na retentativa sem executar handler. Reprodução complementar da função extraída/transpilada do fonte com insert duplicado simulado: `duplicate: true`, zero chamadas ao handler, nenhuma consulta de status. A reprodução simulada não substitui a evidência MySQL. O caso `processed` admite ACK idempotente; `failed`/`processing` exige decisão explícita de recuperação/retentativa, evitando repetição cega de efeitos. A correção envolve arquivo fora dos 18 e não foi implementada nesta revisão.

O delta atual corrige os quatro caminhos conhecidos: evento não suportado → 422; PAYMENT_DELETED inconsistente → 409; pedido não resolvido/ausente → 503. Os 34 testes de hardening passaram. PAYMENT_DELETED consistente continua registrando reconciliação sem cancelar/reembolsar; PAYMENT_RECEIVED preserva validações de moeda/valor/status e transição idempotente, encaminhando pagamento de pedido cancelado à reconciliação. Esses resultados não eliminam o bloqueador acima.

Manutenção: quatro testes PASS, 503 nos dois aliases de webhook e zero execução de handler; health 200. Retenção depende da fila Asaas, segundo semântica/fontes da seção 10.3, não de Retry-After ou memória. Não houve consulta ao provedor; estado/configuração/retomada da fila continuam pendentes. 422/409 também representam falhas de entrega: exigem corrigir causa/configuração antes de reativar a fila, sem descarte silencioso.

### Validação local final

Node **22.23.2**, pnpm **10.4.1**, sem instalação/atualização. **Vitest: 46 arquivos, 501 testes: 499 PASS, 2 FAIL, 0 ignorados**. Relatório `/tmp/l4ckos-rc2-vitest.json`, log `/tmp/l4ckos-rc2-vitest.log`, fora do Git. Suites aninhadas não foram contadas como arquivos.

Comando executado:

```bash
env -u VITE_DEPLOY_TARGET DATABASE_URL= RESEND_API_KEY= ASAAS_API_KEY= VITE_API_URL=same-origin VITE_SITE_MODE=store PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs L4CKOS_MYSQL_TEST=1 L4CKOS_LOCAL_SCHEMA=1 L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-0022-socket/mysqld.sock pnpm exec vitest run --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=/tmp/l4ckos-rc2-vitest.json
```

| Gate | Resultado |
| --- | --- |
| TypeScript cliente/servidor, pnpm check | PASS |
| Build frontend/backend, target/API staging explícitos | PASS; tentativa inicial sem target rejeitada por API_TARGET_REQUIRED, corrigida apenas na invocação |
| Navegador React, APIs simuladas e hosts externos bloqueados | 17 PASS |
| Auth release/logout | 6 PASS |
| Hardening/manutenção/confirmação de pagamento | 34 + 4 + 5 PASS |
| Checkout MySQL/API | 22 + 5 PASS |
| PREORDER MySQL/capacidade | 63 + 3 PASS |
| Schema workflow/backup restore/reconciliação 0020 MySQL | 20 + 13 + 10 PASS |
| Executor 0022 MySQL | 27 PASS |
| Empacotamento/publicação 0022 offline | 7 PASS |
| Probes legados staging/staging0021 | 2 FAIL: STAGING_REVIEWED_CLEAN_SOURCE_REQUIRED; mais 8 PASS em cada arquivo |
| git diff --check | PASS |
| Exportador Python | AST PASS; script/permissões revisados; sem --export |

Os dois probes exigem fonte Git limpa; guards não foram contornados, ignorados ou convertidos em aprovação. Ainda precisam passar em cópia limpa revisada após resolver os bloqueadores. Cancelamentos, reconciliação e reembolsos foram exercitados pelos caminhos locais da suíte; nenhuma cobrança/reembolso real foi executado.

MySQL local reutilizado: `l4ckos-0022-local-test`, rede none, sem portas publicadas, socket `/tmp/l4ckos-0022-socket/mysqld.sock`, fixtures sintéticas. Contêiner encerrado após ensaio. Nenhum banco remoto ou pedido #12 acessado/modificado.

### Executor, barreira e limites da evidência

Os 27 testes comprovam aplicação autorizada sob barreira, dados/defaults/FKs preservados, replay recusado, bloqueio de escritores existentes/nova admissão, transação em voo, rejeição de backup/scope inválidos, falha de persistência do inventário/quarentena, perda da barreira após primeira DDL, quatro falhas injetadas DDL/ledger, reentrância recusada na mesma conexão e rejeição de sessão estrangeira com advisory lock. A conta do operador bloqueada para novas conexões migra na sessão existente. Retirada sem aprovação recusada; migration não libera barreira automaticamente.

**Cobertura insuficiente para o aceite solicitado:** disconnect ensaiado ocorre depois de APPLIED, não durante DDL/checkpoint; falhas DDL são exceções injetadas. Falta perda real de conexão durante execução parcial, inspeção por nova sessão e recuperação dirigida preservando STARTED/FAILED/barreira. Recusa de replay não comprova reparo forward-only concluído. Falta disputa entre duas ativações completas de executor/barreira; testes atuais cobrem reentrância e sessão estrangeira. Não declarar esses cenários aprovados por extrapolação.

Migration 0022: comparação byte a byte com ce9e849 PASS, diff vazio; SHA-256 `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`. SQL/executores legados não alterados.

Antes de nova consolidação: corrigir ACK de failed/processing com regressão apropriada; definir inclusão do relatório preexistente; comprovar probes em fonte limpa e interrupção/recuperação/concorrência acima. **SHA RC2 inexistente; zero arquivos commitados; worktree sujo e preservado.** Stage/revisão staged/commit não realizados, conforme condição de parada do usuário.

Após aprovação local, ainda exigem evidência/autorização remota: identidade/deployment/UUID/endpoint, writers/grants/roles/replicação, manutenção efetiva, acesso independente/inventário de recuperação, backup contemporâneo restaurado, duração/locks DDL, fila Asaas/reconciliação, gatilhos e origem da publicação, startup/health/smoke funcional. Nada disso foi executado nesta revisão.

---

Preflight inicial: **09/10/2026, 22:41 UTC / 19:41 Brasília**. Atualizado após implementação e ensaios exclusivamente locais dos quatro bloqueios. **GO para revisão do novo código e preparação de novo commit local, sem criá-lo automaticamente. NO-GO para migration/publicação remota nesta execução.** Executor, barreira e rotina de backup foram implementados e ensaiados; sua aplicação no staging exige aprovação da janela/quarentena, backup contemporâneo, identidade efetiva e configuração de recuperação. Consulte as evidências e comandos na seção 10.

Fechamento dos ensaios: **09/10/2026, 23:43 UTC / 20:43 Brasília**. 82 testes relevantes aprovados em seis arquivos, mais reconferência direcionada da distinção entre SHA da candidata no ledger e SHA original do SQL. Typecheck e build do backend aprovados. MySQL local 8.4.11, rede `none`, sem portas publicadas, encerrado após os ensaios. Os exemplos históricos com ce9e849 nas seções de publicação exigem substituição pelo novo SHA explicitamente aprovado; não publicar ce9e849 para alegar entrega das correções desta tarefa.

Este documento prepara operações futuras. Nenhum comando de migration, deploy, restart, push, promoção, alteração de configuração ou de dados REMOTOS foi executado. Migrations, barreiras e restore foram ensaiados somente em MySQL local isolado com fixtures sintéticas. Não houve acesso ao projeto real de produção, inclusive metadados. O pedido #12 não foi alterado. O documento novo não integra nem modifica o commit aprovado.

Referências locais: [preparação operacional](operational-release-preparation.md), [RC](staging-release-candidate.md), [backup restaurado](staging-backup-validation.md), [homologação](staging-homologation-checklist.md) e [políticas financeiras](refund-reconciliation-runbook.md).

## 1. Identidade e origem observadas no preflight inicial

| Recurso | Evidência / alvo exclusivo |
| --- | --- |
| Branch local | `feat/preorder-batch` |
| HEAD / RC | `ce9e84946d2773cdadee61254fc3ba5592f05001` |
| Parent | `f519c11e94e57f76522db11f04254c5c17874598` |
| Índice | Vazio; nenhum diff staged |
| Delta anterior ao preflight | Somente `docs/preorder/staging-backup-validation.md`, não rastreado |
| Remote `origin`, repositório | `bezerrayan/L4CKOS` |
| Remote `release/l4ckos-rc` | `96ad76785e111881eacaaae0d8bf6044ab8ce651`, conferido com `git ls-remote` |
| Remote `feat/preorder-batch` | Não retornou ref na consulta de heads |
| Relação dos históricos | 118 commits exclusivos da RC e 40 exclusivos da branch remota; merge-base `b0cc43aa464936b75ffe8bed11b901dfbca94ec6` |
| Railway project | `l4ckos-staging` / `2bb90c8e-eb65-43ee-826b-f93750f0499c` |
| Railway environment | `15545eee-bc02-4b70-afc4-19a5db9e6f46`; nome interno `production`, exclusivamente deste staging |
| Railway API service | `l4ckos-staging` / `9f1c7705-f2f9-48cf-b957-8f63a6bba4db` |
| Railway MySQL service | `mysql` / `bcda5d78-4a0d-4682-8659-8316847addb7` |
| Database | `l4ckos_staging` |
| API pública | `https://api-staging.l4ckos.com.br`; domínio configurado para porta 8080 |
| Fonte configurada da API | Repo acima, branch `release/l4ckos-rc`, root `l4ckos-final/l4ckos-store` |
| Config Railway | Builder `RAILPACK`, healthcheck `/health`, 1 réplica; sem staged configuration observada |
| Último registro SUCCESS da API | `158d5b60-1bf4-4bd7-a259-54c83d315827`, criado `2026-10-09T03:08:35.773Z`; metadados retornados não comprovam SHA do runtime ativo |
| Vercel project | `l4ckos-staging` / `prj_FjQfmjB9QTjWxfXAGfBJXN73aAiA` |
| Vercel team | `team_CXUvSBkeWbzkpzZgd1cPlZiy` |
| Último deployment frontend | `dpl_7kM6qZ7kZ7C6HpoLDPwxuvs6MexB`, READY, origem `cli`, target `production` dentro do projeto staging |
| Frontend público | `https://staging.l4ckos.com.br` |
| Config Vercel conferida | `VITE_DEPLOY_TARGET=staging`, `VITE_API_URL=https://api-staging.l4ckos.com.br`, ambas no target `production` deste projeto staging |

O último frontend veio da CLI, sem SHA Git comprovado nos metadados retornados. Esses metadados também não expõem vínculo Git, branch de publicação ou Root Directory: permanecem pendentes de consulta restrita às configurações deste projeto staging. A branch configurada no Railway não prova o SHA da API ativa. Não consultar listagens globais de projetos para resolver essas lacunas.

## 2. Disponibilizar a RC sem publicação prematura

**Estratégia escolhida: fonte local limpa no SHA exato e publicação manual posterior, sem push.** Os históricos divergem: atualizar a branch remota para ce9e849 não é fast-forward. Merge/cherry-pick produziria outro SHA; force push está fora do procedimento. Publicar uma nova branch também pode disparar previews ou outros destinos conectados ao repositório compartilhado. Nenhuma branch remota precisa ser alterada para publicar manualmente a RC.

Railway pode implantar automaticamente quando a branch integrada recebe push; `railway up` faz upload **e inicia deploy**, não é um mecanismo de upload inerte. `Deploy Latest Commit` e aplicação de staged configuration podem usar a branch integrada e não a RC local. O estado efetivo de autodeploy não foi exposto pela consulta: tratar como habilitado até prova em contrário. [Referências Railway: autodeploy](https://docs.railway.com/deployments/github-autodeploys) e [CLI](https://docs.railway.com/cli/deploying).

Vercel pode gerar deployments por eventos Git, inclusive previews. `vercel.json` aprovado não desativa `git.deploymentEnabled`; ausência dessa configuração não prova gatilhos desligados. Não alterar a RC para acrescentá-la. Antes da janela, confirmar exclusivamente no projeto staging a integração Git, branch, previews, hooks e estado de promoção automática. [Git Vercel](https://vercel.com/docs/git/vercel-for-github) e [configuração dos gatilhos](https://vercel.com/docs/project-configuration/git-configuration).

Com autorização específica futura, suspender os gatilhos dos dois projetos staging e combinar congelamento de pushes na branch integrada. Se o provedor exigir desvinculação Git ou outra mudança, apresentar a alteração concreta antes de executar. Registrar configuração anterior, responsável, hora e prova de ausência de deployments em fila. Não disparar hooks, reconectar source ou aplicar staged changes para testar. Manter os gatilhos suspensos após a publicação enquanto a branch integrada permanecer em SHA diferente da RC; reativação requer um plano separado.

### Preparação local futura — executor técnico, observador fundador

Os blocos abaixo são instruções futuras, não um script único para executar sem gates. Executar em sessão com `set -euo pipefail`; interromper no primeiro erro. Escolher diretório novo, privado e fora do repositório para a fonte e evidências. Nunca reutilizar vínculo `.vercel`/Railway de outro projeto.

```bash
RC=ce9e84946d2773cdadee61254fc3ba5592f05001
REPO_ROOT=/home/yan/Documentos/l4ckos/worktrees/l4ckos-preorder
RC_ROOT=/tmp/l4ckos-rc-ce9e849-publication
APP_ROOT="$RC_ROOT/l4ckos-final/l4ckos-store"
umask 077
git -C "$REPO_ROOT" worktree add --detach "$RC_ROOT" "$RC"
test "$(git -C "$RC_ROOT" rev-parse HEAD)" = "$RC"
test -z "$(git -C "$RC_ROOT" status --porcelain)"
test ! -e "$APP_ROOT/.npmrc"
git -C "$RC_ROOT" diff --check
sha256sum "$APP_ROOT/database/migrations/0022_preorder_manufacturing_schedule.sql"
```

SHA do SQL deve ser exatamente `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`. O worktree detached contém somente a RC; não copiar os dois relatórios novos, `.env`, credenciais, backups ou `.npmrc`. Registrar manifest/checksum do contexto efetivamente enviado. Construir o frontend em uma segunda cópia privada da mesma fonte para não enviar `.vercel`, variáveis baixadas ou artefatos frontend ao Railway.

## 3. Gate do banco e janela sem escritores

Responsabilidade inicial dos **dois fundadores**: um aprova a janela e o escopo; o outro observa e confere as evidências. Nomear executor técnico e substituto, horários, canal restrito e limite de duração antes de começar. Nenhuma aprovação financeira manual autoriza migration ou deploy.

Antes de qualquer escrita remota, o operador deve confirmar simultaneamente project/environment/MySQL service IDs, deployment MySQL ativo, `DATABASE() = l4ckos_staging`, versão do servidor, UUID do servidor e vínculo da conexão com o serviço autorizado. Guardar UUID privado no manifest, sem divulgar credenciais. Conectar por loopback via SSH explicitamente direcionado ao MySQL staging; nunca resolver alvo por `.env` do repositório ou descobrir bases por tentativa.

Consulta de identidade Railway read-only em contexto isolado:

```bash
/home/yan/.railway/bin/railway status \
  --project 2bb90c8e-eb65-43ee-826b-f93750f0499c \
  --environment 15545eee-bc02-4b70-afc4-19a5db9e6f46 --json
```

Filtrar metadados na origem; não registrar JSON bruto com variáveis. O transporte SSH deve sempre receber os três IDs, incluindo serviço MySQL `bcda5d78-4a0d-4682-8659-8316847addb7`. Resolver senha dentro do serviço, sem argumento de processo, URL impressa ou cópia para o Git. Exigir ferramentas/privilégios existentes e espaço suficiente; instalação, nova porta, mudança de plano ou ajuste remoto exigem autorização distinta.

Pré-condições obrigatórias, todas com evidência:

1. Bloquear novas operações de escrita da loja/admin, webhooks, tarefas/filas, processos auxiliares e operadores. Inventariar todos os escritores e conexões, drenar requisições/transações em andamento e combinar tratamento de retries de webhook. Um advisory lock de schema não bloqueia checkout nem outros escritores.
2. Manter a barreira até ambos os deployments e smoke inicial passarem. Confirmar ausência de transações em `information_schema.innodb_trx`, concorrência de DDL/metadata locks e sessões escritoras pelos metadados disponíveis, sem imprimir SQL de clientes ou dados pessoais. Uma leitura pontual sem transações não prova que novos escritores não surgirão: a barreira precisa permanecer efetiva.
3. Há middleware aprovado `server/_core/stagingMaintenance.ts`: depende de `STAGING_MAINTENANCE_MODE=true`, NODE_ENV e dos três IDs da API; configuração é capturada no startup. Ativação exige nova inicialização autorizada, não um toggle instantâneo. Bloqueia rotas após `/health`, inclusive webhooks, mas não comprova interrupção de workers ou processos externos. GET `/health` 200 pode representar manutenção, não homologação funcional.
4. Existe também servidor separado `ops/staging-maintenance`, com guard de identidade e HTTP 503 fora de `/health`. Seu empacotador exige branch específica e não pode ser reutilizado cegamente no detached. O live builder é RAILPACK, não o Dockerfile desse servidor. Publicá-lo temporariamente ou trocar builder é operação adicional sujeita a aprovação, validação e retirada dos processos antigos. A barreira de banco implementada na seção 10 complementa o bloqueio HTTP. Sua ativação remota não foi autorizada nem executada; o inventário efetivo de escritores/processos continua sendo uma pré-condição da janela.
5. Exportar backup completo após drenagem, ainda sob barreira; `mysqldump --single-transaction --quick --skip-lock-tables`, incluindo routines/events/triggers e ledger. Conferir engines, grants, espaço, exit status, gzip e SHA-256. Restaurar em MySQL local isolado compatível, sem aplicação, rede externa ou event scheduler, e comparar schema, contagens, checksums e FKs. Não basta existir um `.gz`.
6. Cópia aprovada: `/home/yan/.local/share/l4ckos/staging-backups/20261009T221822Z/l4ckos-staging.sql.gz`, 22.542 bytes, SHA-256 `96fc3beb86861455196aa98ac465a3b76e6e6a83c3ca3422513477d8428a2848`; snapshot de 22:18 UTC. Privado, diretórios 0700/arquivos 0600. Restaurou 30 tabelas InnoDB/208 registros, checksums iguais e 0 órfãos em 10 verificações. Não há PITR nem cópia independente offsite. O executor novo exige provas com idade inferior a 15 minutos, incluindo restore; a cópia histórica não é elegível fora desse prazo. Fazer exportação contemporânea na janela. Qualquer escrita entre exportação, restore e aplicação muda o snapshot e bloqueia 0022 até novo backup/teste.
7. Conferir ledger e governança no remoto imediatamente antes da escrita. O backup registra 0020, baseline-v1 e 0021 concluídos, ausência de 0022 e das cinco colunas novas. Isso é evidência histórica, não consulta fresca neste preflight. Exigir mesma cadeia/checksums, nenhuma execução STARTED/FAILED, nenhuma migration desconhecida e fingerprints exatos abaixo.
8. Ensaiar 0022 sobre clone restaurado do backup da janela, preservando dados antigos e provando ledger/no-op/rejeição de replay e falha parcial do executor. O teste de restore anterior não equivale a teste desse futuro executor remoto.

## 4. Migration 0022: escopo e executor bloqueado

Artefatos aprovados: `database/migrations/0022_preorder_manufacturing_schedule.sql`, `manifest-v3.json` e contratos estruturais. Pre-fingerprint de negócio: `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a`; post-fingerprint: `a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e`. Governança: `47462fe9f093c89f83444b2b849ecf488ae7de04557a79e11286bf48484f693b`.

São exatamente três statements DDL:

| Ordem | Resultado esperado |
| --- | --- |
| 1 | `productionBatches`: duas DATE NULL (`estimatedManufacturingStart`, `estimatedManufacturingEnd`) e `manufacturingScheduleRequired` tinyint NOT NULL DEFAULT 0; lotes existentes conservam flag 0 |
| 2 | Mudar somente o default dessa flag para 1 para futuras inserções |
| 3 | `orderItems`: duas DATE NULL (`estimatedManufacturingStartAtPurchase`, `estimatedManufacturingEndAtPurchase`); snapshots históricos continuam NULL |

Não há backfill de pedidos, lotes ou datas; nenhuma exclusão. Comparar hashes dos valores antigos de todas as linhas, além das contagens, antes/depois. Comparar novas colunas separadamente: datas antigas NULL e flag antiga 0, default final 1. Não comparar checksum bruto da tabela inteira como igualdade após adicionar colunas, pois o shape mudou. Preservar todos os registros, inclusive #12, sem exibir seu conteúdo.

**A RC original não contém executor remoto 0022. Agora existe uma implementação operacional separada**, em `database/staging0022/`, testada localmente e ainda não commitada. `scripts/staging0022.ts` prepara prova/plano e payload; `window.ts` opera dentro do runtime Node existente da API staging, conectado ao endpoint privado previamente aprovado. Comandos na seção 10. Não requer Node instalado no contêiner MySQL.

`pnpm db:migrate` continua local; os executores 0020/0021 continuam com suas capacidades originais. Nenhum guard antigo foi removido. O empacotamento lê SQL e contratos diretamente do SHA ce9e849, incorpora somente módulos operacionais separados e registra SHA-256 de cada módulo e do payload. Tudo permanece DRAFT até revisão e autorização desse artefato; a implementação nova não pode ser atribuída ao commit ce9e849.

O executor verifica identidade/UUID/endpoint antes da conexão e antes das DDLs, prova recente, histórico exato 0020 → baseline-v1 → 0021, ausência de execução pendente/0022, checksum e escopo exclusivo de três statements. Usa o mesmo advisory lock da governança e recusa duas chamadas na mesma conexão. Snapshot integral é reconferido sob barreira imediatamente antes de escrever. Registra STARTED/checkpoints/COMPLETED ou FAILED, preserva os valores antigos, valida fingerprint v3/FKs e recusa replay. Não há retry ou retirada automática da barreira; finalização do ledger/execução é transacional, DDL não.

MySQL faz commits implícitos em DDL; a sequência não é atomicamente reversível com ROLLBACK. Os ADD COLUMN não são idempotentes. Falha, timeout ou perda de conexão exigem STOP, leitura do schema/ledger e preservação de evidências; não reexecutar para descobrir se terminou.

## 5. Backend: somente depois do gate de migration PASS

Executor técnico publica; fundador observador confirma identidade/fonte e autorização. Antes disso, registrar o deployment antigo realmente ativo, origem/artifact e configuração para recuperação. O registro SUCCESS listado na seção 1 é candidato, não autorização para rollback sem reconferência.

Revalidar live/staged config, build/start/pre-deploy commands e runtime exclusivamente no serviço API staging. Proibir migrations no startup/pre-deploy. RAILPACK observado não prova uso de `server/Dockerfile` (Node 22.23.2, build:server). Confirmar Node **22.23.2**, pnpm do `packageManager` e lockfile congelado; se Railpack construir também cliente, exigir os valores VITE staging no build. PORT efetivo deve atender domínio/healthcheck. Validar CORS/domínios, auth, sandbox Asaas, e-mail/transporte/storage isolados sem imprimir valores secretos. Não herdar configuração de outro projeto.

Comando futuro de publicação manual, **somente após autorização de deploy e PASS da 0022**, a partir da raiz completa do worktree limpo para respeitar o rootDirectory remoto:

```bash
cd "$RC_ROOT"
/home/yan/.railway/bin/railway up \
  --project 2bb90c8e-eb65-43ee-826b-f93750f0499c \
  --environment 15545eee-bc02-4b70-afc4-19a5db9e6f46 \
  --service 9f1c7705-f2f9-48cf-b957-8f63a6bba4db \
  --message "RC ce9e84946d2773cdadee61254fc3ba5592f05001 staging manual"
```

Railway CLI local observada 5.64.1; não usar `--new`, `--no-gitignore`, source connect ou `accept-deploy`. A mensagem é rótulo e não prova de origem: guardar manifest do upload, SHA da fonte e deployment ID. Não enviar .vercel/env/backup/credenciais. Tratar logs como potencialmente sensíveis e sanitizar antes de anexar.

Gate pós-backend: deployment correto realmente ativo, startup estável, sem crashes/restarts, schema/ledger v3 e leitura das rotas compatível com novos campos. Health HTTP 200 é necessário, mas insuficiente; distinguir API de servidor de manutenção. Não liberar escritas nem publicar frontend enquanto origem/runtime/config/API falharem.

GET futuro, sem redirects e sem corpo com dados de clientes:

```bash
curl --fail --silent --show-error --max-time 15 \
  --output /dev/null --write-out '%{http_code}\n' \
  https://api-staging.l4ckos.com.br/health
```

## 6. Frontend: build staging, deployment controlado e promoção

Vercel CLI não está instalada nesta máquina. Preparar versão fixada e conferir help/flags requer etapa própria, sem instalação implícita neste preflight. Confirmar Root Directory do projeto staging antes de montar a segunda cópia limpa da RC; bloquear se houver ambiguidade de monorepo.

Na cópia privada de build, definir `FRONTEND_ROOT` como diretório confirmado da aplicação. Usar IDs explícitos para impedir inferência de outro projeto; conferir o vínculo local criado e retornado por pull antes de build/deploy. O target Vercel `production` / `--prod` significa **apenas o ambiente que serve staging.l4ckos.com.br no projeto staging identificado**, nunca o projeto real de produção.

```bash
export VERCEL_PROJECT_ID=prj_FjQfmjB9QTjWxfXAGfBJXN73aAiA
export VERCEL_ORG_ID=team_CXUvSBkeWbzkpzZgd1cPlZiy
cd "$FRONTEND_ROOT"
vercel pull --yes --environment=production --scope "$VERCEL_ORG_ID"
```

Não imprimir arquivo de env baixado. Torná-lo privado, excluído do upload/Git; verificar apenas os dois valores públicos exigidos e vínculo project/team. O build local usa explicitamente:

```bash
VITE_DEPLOY_TARGET=staging \
VITE_API_URL=https://api-staging.l4ckos.com.br \
VITE_SITE_MODE=store \
vercel build --prod --scope "$VERCEL_ORG_ID"
```

Conferir install/build efetivos e saída `dist/public` conforme `vercel.json`; usar lockfile congelado. PASS exige bundle/hash registrado, somente API staging como destino da loja, ausência de hostname da API de produção, sem secrets/backups em `.vercel/output` e gate Vite aprovado. Configuração correta no provider não comprova o bundle antigo nem o futuro; inspecionar o artefato efetivamente gerado. [Build local](https://vercel.com/docs/cli/build).

Após backend PASS e autorização de publicação frontend:

```bash
vercel deploy --prebuilt --prod --skip-domain \
  --scope "$VERCEL_ORG_ID"
```

Registrar URL/ID retornados e associação inequívoca ao project staging, source manifest, artefato e READY. `--skip-domain` evita atribuição automática dos domínios, mas **já cria um deployment**; não executar para apenas preparar. Inspecionar a URL exclusiva desse deployment sem escrita, validar assets e destino API, observando proteção de deployment sem bypass improvisado. [Deploy e skip-domain](https://vercel.com/docs/cli/deploy).

Somente após aceite desse deployment e autorização para mudar o domínio, definir `FRONTEND_DEPLOYMENT_ID` com o ID novo conferido do projeto staging e executar:

```bash
vercel promote "$FRONTEND_DEPLOYMENT_ID" --scope "$VERCEL_ORG_ID"
```

Promover o deployment construído no target correto; não promover preview supondo mesmo build/env. Conferir aliases apontando ao ID novo, HTTP, assets/hashes e API staging no Network. Timeout de promoção não implica cancelamento: consultar estado antes de repetir. [Promote](https://vercel.com/docs/cli/promote).

## 7. Ordem, validações e autorizações

| Etapa | Responsável / autorização específica | PASS para avançar |
| --- | --- | --- |
| 0. Fechar lacunas | Executor prepara; dois fundadores identificados revisam | Comando real do executor 0022 testado, barreira concreta, triggers/root/runtime e recuperação aprovados |
| 1. Janela, barreira e backup | Fundador aprova; executor opera; outro observa | Identidade certa, nenhum escritor, backup recente privado/restaurado, ledger v2 limpo |
| 2. Migration 0022 | Autorização escrita para estes IDs/RC/checksum e somente 0022 | Três statements, fingerprint v3, uma entrada correta, COMPLETED e dados antigos preservados |
| 3. Backend | Autorização Railway API staging/fonte manual | Deployment ativo correto, startup/health/config/API compatíveis |
| 4. Frontend | Autorização Vercel staging/deployment e depois promoção | Build staging, READY, source/bundle corretos; aliases somente staging |
| 5. Smoke | Leituras iniciais; abertura de escrita/testes requer autorização própria | Catálogo/lotes/snapshots leem corretamente; auth/rotas negativas sem efeitos externos; ambos ativos corretos |
| 6. Homologação | Dois fundadores aprovam fixtures e escopo | Checklist executado com PASS/FAIL/NOT RUN; somente novas fixtures sintéticas autorizadas |
| 7. Retirada da barreira | Fundadores autorizam após aceite | Reconciliation de retries/filas, writers controlados, observação e recuperação disponíveis |

Na etapa 5, liberar escrita somente de fixtures autorizadas de forma controlada; se a barreira escolhida impedir qualquer teste funcional, manter NO-GO para abertura geral até definir esse acesso. Não usar pedido #12 ou dados reais. Pagamentos sandbox, e-mails e consultas externas exigem autorização própria; nenhum reembolso automático, operação financeira ou mudança de pedidos existentes é autorizada por este plano. As políticas financeiras continuam manuais e auditáveis conforme runbook.

Qualquer mudança remota para suspender gatilhos, ativar/desativar manutenção, substituir temporariamente API, alterar build/root/config/env, instalar ferramenta remota, criar recurso/porta ou restaurar banco demanda autorização concreta separada. Este documento não a concede. Nenhuma etapa autoriza acesso a produção.

## 8. Interrupção e recuperação

**STOP imediato** por alvo ambíguo, segredo em artefato/log, backup sem restore, escritor concorrente, drift de schema/ledger, SQL/checksum diferente, migration prévia ou parcial, falha/timeout, SHA/artefato errado, API sem saúde/compatibilidade ou frontend apontando a outro ambiente. Não avançar ao próximo componente, não repetir operação incerta e não retirar a barreira. Registrar horas UTC/Brasília, operação/deployment IDs, estado e evidências sanitizadas.

- **Antes de DDL:** sem alterações de schema; preservar evidências e fonte. Retirada da manutenção depende de aprovação e confirmação de estado anterior.
- **DDL parcial:** preservar STARTED/FAILED, checkpoint, schema/fingerprint e backup. Não usar DROP COLUMN, apagar ledger ou refazer baseline. Preparar reparo forward-only específico baseado no estado observado e ensaiar em clone; exige nova autorização. Se conexão caiu, confirmar estado antes de escolher qualquer reparo.
- **DDL concluída, backend falhou:** manter schema v3 e barreira. Reativar somente artifact anterior já registrado e comprovadamente compatível com v3 (novas colunas/defaults mudam comportamento de inserção); não presumir compatibilidade. Se não comprovada, continuar em manutenção e corrigir mediante revisão/autorização. Rollback do aplicativo não desfaz schema nem altera o ledger.
- **Frontend falhou:** conservar alias anterior até READY e smoke; se já promovido, retornar exclusivamente ao deployment frontend staging anterior reconferido e com API staging comprovada. Registrar ID e validar Network/health após ação autorizada. Não reconstruir da branch remota divergente para fazer rollback.
- **Restauração de banco:** último recurso, não ação automática. Primeiro restaurar backup preservado em outro MySQL local isolado, comparar novamente e decidir recuperação. Para recuperação remota, propor banco/volume substituto exclusivo staging, plano de reconexão e perda de dados desde o snapshot, sem sobrescrever a base original ou perder evidências. Provisionamento, importação e troca da aplicação exigem autorização nova; não há comando destrutivo de restore remoto neste plano.

Backup não oferece PITR; writes após snapshot não podem ser recuperadas daquela cópia. Não abrir operações enquanto o plano de recuperação da janela não estiver aprovado. Preservar backup/evidências fora do Git; nunca anexar dump ou credenciais ao chat.

## 9. Veredito após resolver os bloqueios técnicos localmente

**GO para revisar as alterações e preparar um novo commit local. NO-GO para 0022/deploy remoto nesta tarefa.** Foram implementados e ensaiados executor, quarentena de contas/sessões, restore com prova contemporânea e empacotamento/publicação manual sem push. Os gates que só existem na janela real continuam pendentes: autorização de indisponibilidade/quarentena, cópia de recuperação fora do runtime, identidade UUID/endpoint/deployment, inventário de writers/roles/replicação, backup/restore fresco e prova de estado dos gatilhos/fila de deployments staging.

Há uma correção mínima no webhook: respostas não duráveis deixam de confirmar HTTP 200. Isso muda código funcional aprovado e exige novo commit/revisão da candidata antes de publicar essa correção. O SHA ce9e849 permanece a referência imutável do SQL e do fechamento funcional anterior; não contém o executor nem a correção. A receita de publicação daquele SHA continua demonstrada, mas não deve ser usada para declarar a correção nova publicada. Depois do novo commit aprovado, registrar o SHA publicável e passá-lo como `approvedCommit` à especificação `manualPublication`; não presumir disponibilidade Git remota.

Nenhum commit automático, alteração de índice, push, acesso a produção/metadados, operação financeira, escrita remota ou alteração de pedido existente foi realizada. O relatório de backup não rastreado foi preservado. Evidência local e pendências remotas são separadas abaixo.

## 10. Implementação dos quatro bloqueios e ensaio reproduzível

### 10.1 O que os controles existentes realmente fazem

| Controle | Resultado da inspeção de runtime da RC |
| --- | --- |
| `MAINTENANCE_MODE` | Sem implementação; não ativa manutenção |
| `CHECKOUT_ENABLED` | Sem implementação; não impede checkout |
| `JOB_ENDPOINTS_ENABLED` | Sem implementação; não bloqueia rotas/tarefas |
| `OPERATIONAL_JOBS_ENABLED` | Sem implementação; não suspende processos |
| `STAGING_MAINTENANCE_MODE` | Middleware real, capturado no startup, exige IDs staging e NODE_ENV correto; HTTP 503 fora de `/health` |

Busca delimitada no código de execução e teste de regressão confirmam que os quatro primeiros nomes não substituem a flag implementada. Não foram introduzidas flags fictícias ou novos gates de frontend.

Escritores identificados no código: checkout REST e tRPC, claims/reservas/estoque/pedidos, ambos os aliases de webhook Asaas, rotas administrativas de produtos/lotes/pedidos/cupons, auth/OAuth/recuperação e sessões, carrinho/favoritos/endereço, reviews/uploads, waitlist, audit e outbox. Algumas leituras autenticadas podem persistir usuário/sessão; somente bloquear POST não basta. Há conexões diretas em `orders.ts`, `productionBatches.ts`, `db.ts` e utilitários de banco, além dos pools/sessões já abertos. Scripts de reset/restore e operadores também são escritores potenciais e devem ficar suspensos.

O scheduler encontrado no processo principal é `scheduleDailyBackup`: leitura do banco e escrita de arquivo, não uma fila que processe pagamentos. Não foi identificado worker/cron persistente de escrita no runtime inspecionado; handlers de outbox são acionados por fluxos da aplicação. Isso não comprova ausência de serviços externos, crons configurados no provedor ou scripts em execução. O inventário efetivo de processos/serviços com acesso ao MySQL permanece uma verificação específica da janela, sem consultar projetos externos ao staging.

### 10.2 Barreira implementada, alcance e condições

O módulo `barrier.ts` implementa uma janela de banco que **não depende do frontend**:

1. Exige MySQL sem event scheduler ativo, sem replicação/roles e sem transações InnoDB pendentes. A estratégia é deliberadamente conservadora: condições não suportadas geram STOP.
2. Exige conta existente de recuperação `root@localhost`, desbloqueada e privilegiada, acessível por socket dentro do serviço MySQL. Não cria conta, troca senha ou remove privilégios. Validar essa recuperação no staging antes de qualquer bloqueio é obrigatório.
3. Salva inventário de recuperação antes da primeira alteração; ativa `read_only=ON`; coloca em ACCOUNT LOCK todas as contas anteriormente desbloqueadas, exceto `root@localhost`.
4. Encerra as demais conexões de cliente depois da drenagem. ACCOUNT LOCK sozinho não afeta sessões existentes; `read_only` sozinho permite bypass administrativo. A combinação de quarentena, encerramento e verificação de ausência de sessões estranhas cobre os dois caminhos. A sessão do próprio operador continua utilizável mesmo com sua admissão bloqueada, confirmado no ensaio.
5. Reconfere a barreira e identidade antes de cada DDL. Uma nova sessão administrativa não autorizada, desbloqueio de conta, transação, scheduler ou mudança de modo interrompe a migration. Só um operador autorizado pode acessar o MySQL por socket/SSH na janela; a conta local de recuperação não é um endpoint de aplicação nem uma proteção contra um administrador que deliberadamente altere o servidor.
6. Mantém a barreira após sucesso/falha/desconexão. Não existe `finally` que desbloqueie as contas ou reabra escrita. O advisory lock é liberado; a quarentena/read_only continuam para os gates seguintes.

Para validar a nova API antes de reabrir escritas, `allowApplicationReads` só aceita conta já incluída na quarentena com USAGE e CRUD **exclusivamente na base em questão**, sem privilégios globais, roles ou GRANT OPTION. Exige 0022 concluída. Essa conta pode ler com `read_only=ON`; INSERT/UPDATE/DELETE são negados pelo MySQL. A conta root/global é rejeitada nesse gate. `releaseBarrier` exige aprovação separada e estado esperado, depois dos testes.

**Aplicação remota exige aprovação adicional** para SET GLOBAL, ACCOUNT LOCK/UNLOCK e KILL CONNECTION; nenhuma dessas operações foi realizada no staging. Não matar transações para “forçar drenagem”. Se a API usa conta administrativa compartilhada, não liberá-la para os smokes de leitura: preparar uma conta de aplicação limitada e mudança de credencial/configuração, com autorização própria. O operador não provisiona isso automaticamente. A admissão de leitura/reabertura após o processo remoto encerrar exige o procedimento manual de recuperação abaixo, dentro do MySQL staging, após reconferir grants/estado. Os helpers foram testados com a sessão local; não presumir que o token em memória sobreviva ao encerramento do processo.

Indisponibilidade: bloquear todas as rotas da API via middleware real ou substituir/parar o processo com estratégia aprovada; impedir reinício de writers paralelos e drenar atividades em voo. O gate HTTP precisa comprovar 503 em checkout, admin, auth e nos dois webhooks, com zero execução de handler; `/health` 200 não prova aplicação disponível. A janela inclui backup/restore, migration, leitura controlada da API nova, frontend e aceite antes da liberação. Não há prazo garantido sem medir os deployments reais. O plano/backup expira em 15 minutos; timeout/expiração interrompe, nunca amplia o prazo silenciosamente. Se a preparação não couber, revisar o limite antes de outra tentativa.

### 10.3 Webhooks financeiros e retenção

Durante a indisponibilidade, ambos os endpoints devem responder **503**, sem confirmar evento e sem iniciar efeito externo. Não existe nova inbox durável local nesta implementação. A retenção durante essa janela é a fila do **Asaas Sandbox**, não memória do processo ou um HTTP 200 vazio. O Asaas tenta novamente entregas que falham; após 15 falhas consecutivas a fila pode ser interrompida e eventos são mantidos por até 14 dias. Não presumir que Retry-After determina o intervalo real de reenvio. A fila interrompida requer correção do endpoint e reativação posterior; isso depende de autorização própria do provedor. [Comportamento oficial e retenção](https://docs.asaas.com/docs/sobre-os-webhooks), [reativação da fila](https://docs.asaas.com/docs/como-reativar-fila-interrompida).

Antes da janela, registrar estado da fila Sandbox e combinar observação. Depois, conferir eventos/intervalo e ledger idempotente `asaasWebhookEvents`, corrigir qualquer divergência e só então autorizar reativação/reprocessamento. O fluxo existente `runAsaasWebhookOnce` continua governando os eventos resolvidos. Não reenviar payloads à mão, duplicar cobranças, forjar eventos ou marcar reconciliação resolvida por SQL. Não deixar a fila parada até o limite de retenção.

**Correção CONFIRMED neste trabalho:** `paymentController.ts` retornava 200 sem ledger/processamento para evento desconhecido, pedido não resolvido/ausente e PAYMENT_DELETED com status inconsistente. Um teste reproduziu 200 em vez de 409 antes da alteração. Agora retornam respectivamente 422, 503, 503 e 409, preservando os corpos existentes e sem mutações financeiras. Há regressões com mocks para esses caminhos e para eventos processados/duplicados. Se a configuração Sandbox enviar eventos não suportados, corrigir o escopo/configuração com aprovação; não ocultar a incompatibilidade com um ACK falso. Essa correção justifica o pequeno delta funcional e exige nova candidata aprovada antes de considerá-la publicada.

### 10.4 Backup da janela e provas privadas

`staging0022-backup.py` é exportador de alvo fixo: IDs explícitos, identidade do runtime MySQL, UUID, nome de banco, versão 8.4, 30 tabelas InnoDB, privilégios globais de exportação, ledger sem pendência/0022 e espaço local mínimo de 256 MiB ou 20× estimativa. Usa **socket dentro do serviço MySQL**, sem porta pública ou instalação. Credencial fica somente no ambiente do serviço, nunca no argv/arquivo Git/log. Exporta stdout diretamente para gzip local privado; mantém `.partial` e diagnóstico privado em falha e nunca declara restore aprovado só por exportar.

O modo padrão é DRY_RUN e não chama Railway. `--export` é exportação remota read-only, a executar apenas na janela autorizada. O canal de exportação tem limite de 120 segundos. O histórico de backup original continua preservado; não sobrescrever seu diretório.

`capture` produz evidência de **todas as 30 tabelas**, incluindo governança: schema fingerprints, colunas, contagens, hashes integrais dos valores e hash de ledger. Os valores são lidos em memória para hashing, sem sair em logs/manifests. `restoreAndProve` importa o próprio gzip em schema vazio `l4ckos_test_*` num Docker local fixo, daemon Unix local, network none, sem aplicação; verifica vínculo do socket, MySQL 8.4/event scheduler OFF, igualdade completa dos snapshots/ledger e FKs. Recusa destino remoto, restore sobre base com tabelas, arquivo dentro de qualquer parte do worktree Git, symlink/arquivo público, gzip corrompido e prova incompleta.

`assertProof` exige snapshots antes/depois iguais ao restore, fingerprints v2/governança exatos, nenhuma inconsistência e idade inferior a 15 minutos. `package apply` reconfere gzip/hash/tamanho contra a prova; o executor compara novamente o banco ao snapshot sob barreira antes de DDL. Escrita desde a exportação → **BACKUP_NO_LONGER_CURRENT** → novo backup/restore, sem migration. Igualdade de contagens isolada não basta. O backup de 208 registros é evidência histórica, não exigência de que novas fixtures nunca tenham sido criadas no staging.

### 10.5 Comandos futuros e divisão de responsabilidades

**Não executados remotamente nesta tarefa.** O executor técnico prepara arquivos privados; os dois fundadores aprovam separadamente janela/quarentena, migration, publicação, efeitos externos e retirada da barreira. Usar Node 22.23.2/pnpm do projeto. Executar apenas os blocos cujo gate já passou, em sessão `set -euo pipefail` e `umask 077`.

1. Abrir diretório privado novo fora do Git. Obter UUID e deployment MySQL mediante leitura com project/environment/MySQL service IDs explícitos, socket local e guard de identidade dentro do serviço. Não derivar UUID de uma conexão API ainda não verificada. Registrar tamanho estimado e confirmar root local de recuperação, papéis/replicação, writers e estado de manutenção. Suspender operadores concorrentes; definir responsabilidade/canal.
2. O comando `identity` reutiliza as verificações read-only existentes de projeto, único deployment API ativo, MySQL exclusivo, URL API/MySQL coincidente e private-network DNS ligado ao serviço MySQL. Reconfere variáveis em memória, sem imprimi-las; rejeita alterações entre leituras. O resultado contém somente IDs/UUID e hash do endpoint aprovado.

```bash
PRIVATE=/tmp/l4ckos-0022-window-private
mkdir -m 700 "$PRIVATE"
pnpm exec tsx scripts/staging0022.ts identity "$MYSQL_SERVER_UUID" "$PRIVATE/identity.json"
pnpm exec tsx scripts/staging0022.ts package inspect "$PRIVATE/identity.json" - "$PRIVATE/inspect.cjs"
```

`MYSQL_SERVER_UUID`, `MYSQL_DEPLOYMENT_ID` e `ESTIMATED_BYTES` devem vir das leituras específicas do MySQL staging, não de valores de exemplo. Copiar/revisar manifests e hashes do operador. Payloads seguem **DRAFT**: preparar um commit operacional revisado e registrar seu SHA antes de autorizar execução remota. O empacotamento não altera a RC nem incorpora o `.npmrc`/relatórios/backup; SQL/contratos vêm de `git show ce9e849...`, código operacional tem checksums independentes.

3. Com manutenção HTTP/serviços já aprovada e ativa, colher snapshot antes e depois da exportação, somente via SSH da API staging. O payload inspect rejeita runtime/endpoint antes de conectar. O arquivo de stdout é privado; não enviá-lo ao chat.

```bash
/home/yan/.railway/bin/railway ssh \
  --project 2bb90c8e-eb65-43ee-826b-f93750f0499c \
  --environment 15545eee-bc02-4b70-afc4-19a5db9e6f46 \
  --service 9f1c7705-f2f9-48cf-b957-8f63a6bba4db \
  -- node --input-type=commonjs < "$PRIVATE/inspect.cjs" > "$PRIVATE/source-before.json"
python3 scripts/staging0022-backup.py \
  --directory "$PRIVATE" --server-uuid "$MYSQL_SERVER_UUID" \
  --mysql-deployment "$MYSQL_DEPLOYMENT_ID" --estimated-bytes "$ESTIMATED_BYTES" --export
/home/yan/.railway/bin/railway ssh \
  --project 2bb90c8e-eb65-43ee-826b-f93750f0499c \
  --environment 15545eee-bc02-4b70-afc4-19a5db9e6f46 \
  --service 9f1c7705-f2f9-48cf-b957-8f63a6bba4db \
  -- node --input-type=commonjs < "$PRIVATE/inspect.cjs" > "$PRIVATE/source-after.json"
pnpm exec tsx scripts/staging0022.ts backup-input \
  "$PRIVATE/source-before.json" "$PRIVATE/source-after.json" "$PRIVATE/export.json" "$PRIVATE/backup-input.json"
```

Conferir exit status e JSON de cada leitura. **Não avançar** se a CLI inserir banner em stdout, retornar erro ou houver snapshot inválido. Redirecionar stderr privado e sanitizar a evidência, sem anexar raw logs. Não usar um arquivo anterior com `>` por acidente: definir diretório novo e verificar nomes previamente. Durante inspeção e exportação nenhum payload apply foi enviado.

4. Preparar o Docker de restore **local**, nunca no Railway: imagem existente `mysql:8.4`, contêiner `l4ckos-0022-local-test`, `--network none`, sem portas, socket montado em diretório `/tmp/l4ckos-*-socket` privado, tmpfs em `/var/lib/mysql`, event scheduler OFF e binlog desabilitado. Criar schema vazio `l4ckos_test_0022_window_restore` somente nesse contêiner. O ambiente local usado no ensaio foi `/tmp/l4ckos-0022-socket/mysqld.sock`; não compartilhar com outro MySQL ou aplicação.

```bash
L4CKOS_LOCAL_SCHEMA=1 NODE_ENV=test \
L4CKOS_0022_LOCAL_URL=mysql://root@localhost/l4ckos_test_0022_window_restore \
L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-0022-socket/mysqld.sock \
pnpm exec tsx scripts/staging0022.ts prove-backup \
  "$PRIVATE/backup-input.json" "$PRIVATE/backup.sql.gz" "$PRIVATE/restore-proof.json"
pnpm exec tsx scripts/staging0022.ts make-plan \
  "$PRIVATE/identity.json" "$PRIVATE/restore-proof.json" "$APPROVED_APPLICATION_SHA" operador_aprovado fundador_aprovador "$PRIVATE/window-plan.json"
```

Os identificadores nominais de operador/aprovador são distintos e restritos; substituir os exemplos por responsáveis aprovados. Falha no restore mantém backup preservado e gera NO-GO. Não migrar esse clone usado como prova antes de salvar o resultado v2; ensaio DDL usa cópia adicional/fixtures.

`APPROVED_APPLICATION_SHA` é o SHA local da nova candidata após revisão e autorização. O plano separa `applicationCommit`, registrado no ledger, de `sqlSourceCommit=ce9e84946d2773cdadee61254fc3ba5592f05001`, origem imutável do SQL. O empacotador exige que o commit publicável exista localmente e que SQL, manifest v3 e contratos de schema/governança sejam idênticos aos aprovados. Isso não comprova disponibilidade no Git remoto. Não é necessário editar o executor para inserir o SHA do próprio commit.

Antes da janela, comprovar Node e resolução de `mysql2` no runtime da API usado pelo SSH. O payload mantém essa dependência externa; uma imagem de manutenção alternativa não pode substituí-lo sem essa comprovação. Essa inspeção remota permanece pendente de autorização.

5. Após revisão do plano/digest e autorização explícita de ACCOUNT LOCK/KILL/read_only **e somente 0022**, gerar payload apply. `PLAN_DIGEST` é o digest exato emitido por make-plan, revisado pelos fundadores. Revisar e registrar também SHA-256 do payload/manifests. Nenhum segredo ou dump integra o payload.

```bash
pnpm exec tsx scripts/staging0022.ts package apply \
  "$PRIVATE/window-plan.json" "$PLAN_DIGEST" "$PRIVATE/apply.cjs" "$PRIVATE/backup.sql.gz"
```

Revalidar identidade/deployment e checksum privado do backup imediatamente antes do envio. O comando seguinte **ativa a quarentena e escreve a migration**, portanto é reservado à futura autorização; não é uma simulação:

```bash
/home/yan/.railway/bin/railway ssh \
  --project 2bb90c8e-eb65-43ee-826b-f93750f0499c \
  --environment 15545eee-bc02-4b70-afc4-19a5db9e6f46 \
  --service 9f1c7705-f2f9-48cf-b957-8f63a6bba4db \
  -- node --input-type=commonjs < "$PRIVATE/apply.cjs" > "$PRIVATE/apply-result.json"
```

Um transporte interrompido não comprova falha da DDL. STOP e consultar estado por socket no MySQL staging. Nunca repetir payload apply para testar. O resultado retorna APPLIED ou STOPPED, horas/eventos, caminho privado da recuperação e indicação de barreira mantida. Rejeição de runtime antes de conexão retorna erro sanitizado; nenhuma URL/password é emitida.

6. **Antes de publicar outro backend**, copiar o arquivo de recuperação do `/tmp` da API para `$PRIVATE` por transporte privado read-only, com IDs staging explícitos. Não deixá-lo somente no runtime que será substituído; preservar a cópia após confirmação de hash. Conferir ledger único COMPLETED, schema v3, três checkpoints, dados antigos/FKs e read_only/quarentena. Backup de banco não restaura grants/contas globais: o inventário de recuperação separado é obrigatório.
7. Autorizar admissão de leitura somente de conta limitada já existente/conferida; manter read_only e bloqueio HTTP de escrita. Se precisar provisionar conta ou alterar DATABASE_URL, parar e aprovar essa mudança concreta. Publicar backend manualmente do SHA publicável revisado, validar leitura/saúde, depois frontend prebuilt/skip-domain e promoção controlada conforme seções 5–7. Não liberar root para contornar o gate de leitura.
8. Após aceite, recuperar admissão/global state e retirar manutenção com aprovação distinta; acompanhar fila Sandbox/reconciliação e smokes sintéticos autorizados. Falha em leitura/publicação mantém NO-GO e recuperação dirigida.

### 10.6 Recuperação operacional sem rollback fictício

Recuperação de admissão é diferente de recuperação de schema. Pelo **socket local do MySQL staging**, com guards de project/environment/MySQL service, DB/UUID conferidos e senha apenas no ambiente, comparar inventário privado com o estado real. Restaurar **somente** contas que estavam desbloqueadas e foram colocadas na quarentena; manter previamente bloqueadas. Para admissão temporária de API, reconferir grants limitados e desbloquear apenas a conta aprovada com read_only ON. Ao terminar a janela aprovada, desbloquear a lista anterior e restaurar read_only anterior (a ativação exige que fosse OFF). Cada ALTER USER deve usar parâmetros/quoting seguro revisado, nunca interpolar livremente nomes do JSON. Registrar início/fim/checksums e estados, sem publicar o inventário bruto.

A conta `root@localhost` existente permanece disponível para essa recuperação mesmo após o processo operador encerrar; esse cenário foi testado localmente, mantendo schema/ledger v3. **No staging, comprovar socket/grants/admissão/recovery inventory antes da janela é pendência obrigatória**. Se não existir esse acesso independente, não ativar quarentena e não criar/expor um acesso novo implicitamente. Uma falha parcial de quarentena mantém read_only mas não prova barreira completa; nenhum DDL é autorizado nesse estado.

Se houver STARTED/FAILED, DDL parcial, timeout de 45 segundos por statement ou perda de conexão, preservar backup e inventário, manter manutenção, reconferir fingerprint/checkpoints e preparar reparo forward-only específico ensaiado. Não retirar a barreira só porque a CLI terminou; não usar ROLLBACK como restauração de DDL, apagar ledger ou preencher datas antigas. Reinício do MySQL pode mudar variáveis globais enquanto contas permanecem bloqueadas: tratar reinício/deployment/UUID diferente como incidente de recuperação e reconferir tudo. Restore remoto continua sujeito ao plano e autorização separados da seção 8.

### 10.7 Publicação manual comprovada por inspeção/simulação

`publication.ts` produz somente uma especificação de comandos, sem spawn/SDK. Testes confirmam: IDs staging explícitos, fonte limpa no SHA local, nenhum push/merge/source-connect/accept-deploy, frontend bloqueado antes de API PASS, `--prebuilt --prod --skip-domain`, project/team e variáveis VITE exatos. O bundle operacional foi empacotado com SQL/contratos de ce9e849 e executado localmente sem Railway env: rejeitou antes de qualquer conexão, sem vazamento. O exportador foi exercitado em DRY_RUN e seu shell foi validado sem invocá-lo remotamente.

A prova de mecanismo é: **Railway CLI envia fonte local e implanta; Vercel CLI envia build local prebuilt e só promove domínios numa etapa distinta**. Não há Git push nesse caminho; ce9e849 não precisa existir no remoto para esses uploads. Preparar o payload/build local não dispara deploy Git. Upload/deploy é operação posterior autorizada, nunca um passo de preparação inerte. Fonte Git integrada, gatilhos ativos, deployments em fila e Root Directory/build/start precisam de reconferência somente nos projetos staging na janela. A simulação não comprova estado atual desses controles nem impede um push de outro operador; congelar coordenação e suspender gatilhos staging com autorização continuam pré-condições. Não reativar enquanto branch integrada divergir da candidata publicada.

### 10.8 Evidências locais, arquivos e aceite

Ensaio isolado: Node **22.23.2**, MySQL **8.4.11**, imagem local `mysql:8.4`, daemon Docker Unix local, `--network none`, sem portas, event scheduler OFF, sem aplicação/worker. Fixtures sintéticas próprias (pedido 901), nunca pedido remoto #12 ou conteúdo de clientes. Dumps de ensaio/provas foram gravados somente em diretórios privados `/tmp/l4ckos-0022-*` fora do Git. O backup original permaneceu intacto.

| Verificação | Evidência |
| --- | --- |
| MySQL 0022 | 27 testes: dump/restore real, 30 tabelas/ledger/FKs, snapshot v2, barreira, três DDLs, v3, dados antigos, default novo 1, replay recusado e retirada explícita |
| Falhas | SHA/checksum/alvo/backup vencido/dados alterados, gzip/prova, ledger/execution, scope/capability, transação em voo, persistência/quarentena, perda da barreira, quatro pontos de falha DDL/ledger e concorrência; nenhuma repetição cega |
| Recuperação/admissão | Operador com conta bloqueada continua pela sessão existente; recuperação local após disconnect; leitura com conta limitada funciona e escrita falha; root recusado para admissão de leitura |
| Packaging/publicação | 7 testes: RC/SQL embeds, checksum/mode privados, bundle rejeitado antes de conexão, payload inválido, comandos sem push/promoção automática, endpoint validado antes de conexão, rejeição de campos extras e flags inexistentes |
| Webhook/HTTP/payment | 34 hardening + 4 maintenance + 5 checkoutApi + 5 confirmation; tudo com mocks/HTTP loopback |
| Typecheck/build | `pnpm exec tsc --noEmit --project tsconfig.server.json` e `pnpm build:server` PASS; frontend não foi alterado |
| Exportador | DRY_RUN, AST Python e shell syntax/IDs/protocol SOCKET conferidos; **exportação remota não executada** |

Comando do ensaio MySQL/mocks, executado localmente (permissão de Docker/socket local necessária):

```bash
L4CKOS_MYSQL_TEST=1 L4CKOS_LOCAL_SCHEMA=1 \
L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-0022-socket/mysqld.sock \
pnpm exec vitest run \
  server/database/staging0022.mysql.test.ts server/database/staging0022Packaging.test.ts \
  server/security-hardening.test.ts server/_core/stagingMaintenance.test.ts \
  server/database/checkoutApi.test.ts server/payments/confirmation.test.ts \
  --maxWorkers=1 --minWorkers=1 --silent
```

O teste red comprovou ACK falso; passou após a correção. Falhas iniciais na construção da fixture v2 e comparação de COUNT big-number foram corrigidas no harness, sem alterar runner/SQL legado. Bloqueios de Docker/listen pelo sandbox foram resolvidos com aprovação apenas para o ensaio local. Não confundir testes locais com prova de ativação staging.

Delta desta tarefa, para revisão antes de novo commit:

```text
database/staging0022/barrier.ts
database/staging0022/capability.ts
database/staging0022/evidence.ts
database/staging0022/identity.ts
database/staging0022/package.ts
database/staging0022/policy.ts
database/staging0022/publication.ts
database/staging0022/restore.ts
database/staging0022/runner.ts
database/staging0022/window.ts
scripts/staging0022.ts
scripts/staging0022-backup.py
server/database/staging0022.mysql.test.ts
server/database/staging0022Packaging.test.ts
server/controllers/paymentController.ts
server/security-hardening.test.ts
tsconfig.server.json
docs/preorder/staging-deployment-execution-plan.md
```

O `staging-backup-validation.md` pré-existente não foi alterado; sua inclusão num commit futuro deve ser decidida no inventário específico. Não incluir backups, `.npmrc`, manifests/provas privados, payloads ou dist no Git. HEAD permanece ce9e849, branch feat/preorder-batch, índice vazio; mudanças novas estão no worktree, sem commit. Não alterar SQL 0022 nem os executores legados para autorizar esta operação.

**Aceite final:** mecanismo técnico e ensaio local aprovados para revisão/novo commit. Migration/publicação real continuam NO-GO até revisão do artefato operacional/correção, responsáveis e autorização concreta da janela, identidade e acesso de recuperação reais, backup recente restaurado, barreira/inventário efetivos, conta limitada para leitura quando necessária e controle dos gatilhos staging. Não há pendência técnica disfarçada de funcionalidade já publicada; os gates remotos estão identificados e não foram executados.
