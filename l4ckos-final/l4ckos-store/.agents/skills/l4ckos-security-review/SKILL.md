---
name: l4ckos-security-review
description: Faz revisão prática e proporcional de segurança L4CKOS. Use em mudanças de auth, admin, pagamentos/webhooks, uploads/storage, secrets, sessões/cookies, banco/migrations, e-mail, APIs públicas, input, arquivos ou infraestrutura.
---

# Revisão de segurança

Revise o diff e os caminhos afetados; escolha os controles pertinentes abaixo. Não gere relatório extenso automaticamente nem transforme revisão local em pentest remoto. Acesso remoto segue [l4ckos-staging-safety](../l4ckos-staging-safety/SKILL.md); teste ativo de segurança segue [l4ckos-pentest-staging](../l4ckos-pentest-staging/SKILL.md) somente mediante pedido explícito.

## Controles por superfície

- Identidade: autenticação (authn), autorização (authz), ownership do objeto e limites de privilégio, inclusive admin e acesso cruzado entre usuários.
- Entrada/saída: validação server-side, output encoding, SQL/query safety, SSRF, path traversal e validação de upload (tipo, tamanho, destino, execução/acesso).
- Fluxos de negócio: autenticidade de webhook, replay, integridade do estado de pagamento, concorrência/race conditions e idempotência.
- Sessão/API: rate limiting, CORS, CSRF quando aplicável, flags/expiração/invalidação de cookies e sessões, vazamento por erros.
- Dados/infra: exposição de secrets, logs sensíveis, dependências/configuração expostas, permissões de arquivos/storage, migrations destrutivas, backup e restore verificáveis.

## Evidência e decisão

Priorize exploração plausível → impacto real → evidência → correção mínima → teste de regressão. Trace da entrada controlável até a operação sensível; registre controles existentes e pré-condições. Não declare vulnerabilidade só por hipótese.

Classifique cada achado relevante:

- **CONFIRMED**: caminho/impacto demonstrado por reprodução segura ou evidência inequívoca no código; indique qual.
- **LIKELY**: evidência concreta, mas falta uma condição/verificação identificada para confirmar.
- **HARDENING**: redução de risco sem vulnerabilidade demonstrada.
- **NOT REPRODUCED**: tentativa delimitada não reproduziu o problema; não é prova de ausência.

Reporte somente achados pertinentes, localização, evidência sanitizada, impacto, severidade justificada e próximo passo. Diferencie diagnóstico de autorização para corrigir. Quando a correção estiver no escopo, prefira a menor mudança e um teste que reproduza o problema.
