# RC v6 de staging com loja navegável

## Decisão de modos

`PUBLIC_SITE_MODE` é uma configuração explícita e independente de `NODE_ENV`.
Sem valor ou com valor inválido, o backend fecha a loja. A publicação de staging
usa `PUBLIC_SITE_MODE=store`; produção usa `PUBLIC_SITE_MODE=coming-soon`.
No frontend, staging usa `VITE_DEPLOY_TARGET=staging`,
`VITE_API_URL=https://api-staging.l4ckos.com.br` e `VITE_SITE_MODE=store`.
Produção usa `VITE_DEPLOY_TARGET=production`, a API de produção e
`VITE_SITE_MODE=coming-soon`.

O modo visual do site não autoriza checkout. Em backend production-like,
`PUBLIC_CHECKOUT_ENABLED` precisa ser explicitamente `true`; ausente, inválido
ou `false`, bloqueia criação de pedido, replay de cobrança e endpoints REST de
cliente/checkout. A fase 1 de staging mantém `PUBLIC_CHECKOUT_ENABLED=false`.

## Compra permitida no RC

O checkout server-side rejeita produtos com `salesMode=PREORDER` com
`CHECKOUT_PREORDER_DISABLED`, antes de criar pedido, reserva ou cobrança. A
mesma regra vale para replay de tentativa que contenha snapshot histórico de
pré-venda. Produtos `STOCK` continuam navegáveis no catálogo e no carrinho;
nenhuma compra pública será autorizada na fase 1 porque o checkout está
desligado.

A identidade Clã 14 Bis continua protegida pelo contrato server-side de compra
pública e pela validação das variantes/reservas legadas. O fluxo administrativo
de criação de pedidos permanece desativado para criação direta.

## Variáveis de ambiente

### Railway staging — fase 1

- `NODE_ENV=production`
- `APP_ENV=staging`
- `PUBLIC_SITE_MODE=store`
- `PUBLIC_CHECKOUT_ENABLED=false`
- `ADMIN_EMAILS=<lista explícita de administradores autorizados>`
- `JWT_SECRET=<segredo forte exclusivo de staging>`
- `ASAAS_API_KEY` ausente e nenhuma credencial Asaas de produção
- `RESEND_API_KEY` ausente até a homologação de e-mail
- `MELHOR_ENVIO_TOKEN` ausente; cotação remota fica indisponível e não gera
  operação de frete

O fallback `admin@local.dev` existe somente fora de `NODE_ENV=production`.
Em produção, uma lista `ADMIN_EMAILS` ausente não concede acesso por e-mail e
gera aviso de inicialização. O allowlist de destinatários `STAGING_EMAIL_ALLOWLIST`
é controle de e-mail, não autorização de compradores.

### Vercel staging — fase 1

- Projeto e ambiente de staging verificados no painel antes da publicação
- `VITE_DEPLOY_TARGET=staging`
- `VITE_API_URL=https://api-staging.l4ckos.com.br`
- `VITE_SITE_MODE=store`
- proteção de preview/deployment habilitada para contas de teste autorizadas

O arquivo `vercel.json` local configura build e rewrite, mas não configura
proteção de acesso. Essa proteção deve ser verificada no painel. Ela não
protege chamadas diretas à API; o checkout continua bloqueado no backend.

### Fase 2 — depois dos gates financeiros

Somente após comprovar banco isolado, conta Asaas Sandbox, webhook de staging,
backups e recuperação:

- `PUBLIC_CHECKOUT_ENABLED=true`
- `ASAAS_ENV=sandbox`
- `ASAAS_API_URL=https://api-sandbox.asaas.com/v3`
- `ASAAS_CHECKOUT_BASE_URL=https://sandbox.asaas.com`
- `ASAAS_API_KEY` exclusivo do Sandbox e `ASAAS_WEBHOOK_TOKEN` exclusivo de
  staging
- `APP_ENV=staging`, `EMAIL_ENV=staging`, `EMAIL_MODE=restricted` e
  `STAGING_EMAIL_ALLOWLIST` com destinatários de teste explícitos
- credencial Melhor Envio de teste/sandbox, se disponível; caso contrário,
  somente operações simuladas

Antes de habilitar checkout na fase 2, ainda falta confirmar um allowlist
server-side de compradores de teste para a identidade real do serviço de
staging. `STAGING_EMAIL_ALLOWLIST` não deve ser reutilizado para esse fim.
Proteção Vercel, CORS e autenticação genérica não substituem esse controle.

