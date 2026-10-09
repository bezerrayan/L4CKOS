# L4CKOS — Cancelamentos, reembolsos e conciliação V1

09/10/2026. **Políticas financeiras operacionais da V1 aprovadas pelos dois fundadores**, conforme aprovação comunicada pelo usuário nesta tarefa. A aprovação define regras e responsabilidade; não comprova implementação de funcionalidades nem autoriza operações externas nesta entrega. Homologação futura depende de autorização e fixtures; abertura oficial continua condicionada aos gates da release e à política de cancelamento aplicável.

## 1. Limites e estados distintos

Regra aprovada: reembolsos manuais e supervisionados, sem reembolso automático na V1; conciliação obrigatória com o Asaas; reembolsos parciais manuais; tratamento individual de lotes abaixo do mínimo. Decisões e ações exigem responsável identificado e evidências auditáveis. Não confirmar devolução por status cancelled, mensagem do frontend, pedido do cliente, print isolado ou simples evento sem conciliação.

| Registro | Significado permitido | Não significa |
|---|---|---|
| Pedido cancelado | Decisão sobre atendimento/fulfillment | Cobrança cancelada, dinheiro devolvido |
| Pagamento pendente/vencido | Aguardando liquidação ou vencimento observado | Cancelamento/expiração segura de capacidade PREORDER |
| Cobrança cancelada/excluída | Estado do provedor a conferir | Prova de inexistência de pagamento tardio/reembolso |
| Reembolso solicitado | Pedido registrado e encaminhado para decisão | Aceite do provedor/devolução |
| Reembolso em processamento | Solicitação aceita/em andamento com referência válida | Conclusão |
| Reembolso confirmado | Provedor confirmou montante/correlação e conciliação encerrada por responsável | Reembolso integral se o valor foi parcial |
| Reembolso negado/erro | Recusa/falha ou resultado incerto | Autorização para repetir operação automaticamente |
| Parcial | Valor comprovado inferior ao total elegível, saldo remanescente registrado | Pedido inteiro automaticamente desfeito |

Esses estados são vocabulário do registro operacional. **Não existe máquina completa de reembolsos ou formulário para gravá-los todos na loja nesta release.** Exceções ficam em audit/ledger; o caso e a decisão podem ser registrados em controle restrito externo aprovado, com vínculo aos IDs existentes. Não inventar endpoint de resolução, alterar banco diretamente ou transformar pedido em refunded inexistente.

## 2. Responsabilidade inicial aprovada — dois fundadores

- Atendimento: abrir caso e comunicar apenas fatos, sem prometer prazo/valor não aprovado.
- Operador financeiro: consultar evidências e reconciliar pedido/cobrança/eventos, sem autorizar a própria exceção quando houver separação aprovada.
- Aprovador comercial/financeiro: decidir elegibilidade, montante e política; autorizar explicitamente qualquer operação externa.
- Técnico autorizado: investigar falha/ledger/recovery; não apagar claims/eventos nem conceder pagamento sem evidência confiável.
- Responsável operacional: guardar evidências sanitizadas, backup, trilha e fechamento; definir prazo de acompanhamento/escalação antes de iniciar, sem SLA inventado.

A responsabilidade inicial por aprovação, supervisão, conciliação e fechamento é dos **dois fundadores**. Registrar por caso quem aprovou, quem executou e quem supervisionou/conferiu; não presumir que exista fluxo de dupla aprovação no sistema. Identificação nominal, divisão das funções, substituição, canal restrito e limites de execução devem ser registrados no preflight operacional antes de qualquer ação. Isso operacionaliza a responsabilidade já aprovada, sem reabrir sua aprovação.

**Regra aprovada de conformidade:** respeitar os prazos legais, os direitos do consumidor e a política de cancelamento aplicável a cada caso. Registrar solicitação, prazo aplicável, fundamento e acompanhamento; a supervisão e a conciliação não justificam ultrapassar prazos ou restringir direitos. Não se fixam prazos legais ou exceções jurídicas neste runbook. Dúvidas sobre elegibilidade, frete, cupom, produção ou envio exigem avaliação dos responsáveis segundo a política aplicável, sem presumir perda de direito.

