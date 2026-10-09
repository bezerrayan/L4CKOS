# L4CKOS — Release candidate funcional 04/04

## 1. Decisão e escopo

09/10/2026. Identificação local atualizada: **L4CKOS-FUNC-RC04-20261009-API-GATE**.
**GO para criar o commit local após revisão e iniciar a preparação operacional local do staging**; não executar commit nesta tarefa. Gates de código locais aprovados; **NO-GO para executar deploy agora**: falta autorização, origem publicável aprovada, evidência de backup/configuração do staging e procedimento governado específico da 0022. Não é autorização para abrir a loja oficialmente.

Os parágrafos técnicos abaixo registram o gate anterior de isolamento. Nesta formalização, somente documentos foram alterados; as políticas financeiras foram aprovadas pelos dois fundadores. O resultado atual está na seção 12. As implementações 01–03 e os cinco testes de autenticação do bloco 04 foram preservados. O gate final remove o fallback da API, adiciona validação compartilhada de configuração no build e runtime e 13 regressões de isolamento. Mudanças desta execução: `client/src/const.ts`, `vite.config.ts`, novos `shared/apiConfig.ts` e `server/apiConfig.test.ts`, além deste relatório e do checklist. Sem alteração de schema, dependências, credenciais, processamento financeiro ou política comercial. Skills de isolamento, release e segurança orientaram a verificação local e a origem conferida.

Não houve commit/git push/deploy, acesso Railway/Vercel/banco remoto/produção, leitura de dados reais, cobrança, reembolso, etiqueta ou envio de e-mail real. Pedido real #12 não acessado. Referências em fixtures não representam esse pedido.

## 2. Origem e integridade

- Worktree exclusivo `feat/preorder-batch`; HEAD `f519c11e94e57f76522db11f04254c5c17874598`, parent `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`.
- Índice principal sem alterações staged; HEAD e histórico preservados. Estado deliberadamente sujo: **36 arquivos rastreados modificados + 21 arquivos novos**, relacionados abaixo. Não publicar HEAD isoladamente: ele não contém estas correções locais.
- Node **22.23.2**, pnpm **10.4.1**, Vitest **2.1.9**, MySQL local **8.4.11**. `package.json` e lockfile sem alterações; nenhuma instalação/atualização de dependência.
- Fonte testada nesta execução: cópia `/tmp/l4ckos-manufacturing-release-oioKJg`, **628 arquivos** rastreados/novos conferidos byte a byte por SHA-256, excluindo `.env`, `.npmrc`, dependências e artefatos locais. Árvore Git sintética `bbfbeb91bcbcec959faf1996200cc77400c52de7`; referência temporária `7e7b74ddefe4d3d4f31cdadb6b811081d2bc7a99`. Criada por plumbing somente em `/tmp`; nenhum comando `git commit`, hook ou alteração do índice principal. A suíte completa e os dois probes de empacotamento passaram nessa origem limpa.
- Identidade atual da fonte não documental: **588 arquivos**, SHA-256 agregado `c579dbafada47c1e7d3198d58264eb1923800d2747a49f74bd6d7cfae3a435b3`. Algoritmo: arquivos rastreados/novos, ordenados, excluindo `docs/`; concatenar `path + NUL + sha256(bytes) + LF`, aplicar SHA-256. Inclui código, testes, configuração versionada e assets; não inclui arquivos gerados. Comparação com a cópia testada encontrou somente normalização CRLF→LF nas linhas novas de `vite.config.ts` para satisfazer `git diff --check`; igualdade conferida após normalizar line endings, sem alteração de conteúdo funcional. Hash da cópia antes dessa limpeza: `4942a7a25e5c4b3f8bd1f5ec6648e8493c0277b5adb4d7176e10f6adc8c880a0`. As atualizações documentais são posteriores à suíte.
- Busca local nos 628 arquivos por assinaturas de chaves privadas PEM, AWS access key, chave live e chave Asaas: **zero ocorrências**. Revisão de diff/configuração não encontrou segredo novo; isso não substitui scanner completo de segredos/CVEs, que não foi executado. Variáveis efetivas foram carregadas pelo Vite conforme sua configuração usual de build, sem exportar ou imprimir segredos.
- Comparação byte a byte dos 586 arquivos não documentais da candidata 04 anterior (`/tmp/l4ckos-manufacturing-release-3fxqnN`) com o worktree atual: somente `client/src/const.ts` e `vite.config.ts` diferem; os demais arquivos existentes, inclusive o processamento financeiro e a 0022, estão integralmente preservados. Os dois novos arquivos deste gate são o validador compartilhado e seus testes.
- Não criar release do worktree sujo. Após revisão/autorização separada, obter fonte limpa que inclua **todos** os arquivos novos, registrar SHA completo e comparar conteúdo com a identidade acima. A referência sintética de teste não é commit publicável nem deployment.

## 3. Inventário exato da release contra HEAD

Código já presente em HEAD também integra a release, particularmente a correção de capacidade. A lista abaixo é o delta acumulado, não a totalidade da aplicação. Não publicar arquivos individualmente: construir backend e frontend da mesma fonte revisada.

### Frontend — 12 modificados

