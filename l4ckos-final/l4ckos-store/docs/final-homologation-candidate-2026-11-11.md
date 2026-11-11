# Candidata final de homologação (local, sem deploy)

Branch `integration/v6-frontend-launch`. Nenhuma branch original foi alterada (`codex/staging-homologation-20261111` segue
em `5455124`, `codex/exclusive-quota-lifecycle-fix` em `4d5286f`). Nada remoto foi tocado; sem migrations, Railway, Vercel,
Asaas ou Resend.

## Integração

| Origem | Commit | Resultado |
| --- | --- | --- |
| TLS isolado (staging-homologation) | `5455124` → `743abff` | cherry-pick; conflito só na lista de testes do runner (mantidos os dois). O ajuste de `server/db.ts` do Codex é idêntico ao meu `ccb0180` → sem duplicação |
| Ciclo de vida das cotas | `4d5286f` → `c17c2c9` | cherry-pick limpo (parte de `4dfca44`, já presente) |
| UX do carrinho | `0bc2181` + `059b91b` | já estava na candidata |
| Preço herdado | `f70cfa8` (Codex) + `ccb0180` | uma única aplicação; reenvio de preço vazio em variante existente grava o preço-base atual |

Preservados: loja V6, login/cadastro, painel admin, Logística V1, ordenação de tamanhos, banner de cookies, contratos
STOCK/Drops/pré-venda.

## Verificações

- **MySQL 9.7.2 descartável** (`scripts/run-stock-mysql-tests.sh`): 7 arquivos / 98 testes (STOCK, Drops, cotas, pré-venda dentro de drop, concorrência,
  recusa terminal e nova tentativa, pago, webhook duplicado e fora de ordem, capacidade do lote, preço de variante, checkout de UI simulado).
- **TLS:** `mysqlConnection.test.ts` (22) e `mysqlTls.test.ts` (7): CA confiável + SAN correta aceitas; CA não confiável, SAN divergente,
  host de produção, CA de produção, identidades Railway trocadas/incompletas, pin ausente/malformado rejeitados antes de enviar credenciais.
- **Segurança:** 11 arquivos / 123 testes (auth, CSRF/logout, gate de staging, loja pública, logs, webhook Asaas, TLS).
- **Frontend:** 24 arquivos / 247 testes. **Typecheck** (cliente + servidor) limpo. **Build** cliente (produção, `same-origin`) e servidor OK.
- **Suíte completa:** 12 arquivos / 28 testes falhando, lista idêntica ao baseline herdado (ops/tooling); 1330 passam. Nenhuma falha nova.
- **Navegador real** (backend local + MySQL descartável, desktop/375/320): preço herdado via API, login/cadastro, 14 rotas admin + deep link/reload,
  loja, carrinho, drop + pré-venda, solicitar/aprovar/desbloquear, cota compartilhada no carrinho (limite, excesso, cota alterada, sessão expirada),
  401/403/503.

## Aprovação financeira tardia

- **Seguro:** tentativa com pagamento criado e janela expirada fica retida para reconciliação (`reconciliationRequiredAt`) e um `paid`
  posterior a confirma uma única vez (duplicata ignorada; pedido pago, cota consumida).
- **Recusado, depois "pago":** após falha terminal assinada, um `paid` posterior retorna `conflict` (qualquer valor) e **não** ressuscita estoque,
  capacidade, cota nem pedido; nenhuma cobrança nova é criada.
- **Lacuna (para o Codex):** esse evento fica registrado apenas como linha de deduplicação em `stockWebhookEvents`
  (`eventId`, `payloadHash`, `receivedAt`; sem pedido/pagamento/valor) mais um `securityLog` de aviso no controller. A tentativa continua
  `released` com `reconciliationRequiredAt` nulo e não há marcador em `auditLogs`. Se um cliente de fato pagou uma cobrança que o sistema
  cancelou, **não existe registro durável e consultável que direcione a reconciliação manual**. Coberto por `it.fails("DESIRED: …")` em
  `exclusiveDropsQuota.mysql.test.ts` (fica vermelho quando corrigido). Não bloqueia um deploy privado com checkout fechado; bloqueia a
  homologação comercial do checkout.

## Limites

- O build local (`same-origin`, contas `.invalid`) não é publicável: exige variáveis reais e `STAGING_DB_TLS_*` do ambiente isolado.
- TLS contra a identidade Railway real (`mysql-stock-homologation.railway.internal`) não foi exercitado (só local).
- Asaas/Resend/Melhor Envio reais, checkout de ponta a ponta com pagamento e cancelamento pelo cliente não foram exercitados.
- `cart.add` continua guarda leve; a cota é imposta no checkout (provado em MySQL).