**Auditoria obrigatória:** registrar ID do caso/pedido/lote/cobrança, datas e fuso, fundamento, valor autorizado em centavos, identidade dos aprovadores/operadores, ações, referências do Asaas, resultados, conferência e comunicação ao consumidor. A trilha técnica existente cobre cancelamento e observações de conciliação; aprovações financeiras e execução manual devem ser complementadas em controle restrito aprovado. Não há formulário, saldo conciliado ou workflow completo de aprovação/reembolso implementado.

## 3. Abrir e identificar caso

1. Registrar identificador único, data/fuso, usuário solicitante, operador, pedido/lote/tipo STOCK/PREORDER/MIXED, motivo, estado atual e referência da cobrança. Não usar pedido real #12 para teste.
2. Consultar painel administrativo/auditoria com autorização: `order.cancelled`, `payment.reconciliation_required`, `checkout.external_creation_requested`, `checkout.created`, `checkout.charge_created`; correlacionar ledger `asaasWebhookEvents` via diagnóstico autorizado. Não expor acesso financeiro ao cliente nem usar filtros de frontend como controle de autorização.
3. Sinais: pago após cancelamento, STOCK expirado/liberado, cobrança sem retorno, pending com pagamento observado, refund_in_progress/denied/partial/refunded, deleted/overdue, divergência de valor/checkout/customer, ledger failed/processing. Falta de evento não prova ausência de dinheiro.
4. Preservar status/snapshots originais, valores em centavos, itens e reservas; registrar evidência anterior e posterior. Não liberar/consumir estoque/capacidade manualmente por suposição.

## 4. Conferir evidência financeira

Consulta ao provedor **não está autorizada nesta entrega**. Futuramente, usar apenas conta/ambiente autorizados e credencial server-side; no staging, Sandbox exclusivamente. Nunca copiar chave, token, cookie, cartão ou dado pessoal sensível ao relatório.

Comparar paymentId/checkoutId/externalReference/customer, valor original, método, moeda, status/data, confirmação/liquidação e referências/valores de reembolso. Conferir pedido, audit e ledger: eventId único, autenticação, processamento/erro, ordem dos fatos. O código armazena observação de exceção, não saldo nem valor conciliado de reembolso; montante/beneficiário precisam de prova independente do provedor.

Se checkout, pedido ou valor divergirem: marcar “conciliação pendente”, restringir ações do caso e escalar. Não marcar paid manualmente só para corrigir tela. Aprovação manual existente é sensível, exige evidência legítima e auditoria; não usar como substituto de provedor em homologação.

## 5. Cancelamento não é devolução

Antes de cancelar, conferir pagamento/reservas/produção/envio; registrar motivo e aprovação segundo política. Usar rota administrativa normal e confirmação existente; registrar audit/ator. Cancelamento é integral de pedido no fluxo existente; cancelamento parcial financeiro/itens não tem workflow completo implementado; reembolsos parciais seguem a regra manual aprovada.

Comportamento técnico preservado: libera STOCK active uma vez; consumed não repõe automaticamente; PREORDER cancelled deixa de comprometer capacidade segundo regra atual, sem apagar evidência paga. Pending PREORDER não expira automaticamente por boleto vencido. Pedidos cancelados não reativam; pagamento tardio e concorrência geram conciliação, não nova aprovação fictícia. Produção já comprometida/peças recebidas/envio exigem decisão comercial, não reposição ou devolução financeira automática.

Cliente deve receber linguagem factual: “pedido cancelado; situação da cobrança/reembolso em conferência” quando aplicável. Não enviar e-mail automático de reembolso concluído inexistente. Canal, conteúdo e notificações dependem de aprovação; esta release não implementa notificações de cancelamento/reembolso/cronograma por preferência.

## 6. Solicitação e acompanhamento supervisionado

