# Homologação final pré-produção — L4CKOS

Data de execução: 2026-08-27 (America/Sao_Paulo)

## Decisão executiva

**NO-GO. O checkout não deve ser aberto para clientes reais nesta condição.**

P0 e P1 estão verdes localmente, a cadeia de migrations foi executada num MySQL limpo e o restore local foi provado. Porém, o schema final das migrations diverge do schema usado pelo runtime, e não existe um staging completo e isolado disponível. Não foi possível validar provedores reais de sandbox, webhook externo, concorrência HTTP, e-mail real controlado, scheduler ou um banco com dados anonimizados representativos.

Nenhuma chamada mutável foi feita em produção. Nenhuma chave Asaas de produção foi usada. Nenhuma cobrança, e-mail a cliente ou migration remota foi criada/executada.

## 1. Inventário de ambientes

| Serviço | Local | Staging | Produção |
|---|---|---|---|
| Frontend | Vite, build local aprovado | Preview Vercel encontrado, protegido por SSO; não homologado | `l4ckos.com.br`, HTTP 200 via Cloudflare/Vercel |
| Backend | Express/tRPC local | Não encontrado/configurado de forma verificável | `api.l4ckos.com.br`, Railway, `/health` HTTP 200 |
| Banco | MySQL Docker isolado | Não encontrado | Configuração local aponta para MySQL Railway; instância remota não foi acessada |
| Asaas | Mock/inativo nos testes | Conta/chave sandbox não disponíveis | Configuração local de alvo produção existe; não foi usada |
| Resend | Cliente configurável; env inerte nos testes | Chave/domínio de teste não disponíveis | Configuração local indica Resend; estado remoto não verificado |
| Melhor Envio | Desativado/inativo nos testes | Não configurado | Configuração local indica endpoint/token de produção; não usado |
| Jobs | Timers internos e endpoints autenticados | Scheduler externo não encontrado | Estado remoto não verificável; `vercel.json` não contém cron |
| Storage | `uploads/`, volume Docker e fallback de proxy remoto | Não encontrado | Persistência efetiva no backend remoto não verificada |
| Backup | JSON interno + dump MySQL local testado | Não configurado | Política/retention/restore remoto não verificados |
| Observabilidade | Logs estruturados de segurança/jobs | Não encontrada | Health superficial; Vercel está em plano Hobby, sem evidência de drain/APM |

Constatações relevantes:

- O preview Vercel é somente evidência de frontend e retorna redirect para SSO. Ele não prova backend, banco ou provedores de staging.
- O checkout candidato está em worktree local com alterações não commitadas e não corresponde a um artefato de staging implantado.
- Os arquivos locais `.env` e `.env.backend` têm perfil de produção. Eles não podem ser reutilizados para staging.
- O health remoto atual confirma somente que o processo responde; não confirma banco, Asaas, Resend ou jobs.

## 2. Proteções de staging preparadas

Foi adicionado um template sem valores reais em `staging.env.example` e uma validação fail-closed no startup do backend.

Quando `DEPLOY_ENV=staging`, o processo recusa iniciar se:

- host/nome do `DATABASE_URL` divergirem dos valores esperados;
- o host for igual ao host explicitamente marcado como produção;
- `ASAAS_API_URL` não for `api-sandbox.asaas.com`;
- a chave Asaas não tiver prefixo de homologação;
- frontend/app/CORS apontarem para os domínios de produção;
- Melhor Envio tiver token com URL fora do sandbox;
- `CRON_SECRET`, token de webhook, allowlist de e-mail ou escolha explícita de jobs estiverem ausentes.

O serviço de e-mail bloqueia, em staging, qualquer destinatário fora de `STAGING_EMAIL_ALLOWLIST`, exceto endereços controlados `@resend.dev`.

O endpoint `/ready` agora distingue:

- banco: check vivo `SELECT 1`;
- schema: compatibilidade mínima de colunas críticas e nulabilidade;
- jobs: estado do processo/scheduler;
- Asaas e Resend: somente `configured`/`unconfigured`, sem alegar disponibilidade não testada.

## 3. Preflight realista

Não houve acesso a uma cópia recente e anonimizada de produção. Portanto, estes resultados são de banco sintético local e **não substituem o preflight real**.

