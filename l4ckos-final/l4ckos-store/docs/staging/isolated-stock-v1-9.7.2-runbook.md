# Homologação isolada STOCK V1 em MySQL 9.7.2

Status: preparação local; nenhuma escrita remota está autorizada ou foi executada.
SHA-base da candidata: `1ea69c2f858a96a5c9fcb2a06b0a94b9b548b9e0`.

## Decisão e isolamento

- Preservar o projeto, a API, o banco MySQL 8.4 persistente e o alias Vercel
  existentes.
- Provisionar um alvo separado para homologação STOCK, com uma instância API,
  um banco MySQL 9.7.2 dedicado e volumes próprios. Não compartilhar `DATABASE_URL`,
  banco, volume, credencial ou alias com o staging atual ou com produção.
- Preferência operacional: projeto Railway e projeto Vercel próprios para a
  homologação STOCK. O preview Vercel deve exigir SSO, apontar para a API nova e
  não receber o alias `staging.l4ckos.com.br`.
- O SHA acima é local. Antes de criar preview Git rastreável, publicá-lo na
  origem conectada mediante autorização específica e confirmar que o checkout
  remoto do SHA é idêntico ao commit local.
- O build staging requer `VITE_API_URL` e
  `VITE_STAGING_API_ALLOWED_ORIGINS`. O valor de API precisa ser uma origem HTTPS
  exata incluída na allowlist; não aceita caminho, credenciais, query ou
  fragmento. A allowlist não pode incluir a API de produção nem
  `api-staging.l4ckos.com.br`. Não há destino padrão. Configure a origem gerada
  pelo API isolado depois de provisioná-lo e validar o serviço.

## Ordem exata de schema e migrations

O caminho V6 é:

1. Schema físico V6 auditado (`server/database/fixtures/audited-schema.json`),
   mais a cadeia V6 `0020`–`0025` quando o alvo estiver sendo construído vazio.
2. `database/migrations/stock-v1/v6/0027_stock_v1_on_v6_lineage.sql` — variante
   V6-aware.
3. `database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql`.

**Não executar** `database/migrations/stock-v1/0027_stock_v1_incremental.sql`
nesse caminho. Esse arquivo é legado e incompatível com a linhagem V6.

Antes de qualquer DDL, confirmar por consulta somente leitura: versão `9.7.2`,
nome do schema esperado, fingerprint V6, tabelas/colunas/índices/FKs/CHECKs de
`0025`, ausência de DDL STOCK parcial e histórico conhecido. A aplicação remota
das migrations precisa de autorização própria e operador capaz de parar no
primeiro erro. O executor de migrations não deve iniciar com o app.

Validação local já disponível:

```sh
bash database/migrations/stock-v1/run-v6-chain-mysql97-test.sh
bash scripts/run-stock-mysql-tests.sh
```

Ambos usam containers descartáveis locais. O primeiro verifica baseline
V6→0027 V6-aware→0028, replay e falhas fechadas; o segundo valida a aplicação
STOCK/Drops em MySQL 9.7.2.

## Configuração mínima por serviço

### Preview Vercel

- `VITE_DEPLOY_TARGET=staging`.
- `VITE_API_URL` deve ser a origem HTTPS do serviço API isolado.
- `VITE_STAGING_API_ALLOWED_ORIGINS` deve incluir exatamente essa origem. A
  validação bloqueia origens não listadas, API de produção e o host do serviço
  staging atual; não há fallback. Exemplo de execução local sintética (use o
  hostname real só após provisionamento aprovado):

  ```sh
  VITE_DEPLOY_TARGET=staging \
  VITE_API_URL=https://stock-v1-api.example.invalid \
  VITE_STAGING_API_ALLOWED_ORIGINS=https://stock-v1-api.example.invalid \
  VITE_SITE_MODE=store pnpm build
  ```

  Defina as duas variáveis de origem no target Vercel Preview específico; não
  altere Production/alias do projeto Vercel atual. Build de preview deve ter
  SSO e origem CORS precisa ser explicitamente autorizada no API.

