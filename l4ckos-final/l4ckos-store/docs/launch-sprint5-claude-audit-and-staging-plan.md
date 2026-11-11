# Sprint 5 (Claude) — auditoria do checkout, pendências de backend e roteiro de homologação

Branch `launch/claude-sprint5` (a partir de `39851eb`). Somente frontend/testes. Sem deploy, sem pagamento real, sem staging.

## 1. Achados corrigidos no frontend

| # | Achado | Correção |
|---|--------|----------|
| 1 | Logout só invalidava `auth.me`; cache do react-query (resumeLatest, pedidos, perfil) de A sobrevivia para B (também quando outra aba entra como B). | `UserProvider` purga todo cache exceto `auth.me` ao mudar a identidade e no logout. |
| 2 | `Pagamento` guardava tentativa, confirmação e formulário em estado de componente: sobreviviam à troca de conta. | Remount por `user.id` (`key`). |
| 3 | Tela "Seu pedido em andamento" podia aparecer deslogado a partir do cache. | Exige `isAuthenticated` **e** carrinho vazio. |
| 4 | Segunda aba não percebia a tentativa criada pela primeira. | Evento `storage` do registro do usuário dispara consulta ao backend antes de qualquer clique. |
| 5 | `failed/expired/cancelled` sem `canStartNewAttempt` deixava o botão habilitado enquanto o texto mandava consultar o status. | Botão bloqueado até o servidor liberar. |
| 6 | `aria-modal` no drawer escondia o banner de cookies de leitores de tela, mas o foco de teclado ainda chegava nele. | Fundo realmente `inert` (drawer + banner pendente continuam operáveis); `aria-modal` só quando não há banner pendente. Consentimento continua explícito. |
| 7 | Alvos de toque de 21 px (cupom, "Continuar comprando"). | 44 px. |

## 2. Cenários auditados sem defeito (cobertos por teste)

- Duplo clique / envios rápidos: guarda síncrona (`checkoutInFlightRef`).
- Recarga durante a criação: o mesmo `attemptId` é reenviado (idempotente).
- Limpar `localStorage` com tentativa viva no servidor: `resumeLatest` antes de permitir novo id.
- Carrinho alterado após criar tentativa: tentativa aberta continua bloqueando.
- Endereço alterado após falha de rede: mesmo `attemptId`; servidor decide (`NOT_REUSABLE` → consulta e bloqueio).
- Timeout / API fora na carga: bloqueado, sem criação automática, "Consultar status".
- Sessão expirada no create: pede novo login, mantém carrinho e `attemptId`.
- `resume` com `UNAUTHORIZED`: nada exibido, nada criado.
- `create` dizendo `paid` não confirma; só `resume` `paid` confirma e limpa o carrinho.
- `resumeLatest` com pago/falho/expirado/cancelado antigo nunca aparece como pendente nem limpa o carrinho.

## 3. Pendências de backend para o Codex (não implementadas aqui)

1. **`create` não deduplica por dono + fingerprint.** `attemptId` novo com o mesmo conteúdo cria nova reserva e nova cobrança. O cliente reduz o risco (consulta `resumeLatest`, trava entre abas), mas só o servidor garante. Sugestão: rejeitar/reaproveitar quando o dono já tem tentativa aberta com o mesmo fingerprint.
2. **`resumeLatest` devolve a tentativa mais recente de qualquer status/carrinho.** O cliente filtra por status aberto; um filtro (ou parâmetro) no servidor simplifica o contrato.
3. **Fingerprint local ≠ servidor** (local: itens; servidor: itens + entrega). Entrega alterada com o mesmo `attemptId` gera `CHECKOUT_ATTEMPT_NOT_REUSABLE`: seguro, mas o cliente fica preso à reserva antiga até expirar. Decidir se entrega alterada deve liberar/substituir a reserva no servidor.
4. **Sem timeout de requisição no cliente tRPC** (`main.tsx`). Um `create` pendurado deixa "Preparando checkout..." indefinidamente (seguro, sem cobrança duplicada; recarregar reutiliza o `attemptId`). Recomendado `AbortController` no `fetch` com desfecho "incerto → consultar".
5. **Autorização efetiva é só do servidor.** `resume(attemptId)` de outro usuário já é coberto (`stockCheckoutResume.test.ts` e `stockCheckout.integration.mysql.test.ts`). Não encontrei teste equivalente para `resumeLatest` com dois usuários (ele filtra por `ownerUserId` no SQL); vale acrescentar.
6. **Carrinho compartilhado entre contas** (decisão de produto): `useSyncData` envia o carrinho do `localStorage` ao servidor de quem logar; num navegador compartilhado, os itens de A entram na conta de B. Não é dado financeiro. Decidir: limpar carrinho no logout ou aceitar.
7. Se o runtime não expõe `resumeLatest`, o cliente falha fechado (bloqueia checkout com carrinho cheio sem id local).

