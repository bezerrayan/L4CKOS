# Smoke E2E do frontend consolidado contra backend real local

Data: 2026-11-11 · Branch: `integration/v6-frontend-launch` · Base validada: `d7df981` · Resultado: `a50dfa3`

Escopo: validar o frontend consolidado contra a API tRPC real (sem mock), em infraestrutura 100 % local e dados
sintéticos. Nada remoto foi acessado: sem Railway, Vercel, Asaas, Resend ou Melhor Envio. Nenhum deploy, nenhum merge.

## Ambiente

| Item | Valor |
| --- | --- |
| Banco | `mysql:9.7.2` descartável, publicado só em `127.0.0.1`, banco `l4ckos_test_smoke` |
| Schema | `audited-schema.json` + `0020…0025` + `stock-v1/v6/0027` + `exclusive-drops-v1/0028` (mesma cadeia do `run-v6-chain-mysql97-test.sh`), aplicada em um banco `railway` interno ao container e transferida por dump |
| Backend | `server/` desta branch, idêntico a `97de823` (`git diff 97de823 HEAD -- server shared database drizzle ops scripts` vazio), `tsx server/_core/index.ts`, `NODE_ENV=development`, `APP_ENV=local-test`, `L4CKOS_LOCAL_DB_EXCEPTION=disposable-loopback` |
| Frontend | servido pelo próprio backend via Vite (mesma origem `http://localhost:3010`) |
| Gate | `PUBLIC_SITE_MODE=store`; `PUBLIC_CHECKOUT_ENABLED`, `STOCK_CHECKOUT_ENABLED`, `STOCK_RUNTIME_ENABLED`, webhook inbound e workers: `false`; sem `RESEND_API_KEY`, `ASAAS_*`, `MELHOR_ENVIO_TOKEN` |
| Contas | `admin@example.invalid` (admin), `cliente@example.invalid` (usuário) |
| Dados | 4 produtos com variantes P/M/G, lote `XIV Bis Sintético` (OPEN, capacidade 10), drop exclusivo; 3 pedidos fixture (pago manual, pendente, cancelado) por SQL local, pois o checkout permanece fechado |
| Navegador | Chromium via `playwright-core`, desktop 1440×900 e mobile 375×812; roteiros e logs ficaram fora do repositório |

## Resultado por fluxo (API real, sem mock)

| # | Fluxo | Telas / chamadas reais | Resultado |
| --- | --- | --- | --- |
| 1 | Login e sessão | `auth.localLogin`, `auth.me`, `cart.list`, `favorites.list`; sessão sobrevive a reload | OK |
| 2 | Acesso admin | `/gestao`: `admin.dashboard`, `ordersList`, `productsList`, `promoBannersList`, `couponsList`, `auditList`, `settingsStatus` | OK |
| 3 | 14 rotas admin | todas carregam com 200, sem erro de página, sem overflow horizontal, desktop e mobile (28 cargas) | OK |
| 4 | Produtos e variantes | `products.list`, `getById`, `sellableVariants`, `reviews`, `homeHighlights` | OK (ordem de tamanhos corrigida) |
| 5 | Drops exclusivos | `exclusiveDrops.forProduct` e painel no PDP | OK |
| 6 | Solicitação/autorização | `requestAccess` → `admin.approve` (UI admin) → código único → `redeemCode` → `cart.add` | OK desktop e mobile |
| 7 | Lotes e capacidades | `productionBatches.list/detail`; Logística mostra capacidade 10, saldo 9 | OK |
| 8 | Carrinho com tamanhos | `cart.add` (estoque, pré-venda e exclusivo), `/carrinho` mostra cor e tamanho, aviso de envio conjunto | OK |
| 9 | Frete | `POST /api/shipping/quote`: CEP do Plano Piloto → entrega local; CEP fora do DF → "indisponível" tratado | OK (sem Melhor Envio) |
| 10 | Logística real | `admin.ordersList` + `productionBatches.*` | OK |
| 11 | Pagos × pendentes × cancelados | Pedidos, Logística e Meus pedidos: 1 pago (demanda M×1), 1 pendente (reserva, fora da demanda), 1 cancelado (fora da demanda) | OK |
| 12 | 401 / 403 / erros | ver abaixo | OK |

Tratamento de erros verificado:

