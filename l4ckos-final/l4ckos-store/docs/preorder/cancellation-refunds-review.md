# Fechamento funcional 02/04 — cancelamentos, reembolsos e exceções

Data: 09/10/2026. **APTO COM RESSALVAS** para homologação das proteções locais implementadas; não significa módulo completo de gestão financeira/reembolsos. Nada publicado. Nenhum estorno automático ou operação financeira externa foi autorizado/implementado.

## 1. Origem, preservação e isolamento

- Branch `feat/preorder-batch`; HEAD principal inicial/final `f519c11e94e57f76522db11f04254c5c17874598`, parent `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`.
- Worktree iniciou sujo: 29 rastreados modificados e dez novos, incluindo fabricação/frete. Tudo preservado; sem commit, push, deploy ou mudança de branch.
- Node 22.23.2; pnpm e dependências existentes. Nenhuma dependência adicionada.
- MySQL 8.4.11 exclusivamente local, socket `/tmp/l4ckos-final-fixes-mysql/mysqld.sock`. Fixtures criam schemas sintéticos; restore usa Docker MySQL independente local. `DATABASE_URL` vazio no comando, definido somente para fixtures localhost quando exigido pela ORM.
- Navegador Chromium com APIs mockadas e bloqueio de hosts externos; Asaas, Resend e transporte mockados. Nenhum acesso a Railway, Vercel, produção, banco remoto, pedido real #12, cobrança ou etiqueta real. IDs 12 nos logs de segurança são mocks, não dados remotos.
- Aplicadas skills de isolamento, segurança, e-mail e homologação. A revisão React manteve estilos, hooks e componentes; somente avisos funcionais. Não foram alterados templates/outbox nesta etapa.

## 2. Comportamento existente e decisões preservadas

| Cenário | Comportamento auditado / tratamento final |
| --- | --- |
| Cancelamento administrativo | `admin.orderUpdate`, autenticação/adminProcedure e confirmação nativa na interface. Agora possui liberação/auditoria transacionais e aviso de que não executa estorno |
| Pedido pendente | Mantém reservas PREORDER até cancelamento explícito. Vencimento financeiro não muda status para cancelado |
| STOCK pendente | Reserva preexistente de 20 minutos; disponibilidade deixa de considerá-la após esse prazo. Confirmação tardia não pode mais aprovar silenciosamente sem estoque reservado: exige conciliação |
| Pedido pago | Cancelamento preserva evidência de pagamento e snapshots; estoque consumido não é automaticamente reposto. Não significa dinheiro devolvido |
| Fabricação, recebimento, envio e entrega | Cancelamento manual existente é mantido; não desfaz produção, frete ou entrega. Necessária decisão operacional sobre peças já produzidas/devolvidas |
| Cancelamento pelo cliente | Não há endpoint de cancelamento/reembolso pelo cliente no router de pedidos; não foi inventado fluxo novo |
| Cancelamento de cobrança / solicitação de estorno | Não há operação de cancelamento/refund no serviço Asaas auditado; seletor de status não chama provedor |
| Reembolso em processamento, confirmado, negado ou parcial | Eventos distintos são registrados para conciliação, sem virar status do pedido e sem afirmar conclusão ao cliente por inferência |
| Lote abaixo do mínimo | Mínimo é informativo na demanda. Encerramento não cancela pedidos nem reembolsa; produção pode ser decidida pelo administrador. Não foi criada regra automática |
| Cancelamento de lote | Exige `acknowledgePaidOrders`; preserva pedidos/evidências financeiras, bloqueia novas vendas. Não cancela cada pedido nem devolve dinheiro |
| Falha/resultado incerto no checkout transacional | Pedido/reservas persistem e retry exige `CHECKOUT_RECOVERY_REQUIRED`; não cria outra cobrança automaticamente |

Capacidade PREORDER continua calculada por itens de pedidos não cancelados, pagos ou pendentes, sem duplicar pagos. Cancelar um pedido inteiro libera sua capacidade pela regra existente; cancelar o lote não equivale a cancelar pedidos. Essa regra não é prova financeira nem reposição física. Cancelamento parcial por item e distribuição de estorno por peças não estão implementados.

## 3. Falhas comprovadas e correções