## 4. Validação mobile (Chrome real, mock local da API, 320/360/375/390/430 px)

ProductDetail, Carrinho, CartDrawer (com banner), Pagamento (sem tentativa, com tentativa pendente, aprovado/confirmação): sem rolagem horizontal; alvos de toque ≥ 40 px (corrigidos os de 21 px); sem campos sem rótulo; botão de finalizar bloqueado com tentativa pendente; confirmação só com `paid` do backend. ProductDetail: tamanho esgotado desabilitado e rotulado "indisponível", variante inativa não ofertada, quantidade limitada ao estoque da variante.
Não coberto: contraste medido por ferramenta, leitor de tela real, estados de erro de formulário em todas as larguras (cobertos por testes de componente).

---

# Roteiro de homologação manual (staging futuro)

Pré-requisitos: ambiente de staging confirmado pela skill `l4ckos-staging-safety`; Asaas **sandbox**; conta de teste dedicada; banco descartável; `PUBLIC_CHECKOUT` aberto apenas em staging. Nenhuma credencial ou cobrança real. Evidência = captura de tela + registro do `attemptId`/`orderId` + linha do banco/log (sem dados pessoais reais).

| # | Cenário | Passos | Resultado esperado | Evidência |
|---|---------|--------|--------------------|-----------|
| 1 | Produto e variante | Abrir produto; escolher cor/tamanho; esgotada, inativa; aumentar quantidade | Esgotada desabilitada e rotulada; inativa não aparece; quantidade ≤ estoque da variante; adicionar só com cor+tamanho | Capturas em 390 px; estoque no banco |
| 2 | Endereço e frete | CEP válido (70000-000 a 73999-999) e fora da faixa; consulta de frete fora do ar | Opção local só da resposta do servidor; fora da faixa/erro: sem opção e checkout bloqueado | Captura; resposta `/api/shipping/quote` |
| 3 | Criação do pedido | Preencher e finalizar uma vez; tentar duplo clique | 1 tentativa, 1 reserva, 1 cobrança; estoque reservado | `stockCheckoutAttempts` (1 linha), reserva, provider (1 cobrança) |
| 4 | Pagamento pendente | Abrir link de pagamento sandbox sem pagar | Cartão "Aguardando confirmação"; nunca "aprovado"; botão bloqueado | Captura; status no banco `pending` |
| 5 | Pagamento aprovado | Pagar no sandbox; webhook | Só após `paid`: "Pagamento aprovado", carrinho limpo, pedido `paid/confirmed`; webhook repetido não duplica | Captura; linha do pedido; log do webhook |
| 6 | Pagamento recusado | Cartão recusado do sandbox | "Pagamento não concluído"; nova tentativa só quando o servidor liberar (`canStartNewAttempt`); estoque liberado | Captura; reserva liberada |
| 7 | Cancelamento | Cancelar/expirar reserva | "Cancelado"/"Expirada"; nova compra com novo `attemptId`; estoque devolvido | `attemptId` antigo e novo; estoque |
| 8 | Falha de conexão | DevTools offline ao finalizar; depois online | Mensagem de falha de conexão; botão bloqueado até "Consultar status"; no máximo 1 cobrança | Captura; contagem de cobranças = 1 |
| 9 | Retomada | (a) recarregar; (b) limpar localStorage; (c) segunda aba; (d) outro navegador/dispositivo mesma conta; (e) trocar de conta | Tentativa aberta reaparece e bloqueia nova; a segunda aba atualiza sozinha; conta B nunca vê pedido de A | Capturas; `attemptId` igual entre abas |
| 10 | Estoque insuficiente | Reduzir estoque da variante antes de finalizar (e durante) | "Item indisponível"; revisão do carrinho; nenhuma cobrança | Captura; ausência de linha/cobrança |
| 11 | Mobile e acessibilidade | 320/360/375/390/430 px; só teclado (Tab, Shift+Tab, Enter, Espaço, Esc); leitor de tela (NVDA/VoiceOver); drawer com banner pendente | Sem rolagem horizontal; foco preso no drawer e retorna ao abrir; banner alcançável e anunciado; erros anunciados (`role=alert`); alvos ≥ 44 px | Gravação curta; relatório do leitor de tela |

Critério de aprovação: nenhum cenário gera segunda cobrança, falsa confirmação ou exibe dado de outra conta.
