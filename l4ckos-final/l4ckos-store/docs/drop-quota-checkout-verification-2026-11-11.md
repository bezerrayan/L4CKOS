# Verificação de cota de drops no checkout transacional

Data: 2026-11-11 · Branch `integration/v6-frontend-launch` · Base `5dfaaee`

Escopo: MySQL 9.7.2 descartável em loopback + adaptador de pagamento simulado (`https://sandbox.invalid`). Sem Asaas
(real ou sandbox), sem e-mail, sem regra financeira alterada. Executado por `scripts/run-stock-mysql-tests.sh`
(6 arquivos, 93 testes). Novo: `server/exclusive/exclusiveDropsQuota.mysql.test.ts`.

## Conclusão

`cart.add` é só uma guarda leve e não financeira (`checkoutGuard.ts`: "checkout enforcement is the hard gate"). A cota é
imposta de forma atômica em `stockCheckout.create`; nenhuma tentativa inválida gera pedido, tentativa, cobrança, reserva,
consumo de cota ou de capacidade.

| # | Cenário | Resultado |
| --- | --- | --- |
| 1 | cota 1, 2 unidades (uma linha ou duas linhas) | `EXCLUSIVE_QUOTA_EXCEEDED`; 0 pedidos, 0 tentativas, 0 uso, 0 reserva, 0 chamadas ao provedor, estoque intacto |
| 2 | cota 1, 1 unidade | aceita, 1 cobrança simulada, consumida ao pagar (`unitsConsumed 1`, restante 0) |
| 3 | sem pedido de acesso / pendente / rejeitada | `EXCLUSIVE_ACCESS_REQUIRED`; sem rastro |
| 4 | pedidos separados (outro tamanho, outro `attemptId`, depois de pago) | 2º e 3º recusados; 1 pedido, 1 cobrança |
| 5 | 8 tentativas concorrentes, cota 2 | exatamente 2 aceitas; 2 pedidos/tentativas/usos/reservas/cobranças |
| 5b | 2 clientes concorrentes, cota 1 cada | cada um consome só a sua cota |
| 6 | pré-venda dentro do drop (lote 70, capacidade 3) | cota e capacidade impostas juntas; recusa por cota não consome lote; recusa por lote cheio (`STOCK_UNAVAILABLE`) não consome cota; nenhum estoque fictício de variante |
| 7 | pagamento falho, pago, expiração | pago mantém cota e capacidade; falha libera capacidade uma única vez (reentrega ignorada); expiração de tentativa não iniciada libera cota e lote; tentativa com pagamento criado fica retida até reconciliação |

Cobertura anterior preservada: `exclusiveDrops.mysql.test.ts` (corrida de abas, rollback conjunto, reemissão, revogação,
sweeper) segue verde.

## Lacuna de backend (para o Codex)

**Pagamento recusado/cancelado pelo provedor não libera a cota do drop**, embora libere estoque e capacidade do lote.
A tentativa fica `released` com `providerState='created'`, e `COUNTED_UNITS_SQL` (`server/exclusive/store.ts`) só libera
estados `not_started`/`definitive_failure`. Reprodução: cota 1, `stockCheckout.create`, webhook `failed` para esse pedido,
nova tentativa com outra variante → `EXCLUSIVE_QUOTA_EXCEEDED`; a visão do cliente mostra `unitsReserved 1`, restante 0.
Vale para produto de estoque e de pré-venda. É conservador (não há venda a mais), mas queima a única unidade de quem teve
o pagamento recusado. Decisão de política: tratar webhook terminal como `definitive_failure` ou liberar quando a tentativa
terminal tem confirmação assinada do provedor. O teste `it.fails("DESIRED: …")` fica vermelho quando for corrigido.
Classificação: **não é violação de cota nem de capacidade**; é retenção excessiva, a decidir antes da homologação comercial.

## Interface

- PDP: "Acesso liberado: você pode comprar até 1 unidade…" com Autorizadas/Em pedidos abertos/Compradas/Disponíveis; o "+"
  de quantidade fica desabilitado no limite (desktop e mobile).
- Checkout: `EXCLUSIVE_QUOTA_EXCEEDED` vira "Você atingiu o limite de unidades da sua autorização. Reduza a quantidade ou
  remova itens do drop." (`stockAttemptView.ts`).
- **Lacuna de UX (frontend, não corrigida nesta rodada):** o carrinho não avisa o limite. O "+" do item exclusivo continua
  ativo e a cota é compartilhada pelos produtos do drop: com cota 1, a sacola aceitou 2 itens (um de cada produto do drop) e
  o resumo do checkout mostrou 2 unidades antes de qualquer recusa. A recusa só vem ao criar o pedido, sem cobrança.

## Não coberto

Pagamento real/sandbox, e-mail, UI de checkout com checkout habilitado de ponta a ponta (os testes de UI usam o servidor
local simulado), cancelamento pelo cliente (só webhook/expiração).