### API STOCK

- `APP_ENV=staging`, `NODE_ENV=production`.
- `STOCK_RUNTIME_ENABLED=true` somente depois de validar o banco.
- `STOCK_DATABASE_ENV=staging` e `STOCK_EXPECTED_DATABASE` com o nome exato do
  schema dedicado.
- `STOCK_CHECKOUT_ENABLED=false` até autorização separada de homologação de
  compras; `PUBLIC_CHECKOUT_ENABLED=false` e `CHECKOUT_ENABLED=false` mantêm a
  venda pública fechada.
- `DATABASE_URL` aponta exclusivamente ao novo MySQL. Não usar referências a
  serviços de produção nem ao MySQL 8.4 atual.

### TLS do MySQL

- `STAGING_DB_TLS_HOST` igual ao hostname contido em `DATABASE_URL`.
- `STAGING_DB_TLS_CA_PEM` contém a CA aprovada do serviço isolado.
- `STAGING_DB_TLS_CA_SHA256` é o SHA-256 calculado sobre o PEM exato.
- Exigir `rejectUnauthorized=true` e `verifyIdentity=true`; o boot STOCK também
  compara `DATABASE()` e `VERSION()` com o nome esperado e `9.7.2`.
- Antes de liberar conexões da API, configurar no `mysqld` certificado de servidor
  assinado pela CA staging, com SAN correspondente ao hostname privado Railway
  efetivamente usado por `DATABASE_URL`, chave privada exclusiva e
  `require_secure_transport=ON`. Não usar os certificados self-signed gerados
  automaticamente pelo MySQL, pois não atendem à verificação de identidade do
  hostname. Distribuir a CA ao API como secret e conferir SHA-256/hostname no
  preflight.

## Serviços e limites sugeridos

- `mysql-stock-homologation`: imagem pública `mysql:9.7.2`, volume dedicado de
  5 GB em `/var/lib/mysql`, limite de 1 vCPU e 2 GB RAM, sem domínio público e
  sem TCP Proxy; acesso somente pela rede privada Railway.
- `api-stock-homologation`: SHA de aplicação aprovado, 0,5 vCPU e 1 GB RAM,
  domínio HTTPS Railway necessário ao browser, sem alias compartilhado. A API
  deve manter checkout fechado e exigir gate server-side restrito para testes.
  SSO do preview Vercel e CORS não protegem a chamada direta à API.
- Custo de referência para mês inteiro no limite de CPU/RAM: aproximadamente
  US$ 60,75 em recursos (1,5 vCPU × US$ 20 + 3 GB RAM × US$ 10 + volume 5 GB ×
  US$ 0,15), mais egress/subscription; uso real de CPU é faturado por consumo,
  e créditos/limites do plano da conta são desconhecidos. Confirmar no dashboard
  antes de provisionar. O volume 5 GB respeita o teto Hobby documentado.
- Depois da homologação, desligar/retirar o domínio da API, exportar evidências,
  fazer dump final sintético se necessário, destruir a instância API, MySQL e
  volume somente com autorização de limpeza; confirmar remoção do volume, pois
  apagar deployment não necessariamente apaga o volume.

### Frete

- `STOCK_SHIPPING_SIGNING_SECRET` exclusivo deste ambiente, gerado por CSPRNG e
  com pelo menos 32 bytes; armazenar no secret manager, nunca no repositório ou
  logs.

### Asaas sandbox e webhook

- `ASAAS_ENV=sandbox`.
- `ASAAS_API_URL=https://api-sandbox.asaas.com/v3` e
  `ASAAS_CHECKOUT_BASE_URL=https://sandbox.asaas.com`.
- `ASAAS_API_KEY` exclusivamente sandbox.
- `ASAAS_WEBHOOK_TOKEN` exclusivo deste ambiente; webhook só recebe eventos
  autenticados. Configurar `ASAAS_WEBHOOK_INBOUND_ENABLED=true` depois de testar
  a rota autenticada.
- Nunca usar chave, endpoint ou token financeiro de produção.