```text
client/src/components/CartDrawer.tsx
client/src/components/PreorderInfo.tsx
client/src/components/admin/batches/AdminBatches.tsx
client/src/components/admin/orders/AdminOrdersUI.tsx
client/src/const.ts
client/src/pages/AcompanharPedido.tsx
client/src/pages/Admin.tsx
client/src/pages/FAQs.tsx
client/src/pages/MeusPedidos.tsx
client/src/pages/Pagamento.tsx
client/src/pages/PedidoDetalhe.tsx
client/src/pages/ProductDetail.tsx
```

### Backend/shared — 15 modificados

```text
server/_core/security.ts
server/controllers/paymentController.ts
server/database/checkout.ts
server/database/productionBatches.ts
server/db.ts
server/emails/transactional/OrderCreated.jsx
server/emails/transactional/PaymentApproved.jsx
server/routers.ts
server/routers/admin.ts
server/routers/orders.ts
server/services/email/emailService.js
server/services/emailService.d.ts
server/services/shippingService.ts
shared/preorder.ts
drizzle/schema.ts
```

### Schema/ferramentas/build — 5 modificados

```text
database/bootstrap/bootstrap.ts
database/migrations/runner.ts
database/schema/artifacts.ts
scripts/database-schema.ts
vite.config.ts
```

### Regressões — 4 modificados

```text
server/database/checkout.mysql.test.ts
server/database/preorder.mysql.test.ts
server/database/preorderUi.test.ts
server/security-hardening.test.ts
```

### 21 arquivos novos — incluir explicitamente na futura origem

```text
database/bootstrap/manifest-v3.json
database/bootstrap/v3/orderItems.sql
database/bootstrap/v3/productionBatches.sql
database/migrations/0022_preorder_manufacturing_schedule.sql
database/migrations/manifest-v3.json
database/schema/contract-v3.json
docs/preorder/cancellation-refunds-review.md
docs/preorder/final-functional-audit.md
docs/preorder/shipping-deadlines-review.md
docs/preorder/staging-release-candidate.md
docs/preorder/staging-homologation-checklist.md
docs/preorder/refund-reconciliation-runbook.md
docs/preorder/operational-release-preparation.md
server/_core/security.logging.test.ts
server/apiConfig.test.ts
server/auth.release.test.ts
server/database/manufacturingSchedule.test.ts
server/database/orderShippingSnapshot.ts
server/database/shippingDeadlines.test.ts
shared/apiConfig.ts
shared/paymentExceptions.ts
```

`git diff --check`: **PASS**. `git diff --stat`: **36 arquivos, 801 inserções, 246 remoções**; esse comando não inclui os 21 novos. Sem reformatação global ou mudanças de dependências. O volume acumula correções 01–03, regressões e o gate de isolamento. Pequenos trechos LF coexistem com CRLF legado; somente linhas novas de Vite tiveram EOL corrigido para passar o check. `.npmrc`, `.env`, `node_modules`, `dist`, backups, sockets e credenciais não integram a origem.

## 4. Pendências do relatório 03 — classificação e gates

Leitura integral de `final-functional-audit.md`. O bloqueio crítico de isolamento identificado na preparação da release foi corrigido neste gate; nenhum P0 permanece aberto demonstrado no escopo local. Isso não significa ausência de vulnerabilidades. “Não bloqueia staging” pressupõe ambiente restrito e testes supervisionados; não libera lançamento.

| Item | Natureza / estado atual | Bloqueia deploy staging? | Bloqueia abertura? | Evidência para encerramento |
|---|---|---|---|---|
| P0 isolamento staging/produção | Defeito técnico **CONFIRMED, corrigido**: fallback de API e ausência de validação de build | Não pelo defeito corrigido; configuração explícita ainda é gate | Não pelo defeito corrigido | 13 regressões, builds negativos e bundle staging inspecionado; conferir artefato/hosts no preflight autorizado |
| P1 reset de senha não atômico | Defeito técnico **corrigido**, prova MySQL de concorrência/rollback novamente aprovada | Não | Não pelo defeito corrigido; falta smoke do fluxo completo | Reset real de fixture, token único, senha anterior rejeitada e sessões revogadas |
| P2 tokens em logs | Defeito técnico **corrigido**, dois testes aprovados | Não | Não pelo defeito corrigido | Logs de fixtures sem token, incluindo caminhos de erro; revisão de acesso/retenção |
| P1 autenticação pública | Configuração/operacional **aberto**; cinco novas provas locais, habilitação efetiva desconhecida | Não para ambiente restrito com contas controladas; exige preflight das flags | **Sim**, se nenhum caminho público funcionar | Cadastro/login/reset ou OAuth permitido, cookies frontend/API, dois usuários isolados |
| P1 financeiro/exceções | **Políticas V1 aprovadas pelos dois fundadores**; aplicação operacional/recovery ainda a homologar | Não para preparação local/testes sem devolução; gates externos permanecem | **Sim até homologação operacional** | Funções nominais/canal, auditoria manual, conciliação Asaas, prazos e recovery comprovados conforme runbook aprovado |
| P1 schema/config/origem | Dependência técnica/operacional **aberta**; 0022 local aprovada, remoto não inspecionado | **Sim até preflight, backup, origem e aplicação governada** | **Sim** | Identidade, schema/ledger, restore, checksum, API/runtime/deployment correspondente |
| P1 cartão/boleto | Homologação/configuração **aberta**; interface oferece ambos | Não para homologação restrita Sandbox autorizada | **Sim enquanto anunciados sem prova** | Aprovação individual ou bloqueio backend+frontend autorizado/testado |
| P2 gravações perfil/variantes parciais (LIKELY) | Risco técnico não reproduzido, **aberto** | Não sob avaliação de risco | Condicional: aceitar risco ou corrigir defeito reproduzido | CRUD/interruptions em fixtures, verificação de estado e decisão do responsável |
| P2 limiter em memória | Topologia/configuração **aberta** | Não em homologação controlada; confirmar réplicas | Condicional à topologia/aceite | Uma instância efetiva ou proteção compartilhada antes de escalar |
| P2 CSP/logs/SVG/CVEs | Hardening técnico/operacional **aberto**, não exploração demonstrada | Não por si só, com acesso restrito | Aceite de risco obrigatório; achado explorável reclassifica | Política de conteúdo/mídia, retenção/logs e scanner autorizado de dependências |
| P2 backup local | Operacional **aberto**; testes de restore sintético não provam backup remoto | **Sim para escrita de schema sem backup/restore verificável** | **Sim sem recuperação operacional** | Armazenamento persistente/off-site, checksum, retenção, restore isolado e responsável |
| P3 prompts/visual | UX visual, **postergado** | Não | Não | Backlog da etapa de design; sem reforma nesta release |