### P0 — banco sintético

| Diagnóstico | Quantidade | Classificação |
|---|---:|---|
| Estoque negativo de produto | 0 | OK |
| Estoque negativo de variante | 0 | OK |
| Produto com opções sem variantes | 0 | OK |
| Item com quantidade inválida | 0 | OK |
| Item órfão | 0 | OK |
| Pedido sem item | 0 | OK |
| Reserva órfã/inválida/expirada ativa | 0 | OK |
| Variante legada sem `optionKey` | 0 | OK |
| Pedido legado sem evidência financeira reconciliável | 1 cancelado | WARNING no dado sintético; exige revisão por regra no real |

Consultas de detalhe sem linhas não são listadas como achados.

### P1 — banco sintético

O preflight foi ampliado para refunds, totais financeiros, fulfillment, eventos e leases da outbox.

| Diagnóstico | Quantidade | Classificação |
|---|---:|---|
| Negativos/estados inválidos/órfãos | 0 | OK |
| Totais financeiros/refund incoerentes | 0 | OK |
| Evento com order/payment divergente | 0 | OK |
| Outbox com lease/status incoerente | 0 | OK |
| Soma dos itens diferente do pedido | 1 | BLOCKER no snapshot sintético |
| `inventory_exception` sem metadados coerentes | 1 | BLOCKER no snapshot sintético |

Esses dois blockers foram gerados por dados residuais de cenários de teste e demonstram que o preflight os detecta. A suíte isolada limpa sua base antes de cada caso e passou; ainda assim, qualquer ocorrência equivalente numa cópia real bloqueia migration até resolução documentada.

## 4. Classificação do legado

Sem a cópia real não há IDs reais a listar. A fila operacional deve usar estas regras, sem completar fatos por suposição:

| Classe | Regra |
|---|---|
| AUTO-MIGRATABLE | Sem órfãos/duplicatas/negativos; snapshots completos ou campos historicamente desconhecidos permanecem `NULL`; total aritmético reconstruível; constraints passam |
| MANUAL REVIEW | Pedido sem evidência financeira; produto com opções sem variantes; SKU/variante duplicados; divergência produto×variantes; total pedido×itens; estado financeiro×fulfillment; outbox/lease incoerente |
| UNRECOVERABLE | Tamanho/cor histórico sem fonte comprobatória; referência financeira perdida sem correlação externa; órfão cujo pai não pode ser identificado; duplicata sem regra segura de precedência |

Registros `UNRECOVERABLE` não devem receber tamanho, cor, payment ID ou status inventado. Devem ser preservados como legado, isolados da automação e tratados por decisão operacional auditada.

## 5. Ensaio das migrations

Base nova e vazia, MySQL real local, ordem 0000→0014:

| Medida | Resultado |
|---|---:|
| Migrations | 15 |
| Statements | 59 |
| Warnings MySQL | 0 |
| Tabelas finais | 23 |
| PK / UNIQUE / FK / CHECK | 23 / 14 / 7 / 10 |
| Dados / índices alocados | 376.832 / 573.440 bytes |
| 0013 P0 total | 156,548 ms |
| 0013 P0 em ALTER TABLE | 87,955 ms |
| 0014 P1 total | 482,229 ms |
| 0014 P1 em ALTER TABLE | 482,027 ms |
| Statement mais lento | 42,133 ms |
| Metadata locks pendentes ao final | 0 |

Limite da evidência: a base estava vazia e sem concorrência. Os tempos e locks não podem ser extrapolados para produção. É obrigatório repetir em cópia anonimizada com volume representativo, observar `performance_schema.metadata_locks`, tempo de cada ALTER e espaço livre.

### Schema drift bloqueante

O verificador read-only entre `drizzle/schema.ts` e a base criada por 0000→0014 encontrou:

- `productImages.color` ausente;
- `promoBanners.imageUrl`, `mobileImageUrl`, `imageAlt` e `linkUrl` ausentes;
- `waitlist_emails.created_at` nullable no banco, mas non-null no schema.

O backup JSON automático falhou ao consultar `productImages.color`. O dump MySQL continua funcional, mas o runtime não é compatível com uma base criada somente pelas migrations. É necessário criar/revisar uma migration corretiva e ensaiá-la; ela não foi inventada durante a homologação.