1. Atendimento registra solicitação sem operar dinheiro. Aprovador decide valor elegível, eventual parcial, motivo e política; vincular aprovação ao caso.
2. **Só em etapa posterior autorizada**, operador executa operação financeira pelo canal aprovado do provedor. Não há execução de refund automática ou novo endpoint financeiro nesta release. Em staging desta checklist: simulações locais, **nenhuma devolução real**.
3. Guardar request/reference, operador, momento e resultado sanitizado. Resultado incerto permanece pendente; consultar evidência antes de repetir. Não remover claim/ledger para “destravar”.
4. Para processamento: acompanhamento com owner/prazo aprovado; atualizar caso somente após evidência nova. Evento PAYMENT_REFUND_IN_PROGRESS é observação, não confirmação.
5. Para recusado/erro: guardar motivo sanitizado e escalar; não iniciar segunda operação sem conferir se primeira ocorreu. PAYMENT_REFUND_DENIED não libera reserva nem muda pagamento por si só.
6. Para confirmado: exigir correlação e valor do provedor, identificar integral/parcial, registrar saldo remanescente e segundo aceite conforme controle aprovado. PAYMENT_REFUNDED observado isoladamente não completa workflow interno nem prova integralidade.
7. Parcial: somar devoluções comprovadas, evitar contar mesmo refund/event duas vezes; não exceder valor elegível; registrar quais itens/quantidades foram objeto da decisão sem reescrever snapshot da compra. Estoque/fulfillment associados precisam de decisão separada. Divergência ou funcionalidade parcial insuficiente = caso aberto, não inventar saldo na loja.

## 7. Recovery e lotes excepcionais

- Ledger failed/processing, callback duplicado/fora de ordem: preservar eventId/payload restrito/status/erro, verificar efeitos já ocorridos. Idempotência pode bloquear retry de failed; não deletar evento para reprocessar. Recovery técnico precisa de plano específico/testes/autoridade, reconciliação do provedor e prova de efeitos únicos.
- Checkout incerto/charge sem retorno: procurar cobrança correlacionada antes de permitir nova tentativa; claim durável impede duplicação. Não gerar novo checkoutAttemptId por conveniência nem usar endpoint legado para contornar trava.
- Recebido após cancelamento/expiry: não ressuscitar automaticamente nem consumir reserva indisponível. Registrar obrigação financeira observada, decidir atendimento alternativo ou devolução supervisionada; manter evidência original.
- Lote abaixo do mínimo/fornecedor indisponível/adiado: listar pedidos pagos e pendentes, compromisso físico e previsões registradas. Aprovador escolhe alternativa comercial (negociar fabricação, novo cronograma com comunicação, cancelamento/devolução supervisionada), sem cálculo fictício ou cancelamento/reembolso automático. Cada lote abaixo do mínimo deve ter decisão individual registrada pelos fundadores, com pedidos afetados, alternativa, prazos aplicáveis e comunicação factual. Não há decisão automática do sistema; os detalhes do caso respeitam os direitos do consumidor e a política de cancelamento aplicável.

## 8. Fechamento e limites da aprovação

Fechar somente com: identidade/valor/eventos conciliados, decisão documentada, execução e confirmação do provedor quando houver devolução, responsável e evidência, estoque/capacidade/fulfillment coerentes, cliente comunicado por canal autorizado e audit preservada. Conferência exige efeitos únicos e ausência de saldo/obrigação não explicados; status visual sozinho não basta.

Aprovados: operação manual supervisionada, conciliação com Asaas, parcial manual, decisão individual abaixo do mínimo, responsabilidade dos dois fundadores, auditoria das aprovações/ações e respeito aos prazos legais/direitos/política aplicável. Permanecem preparativos operacionais: responsáveis nominais por função/caso, canal restrito, retenção/privacidade, acompanhamento dos prazos e prova de recovery supervisionado. Elegibilidade e valores de casos pagos/em fabricação/recebidos/enviados, frete/cupom, fornecedor e adiamentos seguem a política aplicável e decisão individual documentada; não se inventam regras gerais adicionais. Notificações automáticas e um módulo completo de reembolsos continuam **não implementados**. A aprovação não autoriza criar automações nem executar dinheiro nesta tarefa.

Provas locais vinculadas na [RC](staging-release-candidate.md): reservas, concorrência, estados financeiros, eventos duplicados/tardios, idempotência e ausência de refund automático passaram. Homologação operacional e evidência real do provedor ainda pendentes. Interromper por divergência monetária/correlação, duplicidade, acesso indevido, estado parcial ou confirmação sem prova; preservar caso e escalar, nunca “corrigir” com SQL/novo pagamento.