Não encerrados implicitamente por 464 testes: configuração real, mailbox, OAuth, cada modalidade, transporte externo, backup real e aplicação operacional das políticas aprovadas.

## 5. Autenticação e modalidades

Cadastro/login locais existem; defaults em runtime `NODE_ENV=production` desativam ambos. `ALLOW_LOCAL_AUTH_IN_PRODUCTION=true` habilita login; cadastro público exige também `ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION=true`. Quando cadastro público estiver desativado, conferir `LOCAL_AUTH_ALLOWED_EMAILS` explícita; o startup exige lista não vazia nessa combinação. Não ampliar allowlist nem flags nesta tarefa. `ADMIN_EMAILS`/`OWNER_OPEN_ID` devem identificar somente responsáveis; signup não pode tornar cliente admin por configuração errada.

Sessões JWT têm assinatura, issuer/audience, versão persistida; login/logout/reset rotacionam versão. Novo login invalida sessões anteriores conforme regra atual. Logout limpa cookie; falha de rotação é registrada, portanto não presumir revogação global em indisponibilidade do banco. Reset usa hash/expiração e transação; não há fluxo independente de troca autenticada de senha homologado aqui: a troca disponível é via recuperação. Cookies HttpOnly/Lax/Secure precisam de prova HTTPS/proxy/CORS/CSRF com os dois hosts reais do staging. Rotas privadas/admin e ownership têm testes locais; Google possui código/state/nonce/redirect/role, mas não homologação real nesta execução.

| Modalidade | Interface / backend | Criação e proteção | Evidência / pendência |
|---|---|---|---|
| PIX | Ambos oferecem `PIX` | Serviço envia billingType PIX; tentativa durável/replay e valor backend | Fluxo Sandbox anterior relatado, não prova nova da modalidade; validar QR/copia-e-cola/recebimento |
| Cartão | Ambos oferecem `CARD` | Serviço atual envia **UNDEFINED** e usa invoice hospedada Asaas; legado aceita CREDIT_CARD | Não comprova exclusividade de cartão, captura, 3DS ou parcelamento anunciado; homologar invoice antes de oferecer |
| Boleto | Ambos oferecem `BOLETO` | Serviço envia BOLETO; legado também aceita | Validar boleto/linha digitável/vencimento/liquidação; vencido não é cancelado |

Sem outra modalidade na interface principal. Endpoint legado aceita array PIX/CREDIT_CARD/BOLETO (default PIX+CREDIT_CARD), mas só pedido pendente elegível sem cobrança/tentativa existente, com claim durável antes do provedor. Não usar esse caminho para recriar cobrança de checkout transacional.

Webhook autenticado/idempotente, correlação e validação de valores/estados permanecem. Confirmação/recebimento aprovam quando válido; overdue/reembolso/deleted e pagamento tardio cancelado registram conciliação, não devolução automática. Duplicação, concorrência, pagamento tardio, resultado incerto, replay cancelado, STOCK/MIXED e reserva expirada têm regressões. Registro de erro no ledger não implica retry seguro: recovery é supervisionado.

**Não existe flag por modalidade nesta release.** Proposta sujeita a autorização: allowlist server-side de métodos, refletida na interface e no endpoint legado, com testes de rejeição antes de criar cobrança. Esconder botão sozinho não é bloqueio. Alternativa V1: homologar todas as modalidades anunciadas. Manutenção staging bloqueia o ambiente inteiro, não substitui allowlist e não deve ser usada para afirmar modalidade pronta.

## 6. Configuração necessária (nomes, nunca valores secretos)

Nenhuma configuração remota foi consultada. Lista é preflight a preencher, não afirmação de configuração efetiva.