## Idempotência e dados copiados

O identificador de tentativa é reduzido a hash de `userId` e
`checkoutAttemptId` dentro do banco atual. A busca de replay não contém um
identificador de ambiente independente. Portanto, copiar para staging um banco
com tentativas e pagamentos de produção pode devolver a URL de cobrança já
persistida para a mesma tentativa. O gate `PUBLIC_CHECKOUT_ENABLED=false`
impede esse replay na fase 1, mas não corrige uma cópia de dados. Antes da fase
2, provar que o banco é exclusivamente staging e reconciliar qualquer ordem,
pagamento, webhook inbox ou notificação preexistente. Não copiar dados
financeiros de produção para staging.

## Runner e schema

O release local usa `readReleaseManifest()` e `manifest-v6.json`, cuja última
entrada é `0025_product_variant_identity`. `manifest-v7.json` e a migration
0026 ficam fora deste candidato. O runner não os lê. O comando `scripts/database-schema.ts` valida alvo
local e rejeita conexão remota. O container Railway inicia `dist/index.js` e
não executa migrations automaticamente. O executor remoto antigo 0022 é
específico daquela janela e não é runner v6. Logo, um mecanismo remoto v6
compatível precisa ser identificado e revisado antes de qualquer migration de
staging.

## Gates de publicação

### Fase 1 — loja navegável, sem compras

1. Reexecutar no MySQL 8.4.11 o round trip de backup v6 e a suíte de checkout
   aprovada, usando schemas sintéticos novos. O destino de restore deve conter
   somente o singleton padrão de `homeHighlightSettings`; remover apenas essa
   linha no destino descartável, confirmar as tabelas vazias e então restaurar.
2. Confirmar contrato/fingerprint v6 e ledger no banco staging por consultas
   somente leitura e provar exclusividade do banco.
3. Revisar uma origem Git limpa com allowlist de arquivos; o worktree atual é
   intencionalmente sujo e não deve ser publicado diretamente.
4. Confirmar IDs Railway/Vercel, variáveis, domínio, CORS, serviço e banco sem
   inferir identidade a partir de nomes.
5. Confirmar runner remoto v6, backups recuperáveis e plano R0 de reversão.
6. Conferir filas de webhook/notificação e dados financeiros antes de iniciar
   o serviço; workers iniciam automaticamente no backend.
7. Conferir `ADMIN_EMAILS`, `JWT_SECRET`, cookies, autenticação e autorização.
8. Manter `PUBLIC_CHECKOUT_ENABLED=false`, nenhuma chave financeira/email de
   produção e acesso Vercel restrito aos homologadores.

### Fase 2 — transações sintéticas

Exige todos os gates da fase 1, conta Asaas Sandbox comprovada, webhook
apontado à API staging, allowlist server-side de compradores, política de
e-mail restrita, Melhor Envio simulado/teste, revalidação da idempotência e
aprovação específica. Não habilita pré-venda v7.

## Smoke tests pós-publicação

Na fase 1: verificar health/API, origem API de staging no navegador, home,
catálogo, detalhe de produto, carrinho, login, acesso negado a conta não
administradora, acesso administrativo autorizado, produtos/imagens/cupons/
relatórios sem operação financeira, tentativa de checkout bloqueada no cliente
e na API, endpoints REST legados bloqueados, PREORDER bloqueado e logs sem
chamadas financeiras. Confirmar que uma chamada direta à API não contorna o
gate de checkout.

Na fase 2: repetir checks de isolamento, usar somente comprador autorizado,
Asaas Sandbox e destinatários allowlisted, validar webhook, idempotência,
estoque/reservas e reconciliação. Pré-venda continua bloqueada até homologação
do contrato específico.

## Origem Git revisável

Não usar `git clean`, reset, stash indiscriminado ou adicionar o worktree
inteiro. Preparar um inventário por arquivo com quatro listas revisadas:
(1) mudanças necessárias ao RC v6; (2) migração/contrato/testes v7 e outras
funcionalidades futuras; (3) testes, harnesses e documentação usados apenas na
homologação; (4) artefatos temporários e alterações preexistentes. Depois criar
uma worktree candidata a partir do commit-base aprovado e transportar somente
a allowlist revisada. O worktree de desenvolvimento permanece intacto. Não
criar commit ou push sem autorização.
