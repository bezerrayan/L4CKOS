# Drops exclusivos — Sprint 7: revisão independente e matriz de aceite XIV Bis

Branch `launch/claude-exclusive-review` = `feature/exclusive-drops-v1` (`b84462e`) + `integration/stock-exclusive-drops-v1` (`05a0d94`: STOCK com varredura de expiração P0 e provedor Asaas sandbox). O Codex reaplicou os 5 commits do módulo com outros hashes; a mesclagem foi limpa e o módulo ficou idêntico. Sem deploy, sem migration remota, sem cobrança real.

## 1. Defeitos demonstrados e corrigidos

| # | Onde | Defeito | Evidência | Correção |
|---|------|---------|-----------|----------|
| 1 | Servidor | Um *replay* do mesmo `attemptId` podia apagar (via `settleCheckout`) a reserva de cota de um `create` concorrente ainda em voo → cota subcontada. | Teste MySQL “replay never deletes the claim” | `reserveForCheckout` só devolve `claimed=true` quando ESTA requisição inseriu a reserva |
| 2 | Contrato | Cota só como “usada”; impossível distinguir reservada de consumida. | Teste MySQL (paga → consumida; ambígua → reservada) | `unitsReserved`/`unitsConsumed` derivados do estado do STOCK (aditivo; `unitsUsed` = soma) |
| 3 | Admin | Duplo clique em *Aprovar* e *Reemitir*: 2ª chamada (erro confuso “já aprovada”; reemissão matava o código recém-exibido). | 6 testes falham sem a correção | Guarda síncrona em voo |
| 4 | Admin | Revogar/Reemitir (irreversíveis) com 1 clique, fácil de errar no celular. | idem | Confirmação em duas etapas |
| 5 | Admin | Tabela mostrava “Nenhuma solicitação” enquanto carregava ou em erro. | idem | Estados de carregamento e erro |
| 6 | Admin | Formulário de aprovação abre longe da linha e o foco não ia para ele; tabelas largas não rolavam por teclado. | idem + Chrome | Foco no formulário; regiões roláveis rotuladas |
| 7 | Loja | Duas adições parciais podiam passar do limite autorizado no carrinho (teto só considerava o saldo do servidor). | teste de componente | Teto = saldo do servidor − unidades já na sacola do produto; sem unidades → sem botão + link para a sacola |
| 8 | Loja | Status só atualizava recarregando a página (aprovação feita pelo admin não aparecia). | teste | Reconsulta ao voltar à aba e a cada 30 s enquanto pendente |
| 9 | Loja | Código digitado permanecia no campo ao mudar o estado (reemissão, revogação, troca de conta). | teste | Campo limpo quando o status muda |
| 10 | Teste | Rejeição de promessa não tratada no teste de permissões. | log do runner | Promessas criadas sob demanda |

## 2. Auditoria sem defeito (cobertura MySQL real)

- Jornada A→L: produto público; solicitar; login com `next` seguro (já existia); pendente; aprovação; código; tamanhos; checkout STOCK; retomada. Estados: sem acesso, pendente, aprovada, recusada, revogada, expirada, drop programado, drop encerrado — nenhum botão de compra sem `unlocked` + janela aberta + unidades (Chrome real em 320 e 430).
- Códigos: de outra conta, expirado, revogado, reemitido, errado, força bruta (5/15 min), duas abas, já desbloqueado; mensagem genérica (não revela de quem é). Código em texto puro: banco, histórico, outbox, auditoria e e-mails — nenhum.
- Concorrência: duas abas, IDs diferentes (1 vence), falha na criação (libera), provedor definitivo vs incerto, ambíguo (retém), pago (consome), cancelamento/expiração (varredura do Codex libera só tentativa não iniciada), revogação e reemissão com pedido aberto.
- Permissões: toda `admin.*` recusa usuário comum (7 procedimentos) e anônimo.

## 3. Comportamentos de produto a conhecer

- **Revogar durante pedido aberto:** novas tentativas e o *replay* do mesmo id são recusados na hora; o pedido aberto segue o ciclo do STOCK (pagável e retomável por `resume`) e suas unidades continuam retidas.
- **Reemitir com tentativa ativa:** a tentativa não é tocada; o código antigo morre; o cliente precisa desbloquear de novo para novas tentativas.
- A UI nunca presume liberação de cota: o saldo exibido vem sempre do servidor.

## 4. E-mails

Templates `ExclusiveDropRequestReceived/AccessApproved/AccessRejected/AccessRevoked` (layout, badge e componentes existentes), registrados no renderer, assuntos, eventos e lista de templates. A aprovação informa limite e datas **no fuso do drop** e diz que o código vem separadamente; nenhum payload pode conter algo com formato de código (o construtor se recusa). Testes com fixtures sintéticas: renderização, dados obrigatórios, ausência de código, chave de idempotência = `eventKey`.

**Para conectar ao Resend (não feito):**
1. Implementar `TransactionalEmailSender.send` (`server/exclusive/emailNotifier.ts`) sobre o serviço existente (`services/email/emailService.js`): renderiza o template, usa `emailSubjects[subjectKey]` e envia.
2. `emailService.sendEmail` ainda **não repassa idempotência**: passar `idempotencyKey` ao SDK (`client.emails.send(payload, { idempotencyKey })`). Obrigatório antes de produção.
3. Agendar `store.dispatchNotifications(createExclusiveEmailNotifier({ loadContext: store.notificationContext, sender }))` (ex.: junto do agendador de expiração do STOCK).
4. Staging: só destinatário sintético (`l4ckos-email-safety`); o `console.info('[Email] sent', { to })` existente imprime o endereço — revisar.