| Grupo | Variáveis / requisito |
|---|---|
| Runtime/backend | NODE_ENV=production, HOST/PORT conforme plataforma, DATABASE_URL exclusiva staging; APP_ID/VITE_APP_ID coerentes; JWT_SECRET de pelo menos 32 caracteres, JWT_ISSUER, JWT_AUDIENCE, SESSION_TTL_HOURS; sem segredos VITE_* |
| Hosts frontend | **VITE_DEPLOY_TARGET=staging** e **VITE_API_URL=https://api-staging.l4ckos.com.br** obrigatórias no build de staging. VITE_BACKEND_URL é aceito somente como compatibilidade de desenvolvimento e não satisfaz um build de release. VITE_SITE_MODE=store para roteiro da loja; VITE_COMING_SOON conforme política. Ausência/valor inválido/URL de produção bloqueiam build e inicialização |
| URLs/backend | FRONTEND_URL=https://staging.l4ckos.com.br, CORS_ORIGINS limitado ao staging; APP_URL/APP_BASE_URL e PUBLIC_API_URL se usados pelos templates/unsubscribe, somente hosts staging. Conferir proxy/cookies/CSRF e redirects efetivos |
| Auth | ADMIN_EMAILS, OWNER_OPEN_ID, ALLOW_LOCAL_AUTH_IN_PRODUCTION, ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION, LOCAL_AUTH_ALLOWED_EMAILS explicitamente aprovados; defaults públicos restritos preservados |
| OAuth opcional | GOOGLE_CLIENT_ID (VITE_GOOGLE_CLIENT_ID é público), GOOGLE_CLIENT_SECRET apenas backend, GOOGLE_REDIRECT_URI registrado exclusivamente para staging; não inventar callback, conferir rota existente |
| Asaas | ASAAS_API_KEY somente Sandbox, **ASAAS_API_URL=https://api-sandbox.asaas.com/v3**, **ASAAS_CHECKOUT_BASE_URL=https://sandbox.asaas.com**, ASAAS_WEBHOOK_TOKEN. Defaults dos serviços apontam para Asaas real: nunca confiar em ausência de configuração. Conferir assinatura/configuração dos eventos habilitados, sem expor token |
| Frete | MELHOR_ENVIO_TOKEN, MELHOR_ENVIO_API_URL e MELHOR_ENVIO_FROM_POSTAL_CODE. Default API é www.melhorenvio.com.br/api/v2, não Sandbox. Confirmar conta/host e autorização para cotação; nenhuma emissão de etiqueta. Se indisponível, sem opção postal inventada; local só faixa existente/agendamento |
| E-mail | RESEND_API_KEY isolada, destinatários de teste aprovados, NO_REPLY_EMAIL/EMAIL_FROM_NOREPLY/EMAIL_FROM; ORDERS_EMAIL/EMAIL_FROM_SALES; EMAIL_FROM_FINANCE; EMAIL_FROM_CONTACT e EMAIL_TO_CONTACT; EMAIL_REPLY_TO/SUPPORT_EMAIL, alertas ALERTS_NOTIFICATION_EMAIL/ORDERS_ALERT_EMAIL; EMAIL_FROM_MARKETING se habilitado. Conferir links, remetente e destinatários reais antes de habilitar; ausência de chave não é modo seguro completo de homologação |
| Storage/operação | BUILT_IN_FORGE_API_URL/API_KEY se upload usar proxy; infraestrutura de mídia efetiva a confirmar. BACKUP_DIR persistente e restrito, retenção/off-site/restauração. Não confiar em diretório efêmero do processo |
| Isolamento | STAGING_MAINTENANCE_MODE apenas identidade staging válida. Não habilitar L4CKOS_LOCAL_SCHEMA, L4CKOS_MYSQL_TEST ou L4CKOS_LOCAL_RESTORE em ambiente remoto |

Se unsubscribe/review estiverem ativos, conferir também EMAIL_UNSUBSCRIBE_SECRET (fallback JWT_SECRET), URLs públicas e ORDER_EMAIL_PROVIDER_TIMEOUT_MS opcional; mudança de segredo invalida links anteriores e exige avaliação, não rotação automática nesta release. Não publicar notificações de marketing ou reviews sem escopo de destinatário/aprovação próprios.

Builds de release agora exigem destino declarado e API explícita. Comando validado: `env VITE_DEPLOY_TARGET=staging VITE_API_URL=https://api-staging.l4ckos.com.br VITE_SITE_MODE=store pnpm build`. `pnpm build` sem essas configurações não aprova release. Produção legítima deve declarar VITE_DEPLOY_TARGET=production e VITE_API_URL explicitamente (HTTPS ou same-origin/caminho relativo válido); só foi exercitada com resolução local/mocks. Alterar variáveis de build exige reconstrução do frontend.

O gate também cobre `build:client`, o buildCommand de vercel.json e o `RUN pnpm build:client` de client/Dockerfile, pois todos carregam vite.config.ts. Docker frontend lê `.env.frontend` como configuração pública de build; conferir os dois valores obrigatórios nesse arquivo/contexto isolado, sem adicionar segredos ou versionar arquivo local. No build via plataforma, fornecer as variáveis no estágio de compilação; configurá-las somente no runtime não muda o bundle. `server/Dockerfile` executa apenas build:server e não exige variáveis VITE da loja. Esses arquivos e vínculos de plataforma não foram alterados nem executados remotamente.