| Classificação | Falha / impacto | Correção e evidência |
| --- | --- | --- |
| CONFIRMED, alta | Cancelamento não liberava reservas STOCK ativas, bloqueando disponibilidade indevidamente | Libera apenas `active` para `released`, sob lock do pedido, junto da mudança de status e auditoria. MySQL: pendente MIXED, duplicidade e corrida |
| CONFIRMED, alta | `markOrderPaid` podia confirmar/debitar após cancelamento ocorrido entre leitura do webhook e transação | Revalida cancelamento dentro do lock, não confirma nem baixa estoque e registra conciliação. Corrida real MySQL e webhook tardio mockado |
| CONFIRMED, alta | Confirmação após expiração STOCK marcava pago sem consumir reserva vencida | Verifica reservas sob lock antes de confirmar; reserva indisponível gera conciliação, sem aprovação falsa. PREORDER sem reserva STOCK continua normal |
| CONFIRMED, média | STOCK cancelado podia ser reativado, apesar de reservas liberadas | Impede reativação de qualquer pedido cancelado; antes a proteção existia somente para PREORDER |
| CONFIRMED, média | Replay de tentativa cancelada devolvia URL antiga de pagamento | `CHECKOUT_ORDER_CANCELLED` antes de devolver cobrança; mantém idempotência e histórico, sem novo provider IO |
| CONFIRMED, alta | Endpoint legado podia gerar cobrança novamente/concorrente sem evidência persistente de tentativa | Guard de estado + claim durável auditado sob lock; somente um claim vence, resultado incerto bloqueia retry cego. Pedidos do checkout transacional não podem usar esse endpoint para criar segunda cobrança |
| CONFIRMED, média | Reembolsos/vencimento eram ignorados sem registro operacional de exceção; exclusão podia produzir e-mail de falha incentivando nova compra | Registra evento para conciliação via ledger idempotente + auditoria; remoção não envia e-mail de falha nem libera reservas. Falhas posteriores a estados pagos/finais não incentivam recompra |
| HARDENING | Guard de pagamento do admin estava fora da transação; auditoria de cancelamento somente após update | Guard final transacional e evento `order.cancelled` na mesma transação; ator administrativo registrado |

Não houve reescrita de checkout, capacidade, confirmação normal Asaas ou transições dos lotes. O caminho normal de pagamento continua coberto por regressões. No admin, tentativa manual bloqueada por cancelamento/reserva indisponível responde CONFLICT com orientação de conciliação, não sucesso enganoso.

## 4. Semântica dos eventos e limites financeiros

Consultada a [documentação oficial de eventos de cobranças Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas). Vencimento, remoção, processamento de estorno, estorno e estorno parcial são eventos diferentes; `PAYMENT_REFUND_DENIED` é descrito para boletos. A configuração remota de eventos habilitados **não foi consultada**. Não se presume que os novos eventos serão enviados pelo Sandbox atual.