- Anônimo: `admin.*` e `orders.list` → 401 `UNAUTHORIZED`; `/gestao*` redireciona para `/entrar?next=…`; `/meus-pedidos` e `/perfil` mostram estado inline de login.
- Cliente: `admin.dashboard` → 403 `FORBIDDEN`; `/gestao/*` mostra a página 403 e nenhuma chamada `admin.*` retorna 200.
- Sessão expirada (cookies removidos): páginas de conta voltam ao estado de login.
- `cart.add` de produto exclusivo sem autorização → 403 com mensagem; código inválido → 400 com mensagem.
- MySQL derrubado com o admin na tela: a API passa a responder 401 (não resolve o usuário), a UI exibe "Não foi possível carregar os usuários" sem quebrar; após religar o banco a tela se recupera.

## Comparação de contratos tRPC

Extraídos de `appRouter._def.procedures` (91) e de `trpc.*` no cliente (81): 80 de 80 procedimentos realmente usados
existem no backend. `ai.chat` aparece só em comentário de `AIChatBox.tsx` (componente sem uso). Backend sem uso no cliente:
`admin.backupRestore`, `lifecycleEmailSend`, `marketingCampaignSend`, `orderConfirmPayment`, `reportsSalesCsv`,
`userSetRole`, `exclusiveDrops.myRequests`, `orders.create`, `products.promotions`, `system.health`, `system.notifyOwner`.

## Correções de frontend (commit `a50dfa3`)

1. **Ordem de tamanhos no PDP.** `products.sellableVariants` devolve variantes em ordem de hash do `optionKey`
   (G, P, M); a tela repetia essa ordem. `client/src/lib/sizeOrder.ts` ordena (ordem do produto → escala PP…GG → numérico),
   com 4 testes.
2. **Banner de cookies nas rotas admin.** A variante em fluxo (`adminLayout`) valia só para `/gestao` exato; as outras
   13 rotas recebiam o banner fixo, que cobria ações em 375 px (por exemplo "Aprovar" em Drops).
   `App.tsx` passou a usar `isAdminRoute`.

## Divergências que NÃO foram corrigidas (fora do escopo permitido)

1. **Variante aprovada sem preço específico → 500 genérico.** O formulário admin diz "Vazio herda o preço base" e envia
   `price: null`. Com a migration STOCK `0027-V6` aplicada (pré-requisito do `0028` dos drops), o CHECK
   `productVariants_active_identity_check` exige `price > 0` em variante ativa; `admin.productCreate` responde
   `INTERNAL_SERVER_ERROR` sem mensagem útil (variante inativa funciona). Decisão necessária antes da integração final:
   mapear o erro para 4xx no backend, resolver o preço herdado no servidor, ou obrigar preço no formulário.
2. **Allowlist de rotas do SPA no servidor** (`server/_core/static.ts`, `CLIENT_ROUTES`) não cobre `/gestao/*` nem
   `/em-breve`: um deep link serve o SPA com status HTTP 404. Só ocorre quando o Express serve o SPA (dev/mesma origem).
3. **Queda do banco** produz 401 (e não 503) para sessão válida; a UI lida bem, mas o diagnóstico fica ambíguo.
4. **Backup automático diário** falha no host de teste (`BACKUP_FAILED`, sem `mysqldump`); irrelevante para o smoke.

## Notas de operação do ambiente

- O cliente em dev aponta a API para `http://localhost:<porta>`; abrir a página por `127.0.0.1` torna as chamadas
  cross-site e o cookie de sessão é descartado. Usar sempre `localhost`.
- Cada `auth.localLogin` incrementa `sessionVersion` e invalida as demais sessões do mesmo usuário (comportamento
  de segurança correto; relevante para qualquer roteiro de teste).

## Limites desta validação

- O fluxo financeiro (`stockCheckout.create`, Asaas, webhook) **não foi exercitado**: checkout e runtime STOCK ficaram
  fechados de propósito; pedidos foram criados por fixture SQL. Frete de transportadora (`stockCheckout.quoteShipping`,
  Melhor Envio) não foi validado.
- Pré-venda XIV Bis e drop exclusivo foram testados em produtos distintos; a combinação (produto de pré-venda
  dentro de um drop) não foi exercitada.
- A navegação rodou no Vite em modo dev; o bundle de produção foi compilado (`vite build`) mas não navegado.
- Fixtures de pedido, sessões e carrinho foram manipuladas por SQL/roteiro no banco descartável.

## Verificação estática (`a50dfa3`)

- `pnpm check` (cliente + servidor): sem erros.
- `vitest run`: 12 arquivos / 28 testes falhando, idêntico ao baseline de `97de823` (ops/tooling: `database/*`
  offline packaging, `tcpBackupPolicy`, `tunnelDiagnostics`, `managerSyncRoutes`); 1282 passam, incluindo os 4 novos.
- `VITE_DEPLOY_TARGET=production VITE_API_URL=same-origin pnpm build:client`: OK.