### Gate final de isolamento: causa, correção e inspeção

`client/src/const.ts` usava `PRODUCTION_API_ORIGIN` quando VITE_API_URL/VITE_BACKEND_URL faltavam em custom hosts; URL inválida também caía silenciosamente na origem do navegador/localhost. Esse módulo era a base de tRPC (inclusive auth, checkout e admin), CSRF, OAuth/login e CEP. O risco atingia o conjunto dos fluxos, não apenas um botão.

`shared/apiConfig.ts` valida o destino e produz `ApiConfigError` com código estável. `vite.config.ts` executa a validação antes de compilar: API_TARGET_REQUIRED/API_TARGET_INVALID, API_URL_REQUIRED/API_URL_INVALID e STAGING_API_ORIGIN_MISMATCH identificam os casos negativos. Staging exige HTTPS e exatamente a origem autorizada, sem credentials/query/fragment/path extra, e rejeita same-origin/URLs relativas. A configuração é revalidada ao carregar o cliente; um artefato de produção servido no host staging.l4ckos.com.br é bloqueado antes de iniciar os clientes. `apiUrl()` impede que um pathname mude a origem configurada. Erro de configuração interrompe a inicialização e não envia requisição nem inclui o valor bruto potencialmente sensível na mensagem.

Desenvolvimento local conserva localhost:3010 quando nenhum destino de release foi declarado; HTTP explícito só é permitido em loopback nesse contexto. Não é fallback permitido para release/staging. O transporte CSRF e tRPC, fetch de CEP, URLs de OAuth e proxy de imagens usam a base única. Map/Forge é serviço externo separado, não cliente secundário da API da loja; seus endpoints/funcionalidade não foram alterados. URLs de mídia/catalogação e links institucionais não são usados como fallback de API.

O bundle frontend validado tem **38 assets JavaScript**, **zero arquivos com `api.l4ckos.com.br`**, e uma única origem da API da loja: `https://api-staging.l4ckos.com.br`, em `index-DK_0kZNW.js`. SHA-256 agregado dos assets JS ordenados (filename + NUL + SHA-256 do arquivo + LF): `ecdfd6b8eac043dc1513c3649a237397f19f3aacea4b0c0c5030032e249aabf8`. Verificação estática local, sem consultar os destinos. Os arquivos backend em dist não fazem parte desse bundle; conteúdo legível de CSP/URLs institucionais não é destino de chamada da API do frontend.

Builds negativos reais foram bloqueados antes da compilação: destino ausente→API_TARGET_REQUIRED; staging sem VITE_API_URL→API_URL_REQUIRED; URL inválida com target production→API_URL_INVALID; staging com URL da API de produção→STAGING_API_ORIGIN_MISMATCH. Código de saída 1 é o resultado esperado nesses probes, não falha remanescente de build válido.

## 7. Migration 0022 e compatibilidade

Única nova migration necessária desta candidata: `0022_preorder_manufacturing_schedule.sql`; não editar/reaplicar 0020/0021 nem usar db:push. Pré-requisito: lineage 0021 reconhecida e fingerprint v2:

```text
pre:      6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a
post v3:  a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e
SQL hash: f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1
```

Três DDLs: duas DATE nullable e flag tinyint default0 em productionBatches; mudar default da flag para1; duas DATE nullable de snapshot em orderItems. Lotes existentes retêm flag0, fabricação NULL e gestão compatível; novos default1 exigem fabricação antes de OPEN. Pedidos históricos NULL não recebem datas fictícias. DATE representa dia civil Brasília, não timestamp; abertura/postagem conservam contrato anterior, validação compara dias corretamente. Testes de timezone e legado aprovados.

0022 é aditiva e backend anterior pode ler schema novo; rollback de código mantém colunas/dados. **Backend novo não funciona sobre v2.** Frontend anterior aceita campos extras da API nova, mas não exibe fabricação e algumas operações administrativas podem ser rejeitadas pelas novas validações: compatibilidade temporária de leitura não equivale a comunicação completa. Congelar cadastro/abertura de lotes e checkout durante transição; não deixar backend antigo criando lotes sob nova regra sem controle.

Runner operacional usa manifest-v3/checksums/ledger/fingerprint e lock; replay concluído é no-op comprovado em MySQL. SQL puro **não é idempotente** (ADD COLUMN duplicado falha). MySQL DDL tem commits implícitos: os três ALTERs não formam transação reversível. Falha parcial conserva evidência, exige inspeção; nunca apagar ledger ou repetir cegamente.

**Não há executor remoto da 0022 preparado nesta entrega.** CLI db:migrate permanece local-only; executores fixos staging 0020/0021 não servem para 0022. Antes de autorização de schema, preparar/revisar executor específico com identidade, SQL restrito, backup/restore, plano, locks, ledger e evidências; alternativamente DDL governado exato com autorização específica se histórico exigir. Não contornar guards locais. Isso é um gate operacional concreto, não uma migração executada.

Tempo/impacto no staging **não medidos**. Testes locais pequenos não estimam duração em orderItems real. Conferir tamanho, engine/versão, metadata locks, transações longas e capacidade de ALTER em clone isolado; estabelecer janela e limite de espera antes da operação. Possível bloqueio/rebuild exige pausa de escrita, monitoramento e critério de interrupção.

