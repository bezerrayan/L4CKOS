# Integração final frontend + backend (candidata local)

Data: 2026-11-11 · Branch `integration/v6-frontend-launch` · Sem deploy, sem acesso remoto.

## Git

- Base anterior: `5422d4f` (frontend consolidado, backend `97de823`).
- Integrados por `cherry-pick` de `codex/staging-homologation-20261111` (`973d1d0`), sem alterar a branch do Codex:
  `2755cf3` (backup automático na homologação isolada) e `973d1d0` (preço herdado, deep links admin, erros de autenticação).
- Conflitos: nenhum. `AdminProductsPanel.tsx` foi mesclado automaticamente e revisado: troca o parser monetário por
  `@shared/money` e passa a explicar a herança ("grava uma cópia do preço base atual no momento de salvar"); a interface
  visual aprovada, a ordenação de tamanhos e o banner de cookies foram preservados.
- Correção adicional (comunicada): `ccb0180` em `server/db.ts`. `syncProductVariants` calculava `resolvedUpdates` com o
  preço herdado resolvido, mas o laço de gravação ainda usava `plan.update` (preço `null`). Reenviar preço vazio em
  variante ativa já existente gravava `NULL` e violava `productVariants_active_identity_check` (500). Uma linha;
  nenhuma migration nem regra financeira foi alterada. Vale levar de volta à branch do Codex.

## Preço herdado (MySQL 9.7.2 descartável, API real)

| Cenário | Resultado |
| --- | --- |
| Produto base 100,00 + variante ativa vazia | persiste 10000 |
| Variante com preço explícito 150,00 | mantém 15000 |
| Variante inativa vazia | persiste 10000 (copiada) |
| Editar variante sem enviar `price` | sem alteração do preço |
| Base → 200,00 | variantes existentes continuam 10000 / 15000 (não reprecificam) |
| Reenviar vazio depois da mudança | grava 20000 (base atual) — após `ccb0180` |
| Variante nova vazia depois da mudança | 20000 |
| Base 0, negativa, fracionária, > int32; variante negativa, > int32, 0 ativa; update base 0 | 400 com mensagem, nenhum produto criado |
| INSERT direto de variante ativa com `price NULL` | rejeitado pelo CHECK; constraint presente no `information_schema` |

## Interface real (sem mock)

Ambiente: MySQL 9.7.2 em loopback, schema auditado + 0020..0025 + stock 0027-V6 + drops 0028, backend local servindo o
Vite em `http://localhost:3010`, dados sintéticos `@example.invalid`, checkout/Asaas/Resend/Melhor Envio fechados.

| Área | Resultado |
| --- | --- |
| Deep link + reload das 14 rotas `/gestao*` | documento HTTP 200 nas 14; rota desconhecida segue 404; reload mantém rota e sessão (desktop e mobile) |
| 14 rotas admin | 28 cargas (1440 e 375 px) com API 200, sem erro de página, sem overflow, sem erro de console |
| Login/cadastro/sessão | OK; sessão sobrevive a reload |
| Produtos/variantes, tamanhos | OK; tamanhos P, M, G |
| Carrinho (estoque, pré-venda, exclusivo) | OK desktop e mobile |
| Frete `/api/shipping/quote` | local (Plano Piloto) e fora do DF tratado |
| Logística V1 | 1 pago (M×1), 1 pendente, 1 cancelado fora da demanda; capacidade 10, saldo 9 |
| Drop exclusivo | solicitar → aprovar na UI admin → código único → desbloquear → `cart.add` OK desktop e mobile |
| **Pré-venda dentro de drop** | produto XIV Bis (lote OPEN) incluído no drop: PDP mostra lote e drop; `cart.add` 403 antes da aprovação, 200 após desbloqueio, em desktop e mobile |
| 401/403 | anônimo: 401 e redirecionamento/estado de login; cliente: 403 e página de acesso restrito sem chamadas admin |
| 503 | MySQL parado com admin na tela: API responde 503 (não mais 401), UI mostra erro sem quebrar e se recupera ao religar |

## Qualidade

- `pnpm check`: sem erros. `vite build` (produção, `same-origin`) e `build:server`: OK.
- `vitest run`: 12 arquivos / 28 testes falhando, **lista idêntica ao baseline herdado** (ops/tooling: `database/*` packaging,
  `tcpBackupPolicy`, `tunnelDiagnostics`, `managerSyncRoutes`, observer/order13, preorderEmail, manufacturingSchedule);
  1302 passam (+20). Nenhuma falha nova.

## Limites

- O build local (`same-origin`, contas `.invalid`) **não é publicável**: o deploy exige variáveis reais de ambiente.
- Cota do drop: `cart.add` é guarda não financeira (um segundo `cart.add` do mesmo item passou); a imposição dura é no
  checkout, que ficou fechado. Precisa ser confirmada na homologação de checkout.
- Fluxo financeiro (Asaas, webhook, `stockCheckout.*`) e frete de transportadora não foram exercitados.
- Navegação feita no Vite em modo dev; o bundle de produção foi compilado, não navegado.
- `BACKUP_FAILED` do backup diário aparece no ambiente local (sem `mysqldump`); a correção `2755cf3` cobre só a homologação isolada.
- O smoke anterior está em `docs/frontend-real-api-smoke-2026-11-11.md`; as divergências 1 a 3 dele estão resolvidas
  (preço herdado, deep links, 503).
