# PREORDER / PRODUCTION BATCH IMPLEMENTATION REPORT

Starting HEAD: `83ee0d835e9bacadc12ac3d08603ce7600135b97`

Implementação local na branch `feat/preorder-batch`, worktree `/tmp/l4ckos-preorder-83ee0d8/l4ckos-final/l4ckos-store`. HEAD inicial e working tree vazia foram confirmados antes de editar. O workspace original foi preservado.

## Architecture

Products: `salesMode` explícito, default STOCK; metadados públicos do lote vêm do servidor.
Variants: identidade, preço, SKU/opções e vínculo com produto continuam validados pelo checkout certificado.
Stock: disponibilidade física continua exclusiva de STOCK; PREORDER aceita estoque físico zero.
Reservations: somente STOCK cria `stockReservations`, preservando FK, quantidade, consumo e rollback.
Checkout: extensão pontual da transação existente, preços em centavos e provider após commit.
OrderItems: ambos os modos geram itens; novos snapshots guardam modo, lote e estimativa sem alterar os snapshots anteriores.
Admin: `adminProcedure` existente, seção Lotes / Pré-venda, mutations auditadas na mesma transação. Alertas de estoque físico excluem PREORDER.

Mapa auditado antes da implementação: [architecture.md](architecture.md).

## Business decisions

Payment: pagamento integral de 100% no checkout. Nenhum sinal, saldo, segunda cobrança ou estado parcial.
Sales modes: STOCK / PREORDER; cliente não decide modo nem lote confiável.
Confirmed demand rule: confirmação contratual com evidência confiável e pedido paid/processing/shipped/delivered; definição SQL abaixo.
Mixed cart shipping: um frete, um pedido e envio conjunto quando todos os itens disponíveis; sem split automático.
Minimum: indicador operacional, sem cancelamento/refund automático.
Maximum: opcional; conta itens de todos os pedidos não cancelados, inclusive pendentes/recovery, sob lock do lote. Sem hold redundante ou expiração automática.
Cancellation: confirmação explícita, warning de pedidos pagos, nenhuma integração de refund automático.

Pedidos abandonados exigem conciliação da cobrança e cancelamento administrativo. O adapter atual não invalida uma cobrança ainda pagável de forma atômica; expirar claims automaticamente permitiria oversell por pagamentos atrasados. Antes de enviar o resumo à fábrica, conciliar pendências/recovery. A demanda continua derivada dos pagamentos válidos atuais, inclusive confirmações legítimas tardias. Procedimentos operacionais detalhados em [verification.md](verification.md).

## Database

Migration: `database/migrations/0021_preorder_production_batches.sql`, forward-only, aplicada somente em bancos locais de teste/preview. 0000–0020 intactas.
Tables: `productionBatches`, `productionBatchProducts`.
Columns: produto `salesMode`; item `salesModeAtPurchase`, `productionBatchId`, `productionBatchNameAtPurchase`, `estimatedShippingStartAtPurchase`, `estimatedShippingEndAtPurchase`; lote com janela, estimativas, marcos operacionais, mínimo/máximo e timestamps.
Enums: STOCK/PREORDER e os oito estados de lote.
Indexes: status do lote; associação única por produto; índice batch/products; índice item batch/order.
FKs: associação→produto/lote; item→lote; RESTRICT. FK certificada reservation→orderItem preservada.
Defaults: produtos/itens históricos STOCK; lote DRAFT; mínimo 0; máximo/datas opcionais NULL.
Historical impact: nenhum pedido histórico vira PREORDER; nomes, preços, SKU, tamanho/cor/imagem existentes preservados. Renomear produto/lote não muda snapshots.
Pre fingerprint: `f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d`
Post fingerprint: `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a`
Migration SHA256: `46e7b40f6320659791ba90d3ebaf4c4cc031e84de36f5bdf8789ab1993d0233d`

## Batch model