## 5. Pendências para o Codex

1. **Atomicidade cota × reserva STOCK:** hoje a reserva de cota é uma transação separada, *antes* do STOCK (sob lock no grant). Falha entre as duas retém unidades por até 2 min (grace) — erra para o lado seguro, sem excesso demonstrado. Para atomicidade total, chamar a reserva de cota dentro da transação do STOCK (hook em `createStockCheckout`).
2. Contrato de que a cota depende: `stockCheckoutAttempts.status/providerState/reconciliationRequiredAt` (verificado contra a varredura P0: libera `not_started`, marca reconciliação nas criadas pelo provedor).
3. Pool em produção: `getExclusiveStore()` usa `getDb().$client` — confirmar na composição real.
4. Migration `0028`: aplicar em homologação autorizada, com backup; criar o drop **antes** de publicar o produto.
5. E-mail: itens da seção 4 (idempotência do `sendEmail`, agendamento).
6. Menores: `Pagamento.tsx` (caminho legado) usa `refetchInterval` com assinatura do React Query v4 (recebe a query, não os dados); o carrinho do navegador não conhece exclusividade (itens de um acesso revogado só são recusados no checkout, com mensagem clara).

## 6. Matriz de aceite — XIV Bis (staging)

Pré-condições: ambiente confirmado (`l4ckos-staging-safety`), migration 0028 aplicada em banco de **homologação autorizado**, módulo integrado ao STOCK atual, Asaas **sandbox**, contas sintéticas A (cliente), B (outro cliente) e um admin real de staging. Evidência = captura + `attemptId`/`orderId` + consulta somente leitura (sem dados pessoais reais).

| Fluxo | # | Passos | Aprova quando | Evidência |
|-------|---|--------|---------------|-----------|
| **A — não autorizado** | A1 | Anônimo abre o produto (320 e 390 px) | Fotos, preço, tamanhos, “Drop exclusivo”, período no fuso do drop; só “Solicitar acesso” | Capturas |
| | A2 | Chamar `stockCheckout.create` e `cart.add` direto sem acesso | `EXCLUSIVE_ACCESS_REQUIRED`; 0 tentativas | Resposta + contagem |
| | A3 | A solicita 2×; consulta status | 1 registro; “Aguardando aprovação” | Linha em `exclusiveAccessRequests` |
| **B — administração** | B1 | Aba Drops lista a solicitação; filtros por drop e status | Aparece e filtra | Captura |
| | B2 | Usuário comum tenta aprovar/revogar (API) | `FORBIDDEN` | Resposta |
| | B3 | Admin aprova (limite 3, validade); duplo clique | 1 aprovação; código exibido uma vez; lista atualiza | Captura; 1 linha em `exclusiveGrants` |
| | B4 | Revogar e reemitir pedem confirmação | 2º clique exigido | Captura |
| | B5 | Histórico e auditoria | Eventos sem código | Captura; `auditLogs` |
| **C — autorizado** | C1 | A desbloqueia com o código | Compra liberada; cota 3 / 0 / 0 / 3 | Captura |
| | C2 | Código de B, errado ×6, expirado, revogado | Mensagem genérica; 6ª tentativa limitada | Respostas |
| | C3 | M+G+GG; 2M+1G; 3M; 4ª unidade; duas adições parciais | Dentro do limite OK; 4ª bloqueada; teto considera a sacola | Capturas; `exclusiveGrantUsage` |
| **D — compra** | D1 | Checkout STOCK com pagamento sandbox pendente | Cota “em pedidos abertos” sobe; pedido `pending` | Pedido + cota |
| | D2 | Pagamento aprovado | Cota “compradas”; pedido `paid` só após webhook | Pedido + cota |
| | D3 | Cancelar/expirar tentativa **não iniciada** (varredura) | Cota devolvida | Estado + nova compra |
| | D4 | Pagamento ambíguo / pendente expirado | Cota **não** devolvida até reconciliar | Estado |
| | D5 | Falha de rede/timeout na criação | Mesmo `attemptId`; sem 2ª cobrança | Contagem = 1 |
| **E — segurança** | E1 | Duas abas disputam a última unidade | Exatamente 1 sucesso | 1 tentativa persistida |
| | E2 | Revogar com pedido aberto | Novas compras bloqueadas; pedido aberto segue | `resume` + tentativa |
| | E3 | Reemitir com tentativa ativa | Código antigo falha; tentativa intacta | Respostas |
| | E4 | Troca de conta na mesma aba | B não vê status/cota de A; campo de código vazio | Capturas |
| | E5 | Drop programado / encerrado | Página visível; compra bloqueada (`EXCLUSIVE_DROP_CLOSED`) | Capturas + API |
| | E6 | Produto público (City Noise) sem código | Compra normal; STOCK sem regressão | Tentativa criada |
| **Mobile/A11y** | M1 | Loja e Admin em 320/360/375/390/430 px | Sem rolagem horizontal; alvos ≥ 44 px (loja); tabelas rolam por teclado | Capturas |
| | M2 | Só teclado + leitor de tela nos estados e no painel | Status anunciado (`role=status/alert`); foco no formulário aberto | Gravação/relatório |

Bloqueios de aprovação: qualquer compra sem autorização válida, excesso de cota, código em texto puro (banco/log/e-mail), cobrança duplicada ou regressão do STOCK. O aceite final depende da integração do Codex e da migration 0028 em banco de homologação autorizado.