## 8. Gates locais do gate técnico anterior (evidência histórica)

| Gate | Resultado desta execução |
|---|---|
| pnpm check (cliente + servidor) | PASS, sem erros TypeScript |
| build com VITE_DEPLOY_TARGET staging / VITE_API_URL staging / VITE_SITE_MODE store | PASS, frontend + backend, sem contatos remotos |
| Builds negativos de configuração | 4 rejeições esperadas com código explícito, antes da compilação |
| Vitest completo, cópia fiel limpa | **44 arquivos / 464 testes PASS / 0 falhos / 0 ignorados** |
| Incluídos: apiConfig.test.ts | **13 PASS**, incluindo cliente CSRF real com fetch mockado, ausência de rede, URLs e origem cruzada |
| Incluídos: navegador React + APIs simuladas | **17 PASS**, sem hosts externos |
| Incluídos: transports/empacotamento offline | **18 PASS** nos dois arquivos, inclusive os dois probes |
| Incluídos: auth.release.test.ts | **5 PASS**, router/bcrypt/JWT reais; DB/e-mail isolados |
| MySQL local, incluindo checkout, schema, backup/restore, concorrência, reset, STOCK/PREORDER/MIXED | Executados, incluídos nos 451, **nenhum skip**; socket /tmp/l4ckos-final-fixes-mysql/mysqld.sock |
| git diff --check | PASS |

Inventário do gate técnico anterior: **56 caminhos únicos** de delta. Execuções isoladas/repetições não adicionadas aos 464 testes únicos.

Comando da suíte: `env -u VITE_DEPLOY_TARGET DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs L4CKOS_MYSQL_TEST=1 L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock pnpm exec vitest run --reporter=json --outputFile=/tmp/l4ckos-api-gate-vitest.json`, executado na cópia indicada. O same-origin acima pertence ao servidor de desenvolvimento com APIs simuladas dos testes, não ao build de staging. Provedores simulados; testes de adapters Railway usam fixtures offline, não CLI remoto. Schemas/contêineres MySQL sintéticos locais.

A tentativa inicial de testes sob sandbox restrito teve 3 erros de listen EPERM e 17 casos de navegador ignorados sem runner configurado; não foi tratada como aprovação. A execução final autorizada com infraestrutura local aprovou todos. O reinício do daemon interrompeu uma execução parcial, substituída pela suíte final com relatório JSON completo. Não há testes ignorados/falhos na execução final.

Os dois probes têm título `builds the exact Git bundle and executes it locally, without any DB/SSH/network access`, nos describes `fixed Railway transport, offline API fixtures only` e `fixed 0021 Railway transport, offline API fixtures only`. Falha histórica documentada: `STAGING_REVIEWED_CLEAN_SOURCE_REQUIRED`; guarda do teste olha diretório específico, empacotador exige projeto inteiro limpo. Não relaxada a proteção: nova execução limpa comprovou ambos.

**Não executados (não aprovados):** startup/health de deployment real, banco/configuração/backup remoto, OAuth real, pagamento externo de qualquer modalidade, transporte externo, upload remoto, mailbox, carga distribuída, scanner CVEs/pentest, CRUD integral e recuperação completa no navegador. Cinco testes de auth usam adapters DB, não comprovam persistência integral de signup/login em MySQL; reset atômico tem prova MySQL específica.

## 9. Publicação futura — sequência e autorização

Nenhuma fase abaixo executada. Autorização posterior deve dizer quais fases e efeitos externos permite.

1. **SOURCE/PREFLIGHT:** revisar todos os 57 arquivos de delta; obter origem limpa aprovada, registrar SHA/parent/checksums. Confirmar exclusivamente projeto `l4ckos-staging` (`2bb90c8e-eb65-43ee-826b-f93750f0499c`), environment interno `production` (`15545eee-bc02-4b70-afc4-19a5db9e6f46`), service staging (`9f1c7705-f2f9-48cf-b957-8f63a6bba4db`). Nunca consultar `l4ckos-production`, nem metadados. Registrar deployments anteriores e configuração para rollback sem valores secretos.
2. **BACKUP/ESTADO:** restringir acesso/pausar mutations de teste, registrar schema/ledger/checksums e snapshots sintéticos; backup completo consistente com dados + DDL + auditoria + webhook/outbox + governança, checksum/tamanho/armazenamento restrito e restore em clone isolado. Não basta contar linhas. Confirmar procedimento 0022, janela e responsável.
3. **SCHEMA:** aplicação controlada somente 0022 se v2 reconhecido; se já v3, conferir ledger/checksum e não reaplicar. Drift/estado parcial = STOP. Conferir fingerprint v3 e preservação de históricos/flags/quantidades.
4. **BACKEND:** publicar fonte correspondente, sem trigger acidental de branch antiga por staged config. Provar deployment ativo/source SHA, startup estável, logs sem segredos/crash, GET /health 200. Modo manutenção não prova funcionamento da aplicação nova; identificar resposta de manutenção separadamente.
5. **API:** schema/runtime/guards e rotas de leitura/auth com fixtures permitidas; não gerar cobrança nesse gate. Confirmar Sandbox/URLs/eventos e configurar e-mail/transportes somente conforme autorização.
6. **FRONTEND:** build da mesma candidata com VITE_DEPLOY_TARGET=staging e VITE_API_URL=https://api-staging.l4ckos.com.br; exigir sucesso do gate de build e inspecionar os assets antes da publicação, registrando hashes. Publicar somente após autorização e conferir deployment/source/asset/Network, sem chamadas a hosts reais de produção. Ainda sem abrir ao público.
7. **E2E:** liberar acesso restrito e executar [checklist](staging-homologation-checklist.md) com efeitos expressamente autorizados; financeiro segue [runbook aprovado](refund-reconciliation-runbook.md). Manutenção bloqueia também webhook; coordenar janela com provedor/ledger e não aceitar pagamentos durante pausa sem plano de conciliação.
8. **MONITORAR/ACEITAR:** registrar IDs de fixtures, evidências de provedor/webhook/mailbox quando autorizadas, zero duplicidade/delta indevido, erros/latência/restarts e aprovação dos responsáveis. Observação tem janela definida antes de testar; nenhuma duração inventada aqui. Homologação staging não autoriza produção nem abertura.

