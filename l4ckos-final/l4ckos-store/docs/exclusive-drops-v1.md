# Drops exclusivos V1 (L4CKOS × Clã XIV Bis)

Branch `feature/exclusive-drops-v1`, a partir de `integration/stock-checkout-sprint4` @ `ece56b6` (contém Sprints 4–6). Nenhuma migration aplicada em banco remoto; nenhum deploy; checkout público continua fechado.

## 1. Princípio

Exclusividade é uma **camada de controle sobre o STOCK V1**, não um segundo checkout. Ela decide *se* esta conta pode comprar *quantas* unidades; preço, estoque, reserva, pagamento, webhook e confirmação continuam exclusivamente no STOCK.

## 2. Arquitetura

| Peça | Arquivo | Papel |
|------|---------|-------|
| Contrato | `shared/exclusiveDropsV1.ts` | Tipos, estados, regras puras (janelas, fuso), códigos de erro estáveis |
| Migration candidata | `database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql` | 8 tabelas novas, só aditiva, **não aplicada** |
| Serviço | `server/exclusive/store.ts` | Solicitação, decisão, código, cota, guarda, outbox |
| Códigos | `server/exclusive/codes.ts` | 100 bits (`crypto.randomInt`), base32, só o hash é guardado |
| Guarda | `server/exclusive/checkoutGuard.ts` | Envolve `stockCheckout.create`; fail-closed |
| Router | `server/routers/exclusiveDrops.ts` | Público/cliente/admin (`adminProcedure` existente) |
| UI pública | `client/src/components/exclusive/ExclusiveAccessPanel.tsx` | Todos os estados da página de produto |
| UI admin | `client/src/components/admin/exclusive/AdminExclusiveDrops.tsx` | Aba “Drops” |

Mudanças em arquivos existentes (mínimas): `routers.ts` (registro), `routers/stockCheckout.ts` (+guarda envolvendo o `create`), `routers/orders.ts` (+recusa de produto exclusivo no checkout legado), `routers/cart.ts` (+verificação no carrinho do servidor), `ProductDetail.tsx`, `Admin.tsx` (aba), `stockAttemptView.ts` (códigos de erro).

## 3. Modelo e regras

- **Drop**: nome, produtos (um produto pertence a no máximo um drop), janela de solicitação e de compra (UTC, com `timezone` para exibição), `status` (rascunho/publicado/encerrado), `requiresAuthorization`, limite padrão. Estado derivado: `scheduled` → `active` → `closed` (fim exclusivo). Datas só entram **com offset explícito**; local sem fuso é recusado.
- **Solicitação**: uma linha por (drop, usuário) — clique duplicado é idempotente. Estados: pendente, aprovada, recusada, revogada. Recusada pode solicitar de novo; revogada não.
- **Aprovação** gera o código (mostrado **uma única vez** ao admin), limite de unidades e validade. **Reemitir** invalida o anterior. **Revogar** bloqueia novas compras na hora.
- **Desbloqueio**: o cliente informa o código; ele só funciona na conta dona, não revogado/expirado, drop não encerrado. Falhas são indistinguíveis (sem pista de quem é o código) e limitadas a 5 por 15 min por conta (persistido).
- **Admin**: `adminProcedure` (role + admin configurado por ambiente); nenhum e-mail fixo no código. Decisões vão para `exclusiveEvents` (histórico) e para o `auditLogs` existente, sem código nem hash.

## 4. Integração com o STOCK V1 e cota

`stockCheckout.create` passa por `withExclusiveCheckoutGuard` **antes** de qualquer escrita do STOCK:
1. Produtos do pedido ∈ drop? Se não, nada muda (produto público intacto).
2. Janela de compra aberta? Grant ativo, desbloqueado, não expirado, não revogado? Senão `EXCLUSIVE_*` (nenhuma reserva, nenhuma cobrança).
3. Sob `SELECT … FOR UPDATE` na linha do grant, soma as unidades e registra a reserva de cota em `exclusiveGrantUsage` (única por grant+attemptId). Duas abas serializam nesse lock: nunca excedem o limite; replay do mesmo `attemptId` não conta duas vezes.
4. O STOCK executa normalmente. Se o `create` falhou antes de persistir a tentativa (estoque, validação), a reserva de cota é removida.

**Cota derivada do estado do STOCK (sem hook nas tabelas do Codex).** Unidades contadas = reservas cujo `stockCheckoutAttempts` existe e **não** está `released` com `providerState ∈ {not_started, definitive_failure}` sem `reconciliationRequiredAt`; reservas sem tentativa contam só por 2 min (create em voo). Logo:
- pago → consome; pendente/reservado → retém; **ambíguo, ou aguardando reconciliação → retém**; cancelado/expirado de tentativa não iniciada ou falha definitiva → libera.
- Nada é “liberado” por escrita: a liberação é idempotente e nunca antecede a reconciliação segura do STOCK.

