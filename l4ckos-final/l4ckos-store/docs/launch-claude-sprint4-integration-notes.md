# Sprint 4 (Claude) — notas de integração para o Codex

Branch `launch/claude-checkout`. Apenas `client/` e testes; nenhum schema, migration, backend financeiro ou infra alterado.

## Commits a incorporar (ordem)
1. `fix(cart): keep cookie banner from covering the drawer checkout button`
2. `fix(checkout): consult backend before any new attempt; rotate expired attemptId`
3. `test(cart): enforce stock per variant within the same product`
4. `style(mobile): compact cookie banner and 44px touch targets`

## Riscos que dependem do servidor (não implementados no cliente)
- **`stockCheckout.create` não deduplica por dono + conteúdo.** Um `attemptId` novo com o mesmo carrinho cria nova reserva e nova cobrança. O cliente agora consulta `resumeLatest` antes de permitir um id novo, mas a proteção definitiva é do servidor (ex.: rejeitar/reaproveitar `create` quando o dono já tem tentativa aberta com o mesmo fingerprint). Recomendado.
- `resumeLatest` devolve a tentativa mais recente de qualquer status/carrinho; o cliente só trata como bloqueante `reserved|creating|pending|ambiguous`. Um filtro por status aberto no servidor simplificaria o contrato.
- Fingerprint local cobre só itens; o do servidor inclui `delivery`. Reenviar o mesmo `attemptId` com endereço alterado gera `CHECKOUT_ATTEMPT_NOT_REUSABLE` (seguro, mas o usuário fica preso à reserva antiga até expirar).
- Se o runtime não expuser `resumeLatest` (`SERVICE_UNAVAILABLE`), o cliente falha fechado: bloqueia o checkout com carrinho cheio e sem id local.