Statuses: DRAFT → OPEN → CLOSED → IN_PRODUCTION → RECEIVED → SHIPPING → COMPLETED. CANCELLED permitido nos estados não finais, mediante acknowledgment. COMPLETED/CANCELLED não reabrem. Transições fora desse grafo rejeitadas.
Product relationship: relação normalizada, múltiplos produtos por lote e uma associação atual por produto para seleção inequívoca. Histórico retém FK/snapshot mesmo após reassociação.
Window: OPEN + abertura atingida, se definida + fechamento ainda futuro, se definido. UTC.
Minimum: informativo, mostra confirmadas/faltam.
Maximum: nullable; redução abaixo dos claims rejeitada. Lock serializa check/inserção entre produtos do mesmo lote.

## Checkout

STOCK: fluxo certificado preservado; preços server-side, centavos, quantidade, opções/variant, transação, itens/reservations, rollback.
PREORDER: associação/lote/estado/janela/capacidade validados no servidor, mesmo após cotação; itens com contexto histórico; nenhuma reservation física.
Mixed: itens dos dois modos na mesma ordem, cálculo de subtotal/desconto/frete preservado.
Transactions: commit local antes da rede externa; falha local desfaz itens, reservas, cupom e capacidade.
Reservations: apenas STOCK; PREORDER usa claims derivados de itens/pedido.
Idempotency: `checkoutAttemptId`, fingerprint, lock/replay existentes; retry não duplica pedido/itens/capacidade. Outcome incerto do provider mantém claim e bloqueia nova cobrança.
Asaas boundary: contrato existente preservado. Todos os testes/fixtures usam mocks/adapters locais; nenhuma chamada Asaas real.

## Demand

Paid: `paymentStatus='confirmed' AND paymentConfirmedAt IS NOT NULL AND ((paymentConfirmationSource='manual' AND paymentConfirmedBy>0) OR (paymentConfirmationSource='asaas_webhook' AND LENGTH(TRIM(paymentConfirmationReference))>0)) AND status IN ('paid','processing','shipped','delivered')`, aplicado somente a itens PREORDER do lote.
Unpaid: separado do confirmado; nunca entra na ordem de produção.
Cancelled: pedido cancelado excluído. Cancelar lote mantém evidência paga visível para resolução operacional, sem continuar produção/refund automático. Pedido PREORDER cancelado não pode ser reativado.
Grouping: produto/variante/tamanho/cor com snapshots; COUNT DISTINCT pedidos; SUM peças/centavos sem duplicação. Valor confirmado = valor bruto dos itens, antes de desconto/frete, explicitamente rotulado.
Concurrency: oito checkouts independentes em MySQL 8.4.11, dois produtos, máximo 5: exatamente cinco claims aceitos. Pagamento não conta claim novamente.

## Admin

List: lotes/status/janela.
Create: nome/janelas/estimativas/mínimo/máximo.
Edit: valida datas, limites e estados finais; respeita capacidade já comprometida.
Transitions: abrir/encerrar/iniciar produção/receber/iniciar envios/completar/cancelar; inválidas rejeitadas.
Production summary: confirmado por produto/variante/tamanho/cor, total por produto/lote, pedidos pagos, peças, valor bruto, progresso do mínimo e pendências separadas.
Audit: create/edit/associate/transition auditados atomicamente; guard admin existente, sem bypass.

## Customer UX

Product: card/detalhe indicam PRÉ-VENDA, drop, encerramento, previsão e pagamento integral; não mostram estoque físico para PREORDER. STOCK mantém fluxo anterior.
Cart: contexto do drop/estimativa e aviso de prazos diferentes/envio conjunto.
Checkout: aviso de pré-venda, 100%, calendário e envio misto visíveis antes de pagar, inclusive no mobile com resumo recolhido.
Order tracking: histórico do drop/estimativa e produção derivada do lote; envio/rastreio normal mantém precedência. Pedido pode continuar PAID sem inflar enum de pedido. Shipped/delivered rejeitados até todos os lotes recebidos.
Emails: confirmação existente identifica pré-venda/drop/previsão e pagamento integral; render local testa escaping e itens além do limite visual legado. Nenhum envio real.

Capturas/revisão desktop/mobile: [visual/README.md](visual/README.md). Preview disponível em `http://127.0.0.1:3413`; credenciais exclusivamente sintéticas em [verification.md](verification.md).