## 6. Recovery de DDL parcial

Foi criada uma base em 0013. Apenas o primeiro `ALTER TABLE orders` de 0014 foi aplicado; em seguida foi injetada uma falha. A inspeção mostrou as quatro colunas de `orders` presentes e nenhuma coluna financeira nova em `payments`.

A recuperação retomou no segundo statement, sem reaplicar o primeiro. Resultado:

- retomada: 0,52 s;
- colunas obrigatórias ausentes: 0;
- constraints finais: 23 PK, 14 UNIQUE, 7 FK, 10 CHECK.

Regras de recovery:

1. interromper escrita, jobs e novos deploys;
2. registrar erro e statement exato;
3. consultar `information_schema.COLUMNS`, `STATISTICS`, `TABLE_CONSTRAINTS` e `SHOW CREATE TABLE`;
4. comparar o estado com 0013/0014 statement a statement;
5. retomar do primeiro statement comprovadamente ausente;
6. executar preflight pós-recuperação e confirmar schema final;
7. não reaplicar `ADD COLUMN`, `ADD INDEX`, `ADD CONSTRAINT` ou `CREATE TABLE` já existentes;
8. os `UPDATE` de backfill são determinísticos, mas só devem ser repetidos após confirmar que não sobrescreverão correções posteriores.

## 7. Backup e restore

Teste local com dados sintéticos:

| Medida | Resultado |
|---|---:|
| Formato | `mysqldump --single-transaction` |
| Tamanho | 34.517 bytes |
| Backup | 0,13 s |
| Primeiro restore | 0,47 s |
| Segundo restore após marker | 0,60 s |
| Marker removido pelo restore | Sim |
| Contagens críticas origem=destino | Sim |
| Checksums de orders/items/payments/events/reservas | Iguais |
| `CHECK TABLE` em 9 tabelas críticas | Todas OK |

Isso prova o mecanismo local, não a política de backup/restore do banco gerenciado nem o RTO com volume real.

## 8. Provedores e E2E

| Cenário | Resultado | Evidência |
|---|---|---|
| PIX/Boleto/Cartão Asaas sandbox | BLOCKED | Conta/chave sandbox ausentes |
| Webhook real e reenvio | BLOCKED | Backend staging público ausente |
| Ordem de eventos | PASS local / não reproduzido sandbox | Testes de máquina de estados |
| Refund parcial/total | PASS local / BLOCKED sandbox | P1 local; sem operação real sandbox |
| Chargeback | PASS local / BLOCKED sandbox | P1 local; sem evento real sandbox |
| Timeout após criação | PASS local mock / BLOCKED sandbox | P0 reconcilia por `externalReference` |
| Resend real | BLOCKED | Chave/domínio de staging ausentes |
| Dois workers reais | PASS lógico local / BLOCKED multi-instância | P1 cobre claim concorrente; sem staging |
| Jobs manual+scheduler | PASS lógico local / BLOCKED staging | Endpoint exige bearer; scheduler não existe em staging |
| Reserva expirada/inventory exception | PASS local / BLOCKED HTTP staging | P1 |
| Pagamento manual/cancelamento | PASS local | P1 |
| Concorrência 1/2 e 5/20 | PASS transacional local / BLOCKED HTTP staging | P0 não atravessa backend implantado |
| 10 checkouts iguais | PASS local mock / BLOCKED HTTP+sandbox | P0 |
| E2E browser cliente/admin | BLOCKED | Preview protegido e sem backend staging |

O utilitário `agent-browser` não está instalado neste ambiente. Não foi usado um navegador alternativo para simular uma homologação inexistente; o preview respondeu 302 para SSO.

## 9. Segurança

Já coberto por código/testes locais: ownership de pedido, validação de payload/preço/quantidade, procedure admin, token de webhook, `CRON_SECRET`, idempotência e divergência financeira.

Não executado por HTTP contra staging: usuário A→pedido B, adulterações de IDs, preço/quantidade, admin sem role, cron sem/errado secret, webhook sem/errado token, payment incompatível e valor divergente. Todos permanecem critérios obrigatórios antes de GO.

## 10. Observabilidade e health