- Confirmados/recebidos: conjuntos já utilizados foram preservados. Autenticação do webhook, BRL, compatibilidade de status e verificação de valor pago continuam existentes. Não foram renomeados eventos legados por suposição.
- `PAYMENT_OVERDUE`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_REFUNDED`, `PAYMENT_REFUND_DENIED`, `PAYMENT_PARTIALLY_REFUNDED`: nova observação auditada, sem mutação financeira/reservas. `PAYMENT_DELETED` coerente e pagamento recebido em pedido já cancelado também seguem conciliação. Exclusão com status incompatível mantém o comportamento homologado de ignorar com log.
- `payment.reconciliation_required` armazena tipo/ID do evento, IDs correlacionáveis, status observado do pedido e flags explícitas `providerObservationOnly`/`financialMutation:false`/`reservationMutation:false`. Não armazena payload bruto na auditoria. Se checkout recebido divergir do checkout conhecido, não aceita silenciosamente a associação.
- Ledger `asaasWebhookEvents` mantém ID único, hash do payload e processamento; duplicidade não repete handler. Eventos distintos fora de ordem permanecem observações independentes: não reduzem um estado financeiro confirmado para negado/pendente e não alteram o pedido.
- **Isso não é um ledger de saldo/reembolsos.** Sem correlação financeira completa, valores e conciliação com o provedor, nenhum evento vira autorização para reembolsar, restaurar estoque, cancelar pedidos ou declarar quitação financeira. Estorno parcial não é atribuído automaticamente a um item/quantidade. Solicitação local, erro de solicitação, valor devolvido acumulado e encerramento da conciliação ainda não possuem workflow próprio.
- Em falha de persistência, não existe aprovação falsa. O ledger existente marca tentativa falha e impede replay automático do mesmo ID; recovery de eventos falhos continua exigindo conciliação operacional, sem reset cego. Essa limitação é uma ressalva, não uma prova de processamento bem-sucedido.

## 5. Segurança e rastreabilidade

Locks do pedido serializam confirmação/cancelamento e claim legado. Guards finais não dependem do estado enviado pelo frontend. `order.cancelled` é reservado somente na primeira transição e preserva pagamento anterior, origem administrativa e `refundExecuted:false`; reentrada não libera duas vezes e não repõe estoque consumido. Snapshots de preço, fabricação, postagem e quantidade não são reescritos.

Claim `checkout.external_creation_requested` persiste antes de IO externo; concorrência e ambiguidade exigem revisão manual. Não é removido para permitir retries automáticos. Endpoint legado mantém ownership e validações existentes. Identificadores do provedor não substituem autenticação.

A interface mantém confirmação nativa administrativa, agora explícita sobre cobrança/reembolso/peças produzidas. Cliente com pedido cancelado e administrador recebem aviso de que cancelamento não comprova devolução financeira. **Não há tela nova de gestão de estornos ou notificações automáticas de exceção.** Revisão operacional usa auditoria existente (`admin.auditList`), não um painel financeiro com saldo definitivo.

E-mails: confirmações normais permanecem; não se envia aprovação quando a transação bloqueia pagamento. Remoção de cobrança não envia instrução de tentar pagar novamente. Não foram criados e-mails de cancelamento/estorno: dependem de política, recipient, template e idempotência próprios. Outbox e Resend não foram modificados ou chamados realmente.

## 6. Testes e gates

Execução final **41 arquivos / 443 testes aprovados, zero falhos e zero ignorados**, sem exclusões, em cópia exata local com origem Git limpa. Resultados intermediários não substituem essa evidência.

| Gate | Resultado |
| --- | --- |
| `preorder.mysql.test.ts` | 62 PASS: STOCK/MIXED pendente/pago, duplicidade, corrida, fabricação/recebimento/conclusão, reservas expiradas, evidência financeira, claims concorrentes e bloqueio de segunda cobrança |
| `checkout.mysql.test.ts` | 22 PASS: atomicidade STOCK, snapshots, idempotência, falha de provider e recovery |
| `security-hardening.test.ts` | 31 PASS: auth/admin/ownership, assinatura/valor/moeda, replay, seis eventos de exceção e pagamento tardio cancelado sem e-mail de aprovação |
| `preorderUi.test.ts` | 17 PASS Chromium: inclui aviso financeiro em detalhe de pedido cancelado e todos os fluxos anteriores |
| Fabricação/frete, e-mail/outbox, schema, backup/restore e demais regressões | Incluídos no total final, não contados novamente |
| Dois arquivos de transporte/empacotamento offline | 18 PASS, incluindo ambos os probes antes condicionados à origem limpa |
| `pnpm check` | PASS cliente/servidor |
| `pnpm build` | PASS Vite/esbuild |
| `git diff --check` | PASS, saída vazia |

Comando final na cópia `/tmp/l4ckos-manufacturing-release-YApX6G`:

```bash
env DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store \
  PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
  L4CKOS_MYSQL_TEST=1 \
  L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock \
  pnpm exec vitest run
