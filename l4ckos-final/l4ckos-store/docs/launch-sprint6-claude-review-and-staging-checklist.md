# Sprint 6 (Claude) — revisão independente da integração e checklist de homologação

Branch `launch/claude-sprint6` (a partir de `launch/claude-sprint5`, mesclada com `integration/stock-checkout-sprint4` @ `0cfa688`, que contém `2e8bd59 Harden STOCK checkout idempotency`).
Somente frontend, testes e docs. Sem deploy, sem pagamento real, sem banco real, sem staging. Os testes de MySQL rodaram em container descartável (loopback, credenciais sintéticas, removido ao final).

## 1. A deduplicação do Codex elimina a duplicidade? Sim, no servidor.

Evidência (MySQL 9.7.2 descartável, 30 testes do Codex + 5 meus de ponta a ponta):
- Dois `attemptId` diferentes para o mesmo carrinho e o mesmo dono, em paralelo: **1 cobrança**, a outra recebe `CHECKOUT_ATTEMPT_NOT_REUSABLE`.
- Mudar o endereço com o mesmo carrinho (mesmo ou novo `attemptId`) é recusado; 1 cobrança.
- `resume`/`resumeLatest` de outra conta: `NOT_FOUND` / `null`.
- Sessão inválida: `UNAUTHORIZED`, nenhuma cobrança.

Não implementei segunda solução de dedupe no frontend. O que o frontend faz é **reagir** ao contrato (ver §2).

## 2. Defeitos demonstrados e corrigidos (frontend)

| # | Defeito | Demonstração | Correção |
|---|---------|--------------|----------|
| 1 | Com a dedupe, o `attemptId` rejeitado nunca é persistido; o `resume` dele dá `NOT_FOUND` e a UI ficava num loop com um id fantasma, sem mostrar a tentativa aberta do outro dispositivo. | Teste de ponta a ponta contra o servidor real: falha com o cliente da Sprint 5, passa com a correção. | `NOT_FOUND` no id local cai para `resumeLatest` (só tentativas abertas). |
| 2 | `CHECKOUT_ATTEMPT_NOT_REUSABLE` dizia só "não pode ser repetida". | Teste de componente. | Texto: "Já existe um pedido em aberto com estes itens…" + consulta ao backend. |
| 3 | `STOCK_UNAVAILABLE`: `needsCartReview` nunca era usado; o carrinho ficava com estoque velho. | Teste: catálogo não era relido. | `requestCartCatalogRefresh()` relê o catálogo e bloqueia a repetição inútil. |
| 4 | Requisição pendurada deixava "Preparando checkout…" para sempre. | `fetchWithTimeout.test.ts`. | Timeout de 45 s (inclui o fetch do CSRF); resultado = desfecho incerto, mesmo `attemptId`, consulta. |

## 3. Pendências para o Codex (backend)

**P0 — nenhum agendamento libera reservas expiradas.** `runtime.expireReservations` existe (`stockCheckoutRuntime.ts:42`) mas ninguém o chama; só o `create` do próprio dono varre as suas (`stockCheckout.ts:191`). Efeito combinado com o `resumeRecord`:
- `resume` devolve `status:"expired"` com `canStartNewAttempt:false` enquanto a reserva não foi liberada (`canStartNewAttempt` só é `true` se `attempt.status === "released"`).
- A UI bloqueia o botão nesse estado ("estamos liberando o estoque"), mas a única coisa que libera é um `create` do mesmo dono, que a UI bloqueou → impasse para o cliente e estoque preso para todos.
- Sugestão: (a) agendar a varredura (job/intervalo no runtime) **e** (b) devolver `canStartNewAttempt:true` para `expired` não iniciado, já que o `create` o libera antes de decidir. Teste de MySQL cobrindo `resume` de reserva expirada não liberada.

**P1 — resume não expõe a equivalência de carrinho.** O servidor só bloqueia carrinho equivalente, mas a UI, sem poder compará-lo, bloqueia qualquer compra enquanto o dono tiver uma tentativa aberta (carrinho diferente incluído) até ela expirar. Sugestão aditiva: `cartFingerprint` (o `canonicalCart` já existe) no `resume`/`resumeLatest`; a UI bloquearia só quando igual.

**P1 — sem como mudar o endereço ou cancelar.** Carrinho igual com entrega diferente é recusado até a reserva expirar ou ser paga; não há cancelamento. Decisão de produto: endpoint de cancelamento ou substituição de reserva.

**P2** — (a) `reserved` com `providerState=not_started` (queda entre a transação e o provedor) não tem caminho de repetição na UI; repetir o `create` com o mesmo id é seguro no servidor (replay) — expor um indicador (`canRetryCreate`). (b) O fingerprint mudou de formato: tentativas criadas antes do deploy levam `CHANGED` no replay (irrelevante com checkout fechado). (c) `scripts/run-stock-mysql-tests.sh` sobe `mysql:8.4.11`, mas os testes exigem 9.7.2: o runner falha como está (usei uma cópia com 9.7.2). (d) Carrinho do `localStorage` de A é sincronizado com a conta de B em navegador compartilhado (decisão de produto).

## 4. Regressões após a integração da Sprint 5