## 10. Rollback e interrupção

- STOP imediato: identidade ambígua/host produção, backup não restaurável, fingerprint/ledger divergente, ALTER parcial, runtime errado/crash, preço/frete alterado, capacidade/estoque excessivos, cobrança duplicada, confirmação falsa, dados de outro usuário, segredo exposto ou e-mail/destinatário fora do escopo. Pausar mutations e efeitos externos, preservar evidências; não repetir operações incertas.
- **Frontend:** retornar somente deployment/artefato anterior com API staging comprovada no bundle; artefato com fallback para produção não é opção segura. Validar origem/API e manter acesso suspenso se isolamento não puder ser comprovado. Manter checkout restrito se comunicação de fabricação sumir. Rollback frontend não cancela cobranças nem reverte compras.
- **Backend:** retornar artefato/deployment anterior registrado e configuração staging correspondente, compatível com schema aditivo. Não reverter JWT secret/sessionVersion/token consumido, claims/ledger ou confirmação financeira. Versão anterior perde proteções financeiras/reset: manter manutenção/checkout/admin restritos até correção, não aceitar exposição pública por mero health200.
- **Schema:** preferir manter v3 após rollback de código. Não há down migration simples autorizada; DROP perde snapshots e flag de compatibilidade. DDL parcial exige análise das instruções efetivamente aplicadas e plano de recuperação, nunca `ROLLBACK` presumido.
- **Desastre de dados:** recuperar backup em instância isolada, verificar schema e checksums, capturar alterações ocorridas desde backup e reconciliar provedor/webhooks/outbox antes de promover recuperação. Não restaurar backup por cima cegamente nem perder eventos posteriores. Restore de schema/dados remoto exige autorização distinta; `L4CKOS_LOCAL_RESTORE` não é escape remoto.

## 11. GO / NO-GO

**GO local técnico para o isolamento:** fallback eliminado, check/build/464 testes/diff aprovados, bundle sem destino de API de produção; candidata pronta para revisão e posterior aprovação de commit. A migration 0022 mantém SHA-256 `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`; nenhuma migration adicional ou alteração financeira foi criada neste gate.

**APTO COM RESSALVAS para publicação futura no staging**: o bloqueio técnico de isolamento está encerrado. Execução do deploy depende de autorização explícita, origem limpa identificada, alvo/configuração corretos, backup restaurável e plano governado 0022 aprovado. Esses gates externos permanecem **pendentes**; nada foi publicado nesta entrega.

**GO abertura oficial:** além do staging aceito, caminho público de auth comprovado, cada método anunciado homologado (ou bloqueado com autorização), aplicação do runbook/políticas aprovadas e funções dos fundadores identificadas, recuperação operacional validada e P2 aceitos formalmente. P0/P1 técnico novo, falha de segurança/financeira ou evidência ausente = NO-GO. P3 visual não bloqueia o aceite funcional.

## 12. Aprovação operacional e preparação local — 09/10/2026

**GO para criar o commit local posteriormente e iniciar preparação operacional local do staging. NO-GO para publicar, executar migration remota ou abrir a loja.** Nenhum commit, push, staging do índice, acesso remoto, operação financeira ou alteração de pedido executado. A preparação autorizada termina em documentos e evidências locais.

### Regras aprovadas versus implementação

Conforme aprovação comunicada pelo usuário, os dois fundadores aprovaram: reembolsos manuais e supervisionados; conciliação obrigatória com Asaas; parciais manuais; tratamento individual de lotes abaixo do mínimo; responsabilidade inicial dos dois fundadores; auditoria das aprovações e ações; respeito aos prazos legais, direitos do consumidor e política de cancelamento aplicável. Ver [runbook aprovado](refund-reconciliation-runbook.md).

Implementado: cancelamento administrativo auditado, liberação de reserva ativa e controles transacionais, observações de exceção/ledger e proteção contra duplicação/pagamento inconsistente. Não implementado: execução de refund automático, módulo completo de refund integral/parcial, saldo conciliado, formulário/dupla aprovação financeira ou notificações automáticas de cancelamento/refund. O controle manual restrito complementa a auditoria técnica; aprovação de política não adiciona funcionalidades.