```

619 arquivos de código/documentação preexistente conferidos por hash, incluindo novos arquivos; sem configurações locais secretas. Árvore `7a8d77e3fa2e84b2e66f054ac878925c257f2c3a`, referência sintética `5fc85bb54d051724c457119483c123c661e4ff4f`. Plumbing somente em /tmp; não executado `git commit`, nem modificado índice/HEAD principal. Este relatório foi escrito após os testes; não muda runtime.

Não executados: integração remota real, estorno Sandbox/real, alteração de webhook habilitado, entrega de e-mail em caixa postal, ensaio de chargeback e benchmark de carga. Não considerados aprovados. Parcial é testado como observação segura, **não** como execução/alocação de reembolso parcial. Falha de provider no checkout e recovery são mockados; não se declara exercício financeiro externo.

## 7. Arquivos e banco

Alterados nesta etapa:

- `server/db.ts`: guards, cancelamento/reservas/auditoria transacionais, observações e claim legado.
- `server/controllers/paymentController.ts`: tratamento de observações, guard/claim de cobrança e supressão de mensagens indevidas.
- `server/database/checkout.ts`: replay de pedido cancelado bloqueado.
- `server/routers/admin.ts`: ator da auditoria e conflito em confirmação não aplicada.
- `client/src/pages/Admin.tsx`, `client/src/components/admin/orders/AdminOrdersUI.tsx`, `client/src/pages/PedidoDetalhe.tsx`: avisos funcionais sem redesign.
- `server/database/preorder.mysql.test.ts`, `server/database/preorderUi.test.ts`, `server/security-hardening.test.ts`: regressões.
- Novos: `shared/paymentExceptions.ts` e este relatório.

Diff **acumulado** contra HEAD, incluindo todo o bloco 01/04 preservado: 32 arquivos rastreados, 728 inserções/179 remoções; 12 arquivos novos incluindo este relatório. Não confundir com o incremento desta etapa. Não houve formatação global.

**Nenhuma migration nova nesta etapa.** Utilizam-se reservas e auditoria existentes. A migration 0022 e artefatos v3 foram preservados; checksum 0022 continua `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`. Esta entrega completa continua exigindo aplicação futura autorizada da 0022 antes do backend de fabricação. Nenhuma migration remota executada.

## 8. Políticas pendentes e riscos remanescentes

1. Cancelamento pago: definir solicitação, aprovação e conferência financeira, inclusive fornecedor, fabricação iniciada, peças recebidas/enviadas/entregues. Alternativas: bloquear até análise ou separar solicitação de cancelamento de cancelamento operacional efetivo. Não se adotou regra comercial nova por suposição.
2. Capacidade após cancelamento pago: regra vigente libera capacidade do pedido inteiro; confirmar se deverá permanecer comprometida até resolução do fornecedor. Estoque consumido continua sem reposição automática. Restock exige devolução/inspeção e política explícitas.
3. Mínimo não atingido/fornecedor indisponível: decidir prorrogar prazo com comunicação, fabricar excepcionalmente ou cancelar operacionalmente e tratar cada reembolso por conciliação. Nenhuma alternativa é automática.
4. Pendente PREORDER: definir prazo/condição segura de expiração e cancelamento da cobrança, incluindo confirmação tardia/resultado incerto. Atualmente mantém capacidade; simples vencimento não libera reservas.
5. Reembolso total/parcial: definir responsáveis, valor de frete/descontos, alocação por item, evidência do provedor e estados solicitados/processamento/recusado/concluído. A loja ainda não executa ou administra esse workflow. Não afirmar que um pedido cancelado está reembolsado.
6. Comunicação: decidir quais eventos exigem notificação e aprovar conteúdo/idempotência. Hoje exceções ficam na auditoria; não existe alerta proativo ou encerramento formal de conciliação na aplicação.
7. Recovery: eventos persistidos como falhos e cobranças com resultado incerto precisam de procedimento auditado para confirmar resultado antes de qualquer repetição. Não habilitar reset/retry automático nem apagar evidências.
8. Correlacionar e habilitar eventos de estorno no Sandbox futuro com autorização; presença na documentação não prova ativação, valor ou resultado remoto. Outros eventos, como chargeback/restauração, continuam fora do tratamento específico, sem automações.

## 9. Impacto, homologação e veredito

Backend e frontend precisam ser publicados futuramente, após revisão/autorização. Schema desta etapa não muda; respeitar schema v3 → backend → frontend do bloco 01/04. Backend primeiro mantém guards finais mesmo com frontend anterior. Rollback de código mantém auditorias/claims/snapshots; não remover colunas, liberar estoque, repetir pagamentos/e-mails ou descartar evidências para desbloquear tentativas. Backend antigo reintroduz os riscos corrigidos: suspender operações sensíveis se rollback necessário.

Homologação futura deve usar fixtures controladas, validar cancelamento pendente/pago, dupla ação e corrida, estoque/reservas, capacidade, auditoria, produção abaixo do mínimo e pagamento tardio. Webhooks de estorno podem primeiro ser testados com mocks; qualquer operação Sandbox externa exige autorização nova e nunca usa o pedido #12. Não confundir a homologação dessas proteções com aprovação de políticas ou execução de reembolso.

**APTO COM RESSALVAS**: proteções implementadas e gates locais aprovados, preparados para homologação no staging. Permanecem workflow/políticas de conciliação, devolução financeira parcial/total e comunicação proativa. Não declarar o módulo financeiro integralmente concluído nem publicar sem revisão e autorização.

## Atualização operacional — aprovação dos fundadores (09/10/2026)

As políticas financeiras da V1 foram aprovadas conforme comunicação do usuário: reembolsos manuais supervisionados, conciliação obrigatória com Asaas, parciais manuais, tratamento individual dos lotes abaixo do mínimo, responsabilidade inicial dos dois fundadores, auditoria das aprovações e ações e respeito aos prazos legais, direitos do consumidor e política de cancelamento aplicável. O [runbook aprovado](refund-reconciliation-runbook.md) é a referência operacional atual. Menções anteriores neste relatório a aprovação financeira pendente descrevem o estado histórico e ficam superadas somente quanto a essas regras e à responsabilidade inicial.

Essa decisão não implementa um módulo de reembolsos, dupla aprovação em tela, saldo conciliado, notificações ou recovery automático. Homologação operacional, identificação nominal das funções/canal e evidências do Asaas continuam pendentes. A [RC atual](staging-release-candidate.md) registra o veredito por etapa. Nenhuma operação financeira, alteração de pedido ou ação remota foi executada nesta formalização.