Nenhuma encontrada. Suíte integrada: 301 passando + 30 MySQL/HTTP do Codex + 5 MySQL/HTTP meus (ver entrega). As 2 falhas de `security-hardening` que existiam em `39851eb` não ocorrem mais na versão do Codex.

## 5. Mobile e acessibilidade (Chrome real, mock local da API, 320/360/375/390/430)

Versão integrada: o botão "Finalizar compra" do drawer nunca é coberto pelo banner; o banner permanece operável (SAIBA MAIS / ENTENDI), o consentimento só é gravado no clique, o offset é limpo ao decidir; fundo `inert` e `aria-modal` ausente enquanto o banner está pendente; foco fica em drawer + banner (nenhum escape para a página) e `inert` é removido ao fechar; `/checkout` sem rolagem horizontal, sem alvos < 40 px, sem campo sem rótulo.

---

# Checklist final de homologação (staging)

Pré-condições: ambiente confirmado como staging (skill `l4ckos-staging-safety`); Asaas **sandbox**; conta(s) de teste dedicadas (A e B); banco de staging; checkout público aberto **somente** em staging; varredor de reservas ativo (P0). Nenhuma credencial ou cobrança real. Evidência = captura/gravação + `attemptId`/`orderId` + consulta somente leitura ao banco/log, sem dados pessoais reais.

Regra global de aprovação: **nenhum cenário gera 2ª cobrança, falsa confirmação ou exibe dado de outra conta.** Qualquer falha em C1–C6 = reprovado.

| # | Cenário | Como executar | Critério de aprovação | Evidência |
|---|---------|---------------|----------------------|-----------|
| C1 | Fluxo feliz | Produto → variante → CEP 70000-000…73999-999 → finalizar → pagar no sandbox | Pedido `paid/confirmed` só após o webhook; UI "Pagamento aprovado" só após `paid` do backend; carrinho limpo; 1 cobrança | Capturas; 1 linha em `stockCheckoutAttempts`; 1 cobrança no provedor |
| C2 | Duas abas / dois dispositivos | Mesma conta, mesmo carrinho: finalizar nas duas quase juntas | 1 cobrança; a segunda mostra "Já existe um pedido em aberto…" e exibe o status/link da primeira; botão bloqueado | `attemptId` das duas; contagem de cobranças = 1 |
| C3 | Limpar armazenamento | Com tentativa pendente, limpar `localStorage` e recarregar | Tentativa reaparece via servidor; botão bloqueado; nenhuma nova cobrança | Capturas; contagem = 1 |
| C4 | Falha de rede / requisição pendurada | DevTools offline ou throttling; finalizar; depois restaurar | Em ≤ 45 s mensagem "Falha de conexão…"; botão bloqueado até "Consultar status"; mesmo `attemptId`; ≤ 1 cobrança | Capturas; log; contagem ≤ 1 |
| C5 | Pagamento em análise | Forçar `PAYMENT_UNDER_ANALYSIS`/ambíguo (sandbox) | "Pagamento em análise"; botão bloqueado até reconciliar; nenhuma nova tentativa | Captura; status `ambiguous` |
| C6 | Troca de conta | A inicia → A sai → B entra (mesmo navegador e também outra aba) | B nunca vê pedido/status/form de A; cache limpo; B inicia compra normalmente | Capturas; chamadas de rede de B (nenhuma com `attemptId` de A) |
| C7 | Endereço alterado | Criar tentativa; mudar endereço; finalizar | Recusado sem 2ª cobrança; mensagem de pedido em aberto; documentar o comportamento do P1 | Capturas; contagem = 1 |
| C8 | Reserva expirada | Deixar a reserva expirar; voltar | Estoque liberado pelo varredor; "Tentativa expirada"; nova tentativa com **novo** `attemptId` possível (P0) | `attemptId` antigo/novo; estoque |
| C9 | Recusado / cancelado | Cartão recusado no sandbox; cancelar | "Pagamento não concluído"/"cancelado"; nova tentativa só com `canStartNewAttempt`; estoque devolvido | Capturas; reserva liberada |
| C10 | Estoque insuficiente / variante desativada | Reduzir estoque ou desativar antes e durante a compra | "Item indisponível"; catálogo do carrinho atualizado sozinho; nenhuma cobrança | Capturas; ausência de linha/cobrança |
| C11 | Frete | Quote indisponível; CEP fora da faixa | Sem opção de entrega; checkout bloqueado; nunca frete grátis presumido | Captura; resposta do quote |
| C12 | Banner + drawer | 1ª visita com carrinho: abrir sacola com o banner visível; só teclado; leitor de tela (NVDA/VoiceOver) | Finalizar acessível; banner anunciado e alcançável; foco preso em drawer+banner e retorna ao fechar; consentimento só após "ENTENDI" | Gravação; relatório do leitor de tela |
| C13 | Mobile 320/360/375/390/430 | Percorrer produto → sacola → checkout → confirmação | Sem rolagem horizontal; alvos ≥ 44 px (≥ 40 mínimo); erros anunciados (`role=alert`); contraste legível | Capturas por largura; checklist preenchido |

Decisão: **GO** somente com C1–C13 aprovados e P0 resolvido; **NO-GO** em qualquer cobrança duplicada, falsa confirmação, vazamento entre contas ou bloqueio sem saída (C8).