## Backup/governance

Bootstrap: v1 imutável + runner oficial 0021; bootstrap operacional fresh v2. SQL v2 inspecionado e comparado independentemente.
Contract: `contract-v1` permanece identidade de baseline; `contract-v2` descreve POST. Nenhum novo baseline histórico.
Backup: manifest v2 inclui ambas as tabelas antes dos itens dependentes; novos campos seguem serialização genérica; artefatos legados v1 continuam aceitos.
Restore: roundtrip real MySQL 8.4.11 preserva 28 tabelas, batches/associações/snapshots/pagamento/audit/reservations, com checksums iguais.
Fingerprint: calculado com metadata real, não falsificado; checksums/bootstrap/drift/ledger cobertos. Ledger remoto intacto. Executor legado de staging permanece restrito à 0020 mesmo com a nova migration no manifest.

## Security

Confirmed: servidor decide modo/lote/preço/demanda; strict input rejeita campos forjados; valida associação, variant, quantidade e janela; maximum serializado; autorização admin e ownership de pedidos preservadas; snapshots imutáveis pelos requests; confirmação exige evidência do contrato.
Likely: não há achado de vulnerabilidade confirmado nesta revisão local. Capacidade conservadora pode ficar ocupada por cobranças abandonadas; demanda dinâmica exige conciliação antes da produção.
Hardening: cancelamento exige acknowledgment; impede reativação de pedido PREORDER cancelado; impede envio antes do recebimento; audit na transação; resultado incerto externo não gera cobrança repetida.
Not reproduced: oversell, IDOR/owner bypass, mutations de lote por não admin, modo/batch/preço client-side, janela fechada e duplicação por retry nos cenários locais testados. Nenhum pentest remoto executado.

## Tests

STOCK: PASS.
PREORDER: PASS.
Mixed: PASS.
Concurrency: PASS, MySQL real.
Admin: PASS.
Security: PASS, regressões locais.
Backup/restore: PASS, MySQL real, checksums/compatibilidade/failure recovery.
Migration: PASS, incremental/fresh/drift/checksum/replay/histórico.

Suíte completa: **31 arquivos; 304 testes PASS; 1 SKIPPED**. Skip somente do transporte SSH real de staging, não autorizado nesta execução. Mapeamento dos 56 casos e comandos em [verification.md](verification.md).

## Gates

Check: PASS, TypeScript client/backend.
Tests: PASS, resultados acima.
Build: PASS, frontend/backend, Node 22.23.2.
Docker: PASS, imagens locais, frontend com API same-origin, Node 22.23.2.
Startup: PASS, backend e nginx; comunicação em rede Docker internal, MySQL por socket local.
Health: PASS, backend e proxy nginx HTTP 200.
git diff --check: PASS.

## Commits

Implementation SHA: `fb3be9d125e4944b8212b41df0014142f842f879` — `feat: add preorder production batches`.
Parent: `83ee0d835e9bacadc12ac3d08603ce7600135b97`.
Files: 98 arquivos no commit de implementação, incluindo schema/28 bootstrap SQL, backend, frontend, testes, documentação e 16 capturas. Este relatório será registrado em commit documental separado; seu SHA final está no histórico da branch.
Git status: implementação committed; nenhum `.npmrc`, `.env`, `1.` ou código manager sync incluído. Working tree limpa após o commit documental.

Manager sync commit preserved: `8ecf51ee0539562636b7489ab29c89fecbf86751`
Integration status: NOT INCLUDED
Original workspace: HEAD manager sync preservado, somente untracked `1.`; nenhum reset/rebase/revert ou edição.

Remote writes: NO.
Staging touched?: NO.
Production touched?: NO.
Providers called?: NO real Asaas/Resend/email; somente mocks locais. Downloads/builds de dependências/imagens não são chamadas operacionais a providers da aplicação.
Push?: NO.

## Open questions

Nenhuma decisão de produto bloqueante. Limite conservador, envio conjunto, mínimo informativo e cancelamento/refund manual documentados para revisão. Migração/deploy remotos dependem de uma execução futura explicitamente autorizada.

PREORDER FEATURE: READY FOR REVIEW