### E-mail e workers

- `EMAIL_ENV=staging`, `EMAIL_MODE=restricted`, `STAGING_EMAIL_ALLOWLIST` somente
  com endereços sintéticos explicitamente aprovados e `RESEND_API_KEY` restrita
  ao ambiente de teste.
- `PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED=false` e
  `ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED=false` até o operador habilitar cada
  worker após a verificação dos dados sintéticos e do rollback.
- Nenhum envio nesta preparação. `RESEND_API_KEY` e valores de destinatários
  não devem aparecer em saídas ou logs.

## Backup e restauração

1. Criar o serviço 9.7.2 vazio, conferir identidade e guardar backup/snapshot
   anterior à primeira alteração persistente.
2. Construir/restaurar somente baseline V6 autorizado e sintético. Não clonar
   dados financeiros ou pessoais de produção; não copiar cegamente o banco
   persistente 8.4 atual.
3. Testar a restauração do backup pré-migration em outra instância descartável
   9.7.2; verificar identidade, fingerprint e contagens de fixtures.
4. Após 0027/0028, criar backup pós-migration e testar restauração também em
   instância descartável. Guardar checksums e relatório sanitizado.
5. Se qualquer restauração falhar, manter checkout fechado e não avançar.

## Deploy e homologação — autorizações separadas

1. **Provisionamento:** autorização para criar o projeto/serviços isolados e
   volumes Railway, e o projeto/preview Vercel protegido. Não modificar o
   serviço ou alias atuais.
2. **Configuração:** autorização para configurar variáveis e segredos via
   secret manager, sem mostrar seus valores. Conferir flags fechadas e URLs de
   sandbox.
3. **Backup:** autorização para produzir snapshot/backup e executar restauração
   de teste nos alvos isolados.
4. **Migrations:** autorização específica para executar a sequência V6-aware
   `0027` e depois `0028` no MySQL isolado após aprovação da attestation e do
   backup restaurável.
5. **Deploy:** autorização específica para publicar API do SHA rastreável e
   preview Vercel protegido do mesmo SHA, sem promover domínio existente. A
   origem API do preview precisa ser a origem HTTPS do serviço isolado e estar
   incluída exatamente em `VITE_STAGING_API_ALLOWED_ORIGINS`.
6. **Smoke sem compra:** health, verificação TLS/versão/schema, endpoint de
   webhook inválido rejeitado, catálogo e painel admin; comprovar API de compra
   fechada.
7. **Compra sandbox:** requer autorização adicional para abrir temporariamente
   um caminho de teste privado server-side. SSO Vercel, CORS e allowlist de
   e-mails não protegem a API direta. Se não houver gate privado de compradores,
   não habilitar `PUBLIC_CHECKOUT_ENABLED`.
8. Com o gate privado confirmado: testar pedido público sintético e XIV Bis,
   cotação assinada, cobrança sandbox, pagamento pendente/aprovado/cancelado,
   webhook autenticado repetido/fora de ordem, concorrência, estoque e painel.
   Confirmar consumo do outbox e notificações restritas sem dados reais.
9. Desligar flags de compra e workers ao fim; confirmar health e que a API
   pública continua recusando criação de pedido.

## Rollback

- Antes de migration: cancelar a janela; não há estado remoto para reverter.
- Depois de DDL completo, antes de habilitar compras: desabilitar runtime STOCK,
  restaurar a API e o conjunto de variáveis anteriores da instância nova; manter
  schema e evidências para revisão. Não executar reverse DDL.
- Em DDL parcial: parar writes, preservar banco/logs, coletar attestation e
  restaurar somente o backup pré-migration no serviço isolado mediante aprovação
  específica. Não reparar ou repetir SQL automaticamente.
- Depois de qualquer cobrança sandbox: fechar compras, reconciliar pagamentos,
  webhooks e reservas antes de rollback. O serviço e o volume 8.4 existentes e o
  alias `staging.l4ckos.com.br` permanecem intactos durante todo o procedimento.