Pontos de contrato dos quais a cota depende (devem ser preservados pelo Codex): `stockCheckoutAttempts.status/providerState/reconciliationRequiredAt` e a regra de que o STOCK só marca `released` com `not_started`/`definitive_failure` quando seguro.

## 5. E-mails

`exclusiveNotificationOutbox` (gravada na mesma transação da decisão): `request_received`, `access_approved`, `access_rejected`, `access_revoked`. Chave lógica única (`eventKey`) — retry/duplo clique não duplicam. `dispatchNotifications(notifier)` faz claim atômico com lease, usa `eventKey` como idempotency key do provedor, finaliza só com a lease, marca `failed` com erro sanitizado (nunca reenvia sozinho). **Nenhum provedor está ligado**: só o contrato `ExclusiveDropNotifier`. O e-mail *não contém o código* (não é armazenado); o admin repassa o código por canal seguro.

## 6. Dependências do Codex

1. **Mesclar** a pequena alteração em `routers/stockCheckout.ts` (guarda ao redor do `create`) e em `orders.ts`/`cart.ts`.
2. **Compor em produção** o acesso ao pool: `getExclusiveStore()` usa `getDb().$client`; confirmar na composição real do runtime STOCK.
3. **P0 já apontado**: agendar a varredura de reservas expiradas — a cota de tentativas não iniciadas só volta quando o STOCK as libera.
4. **Aplicar a migration 0028** pelo runbook (`l4ckos-release-verification`) em staging, com backup atestado; hoje só testada em MySQL 9.7.2 descartável. Sem as tabelas o guarda é inerte (nenhum produto é exclusivo) — por isso **criar o drop antes de publicar o produto XIV Bis**.
5. **Provedor de e-mail**: implementar `ExclusiveDropNotifier` (Resend) e agendar `dispatchNotifications`; seguir `l4ckos-email-safety` (destinatário sintético em staging).
6. `scripts/run-stock-mysql-tests.sh` usa `mysql:8.4.11`, mas os testes exigem 9.7.2.

## 7. Limitações conhecidas (V1)

- Entrega do código é manual (admin → integrante). Reemissão disponível.
- Revogar bloqueia **novas** tentativas; tentativas STOCK já abertas seguem seu ciclo (e unidades pagas ficam no histórico).
- Carrinho do navegador não é fonte de verdade: o servidor recusa no checkout (e no `cart.add` do servidor).
- Drop sem `requiresAuthorization` só aplica janela de compra.

## 8. Checklist de homologação (staging, sem cobrança real)

| # | Verificar | Aprovado quando | Evidência |
|---|-----------|-----------------|-----------|
| 1 | Página pública do produto exclusivo (anônimo) | Fotos/preço/tamanhos visíveis; “Drop exclusivo” + período no fuso do drop; só “Solicitar acesso” | Captura 320/390 px |
| 2 | Chamar `stockCheckout.create` direto sem acesso | `EXCLUSIVE_ACCESS_REQUIRED`; nenhuma tentativa/cobrança | Resposta da API + contagem de tentativas = 0 |
| 3 | Solicitar acesso duas vezes | 1 registro; “Aguardando aprovação” | Linha em `exclusiveAccessRequests` |
| 4 | Usuário comum tenta aprovar | `FORBIDDEN` | Resposta da API |
| 5 | Admin aprova (limite 3, validade) | Código exibido uma vez; nada de código em logs/DB | Captura; consulta ao banco |
| 6 | Código de outra conta / expirado / revogado | Mensagem genérica; 6ª falha em 15 min = limite | Respostas |
| 7 | Desbloquear e comprar M + G + GG | 3 tentativas OK; 4ª unidade recusada (`EXCLUSIVE_QUOTA_EXCEEDED`) | `exclusiveGrantUsage` + tentativas |
| 8 | Duas abas disputando a última unidade | Exatamente 1 sucesso | 1 tentativa persistida |
| 9 | Cancelar/expirar tentativa **não iniciada** | Cota devolvida | Estado da tentativa + nova compra aceita |
| 10 | Pagamento ambíguo/pendente | Cota **não** devolvida até a reconciliação | Estado da tentativa |
| 11 | Drop encerrado / antes de abrir | Página visível; compra recusada (`EXCLUSIVE_DROP_CLOSED`) | Captura + API |
| 12 | Produto público (City Noise) sem código | Compra normal | Tentativa criada |
| 13 | Regressão STOCK | Suíte de homologação do STOCK sem alteração de resultado | Relatório |

Critério de bloqueio: qualquer compra de produto exclusivo sem grant válido, qualquer excesso de cota, qualquer código em texto puro (DB, log, e-mail) ou qualquer regressão no STOCK.