### Verificações desta formalização

- Branch/HEAD/parent conferidos e inalterados; índice vazio. Delta final: **57 caminhos únicos (36 modificados + 21 novos)**, inventário exato na seção 3 e no [relatório de preparação](operational-release-preparation.md).
- Hash dos **588 arquivos não documentais** novamente calculado: `c579dbafada47c1e7d3198d58264eb1923800d2747a49f74bd6d7cfae3a435b3`, idêntico à seção 2. Blocos 01–04 preservados sem alteração funcional, visual, dependência ou schema nesta tarefa. Os 628 arquivos citados na seção 2 pertencem à fonte anterior; a fonte atual tem 629 com o novo relatório documental.
- Node **22.23.2**, pnpm **10.4.1**, conforme runtime/packageManager/lockfile existentes.
- Regressões locais selecionadas: **8 arquivos / 94 testes PASS / 0 falhos / 0 ignorados**. Cobrem isolamento API/CSRF, autenticação com adapters isolados, logs/CORS, fabricação, snapshots/prazos/frete, capacidade e checkout mockado. Comando: `env DATABASE_URL= RESEND_API_KEY= ASAAS_API_KEY= pnpm exec vitest run server/apiConfig.test.ts server/auth.release.test.ts server/_core/security.logging.test.ts server/security-hardening.test.ts server/database/manufacturingSchedule.test.ts server/database/shippingDeadlines.test.ts server/database/preorderCapacity.test.ts server/database/checkoutApi.test.ts --reporter=json --outputFile=/tmp/l4ckos-policy-approval-vitest-final.json`. Provedores mockados, sem banco real. Primeira execução: 91 PASS + 3 erros listen EPERM; repetição com permissão para porta loopback aprovou os 94. Não contar a primeira como aprovação integral.
- Validação local pelos leitores oficiais: contrato **v3** com fingerprint esperado, bootstrap e lineage/checksums válidos. Launcher tsx inicialmente bloqueado em IPC local; repetição permitida aprovou. SQL 0022 preservado com hash da seção 7. Nenhuma DDL executada nesta tarefa.
- Busca por assinaturas de PEM privado, AWS key e chaves de provider/Asaas: zero ocorrências. URLs com usuário/senha encontradas em oito arquivos são exemplos/fixtures sintéticos, incluindo teste negativo da API; nenhum segredo novo identificado. Não equivale a scanner completo nem inspeção de configuração remota.
- Validação documental: inventário comparado ao Git, links locais dos documentos atualizados, consistência da aprovação/limitações e `git diff --check` aprovados. Check/build/suíte completa/MySQL não repetidos: alteração exclusivamente documental e identidade não documental preservada. Os **464 testes**, check/build/DDL/restore locais da seção 8 são evidências anteriores, não execução desta formalização.

### Backup, restauração e ordem de execução futura

As seções 7, 9 e 10 são o procedimento proposto, sem execução: fonte limpa no SHA aprovado → preflight exclusivamente staging → pausar escritas e coordenar webhook → backup consistente completo (DDL/dados/audit/ledger/outbox/governança) em armazenamento restrito persistente fora do runtime, com checksum/tamanho/data/responsável → restaurar em clone isolado e conferir fingerprints, checksums de dados e eventos → **0022** → confirmar v3/preservação → **backend da candidata** com source/deployment/startup/health/API → **frontend da mesma candidata** com build/API staging explícitos → homologação restrita autorizada.

Antes do backup definir janela e plano para alterações posteriores; restore de desastre deve recuperar em instância isolada, reconciliar eventos/Asaas/outbox posteriores e exigir autorização antes de qualquer promoção. Preferir rollback de código mantendo schema aditivo v3; backend novo exige 0022, frontend antigo não comunica fabricação integralmente. Não usar DROP, db:push, runner local contra remoto ou executores staging 0020/0021 para 0022. DDL parcial exige STOP e análise, não rollback transacional presumido.

### Pendências e GO/NO-GO

Para commit local: incluir explicitamente os 57 caminhos da seção 3, revisar mensagem e não incluir arquivos locais/segredos/artefatos. Mensagem proposta e exclusões no relatório. O GO é técnico para próxima etapa, sem executar commit nesta tarefa.

Para escrita/publicação staging: autorização específica; commit/fonte limpa identificada; identidade/configuração efetiva exclusivamente staging/Sandbox; responsáveis nominais e canal manual; backup/restauração comprovados; executor governado específico da 0022 revisado, janela/locks/ledger/plano de falha. Essas evidências não foram consultadas e permanecem bloqueios concretos. Depois, provar deployments ativos/health/hosts e homologar auth, modalidades anunciadas, frete, e-mail e recovery conforme escopo autorizado.

NO-GO diante de alvo ambíguo/produção, ausência de autorização ou backup restaurável, drift de source/schema/checksum/ledger, DDL parcial, API indevida, crash, duplicação/divergência financeira, acesso cruzado ou exposição de segredo. Abertura oficial exige homologação completa e aceite dos riscos restantes; aprovação financeira isolada não a libera. Produção permanece proibida nesta tarefa.