Não foi possível reconstruir um pedido real de staging ponta a ponta. O modelo possui campos úteis (`correlationId`, `checkoutAttemptId`, IDs internos/externos, eventos, reservas, auditoria e outbox), mas a prova operacional não existe.

Falhas atuais:

- não há pedido staging para correlacionar;
- logs não foram demonstrados numa única busca por correlation ID;
- não há alerta comprovado para job, webhook, reconciliação, estoque ou outbox dead;
- `/health` remoto é liveness superficial;
- o novo `/ready` ainda precisa ser implantado em staging e monitorado;
- checks de Asaas/Resend são apenas configuração até testes seguros reais.

Smoke local do artefato compilado:

- `/health`: 200;
- banco no `/ready`: `up`;
- schema incompatível no `/ready`: `down`, resposta 503;
- jobs desabilitados: distinguíveis;
- endpoint de job com bearer errado: 401;
- backup automático desabilitado explicitamente: nenhuma execução acidental.

## 11. Testes e build

| Validação | Resultado |
|---|---:|
| P0 MySQL real local | 31/31 PASS |
| P1 MySQL real local | 33/33 PASS |
| Máquina de estados | 6/6 PASS |
| Isolamento de staging | 3/3 PASS |
| Allowlist de e-mail staging | 2/2 PASS |
| Typecheck client/server | PASS |
| Build Vite/backend | PASS |

As suítes P0 e P1 devem rodar em processos/bases separados. Uma execução paralela compartilhando o mesmo banco gerou interferência de limpeza e não deve ser usada no CI.

## 12. Matriz GO/NO-GO

| Critério | Resultado | Bloqueia produção? |
|---|---|---|
| P0 | PASS local 31/31 | Não, isoladamente |
| P1 | PASS local 33/33 | Não, isoladamente |
| Migration | Runner completa; validação schema/runtime FAIL | Sim |
| Compatibilidade schema/runtime | FAIL: 5 colunas ausentes + 1 nulabilidade | Sim |
| Preflight | PASS/diagnóstico em sintético; cópia real ausente | Sim |
| Staging | Incompleto | Sim |
| Asaas sandbox | Não executado | Sim |
| Webhook real | Não executado | Sim |
| Refund sandbox | Não executado | Sim |
| E-mail real controlado | Não executado | Sim |
| Jobs/scheduler staging | Não executado | Sim |
| Estoque E2E staging | Não executado | Sim |
| Checkout HTTP concorrente | Não executado | Sim |
| Segurança HTTP staging | Não executado | Sim |
| Observabilidade ponta a ponta | Não demonstrada | Sim |
| Health/readiness | Preparado local; não implantado | Sim |
| Backup/restore | PASS local; gerenciado/volume real ausente | Sim |
| Rollback | Runbook preparado; não ensaiado em staging | Sim |
| Artefato de release | Mudanças locais não implantadas em staging | Sim |

## 13. Bloqueadores exatos restantes

1. Provisionar frontend, backend, MySQL, storage e scheduler de staging realmente isolados.
2. Implantar neste staging um artefato versionado contendo P0/P1 e as proteções de ambiente.
3. Corrigir o schema drift entre migrations e runtime, ensaiar a migration corretiva e obter `/ready` 200 numa base criada do zero.
4. Obter e anonimizar uma cópia recente do banco real; executar P0/P1 e migrations com volume/locks representativos sem blockers.
5. Configurar credenciais exclusivas de Asaas sandbox e homologar PIX, boleto, cartão suportado, webhook, retries, refund e chargeback quando reproduzível.
6. Configurar Resend de teste, remetente/domínio e allowlist; provar falha, retry, deduplicação e dois workers reais.
7. Configurar e provar scheduler/jobs com `CRON_SECRET`, concorrência e recuperação de lease.
8. Executar concorrência por HTTP e o E2E cliente→admin→cliente no staging.
9. Executar a matriz de segurança por HTTP no staging.
10. Reconstruir um pedido real de staging por todos os IDs e demonstrar logs/alertas/readiness.
11. Ensaiar deploy e rollback no staging, incluindo backup/restore do banco gerenciado e critérios GO/NO-GO.

**EU ABRIRIA O CHECKOUT DA L4CKOS PARA CLIENTES REAIS AGORA?**

**NÃO**
