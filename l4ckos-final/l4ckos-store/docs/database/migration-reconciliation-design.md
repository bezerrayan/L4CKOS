# L4CKOS — migration reconciliation design

Status: design para revisão de implementação. Nenhuma alteração de código, SQL de
migration ou history remoto está autorizada por este documento.

## 1. Estado atual

- Commit inspecionado: `0ee8987bc95e94daf81a40d6e70e6eabcd4931c9`.
- Parent funcional: `28910fcdc616a95ce522bbe9860f1911e96ff5e9`.
- Branch: `rc/review-request-scheduling`; início com rastreados limpos e apenas
  `.npmrc` não rastreado.
- Staging confirmado em 2026-09-27: projeto/serviço `l4ckos-staging`, projeto
  `2bb90c8e-eb65-43ee-826b-f93750f0499c`, environment interno `production`, API
  `https://api-staging.l4ckos.com.br`. Deployment observado:
  `db6f812b-abd2-4460-ac4c-0ee5ef46b239`.
- Produção real (`l4ckos-production`) não foi acessada e não está autorizada.
- Não existe history de migrations remoto. O journal local cobre somente
  `0000–0007`; há SQL `0000–0019`. Não executar essa cadeia no banco existente.
- Auditoria estrutural: MySQL 8.4.11, 25 tabelas, 303 colunas, 7 FKs e 10 CHECKs.
  `schema.ts` declara 23 tabelas e 227 colunas. A diferença inclui extensões
  existentes e a ausência de `asaasWebhookEvents`.
- `0016`: cinco campos de confirmação presentes; backfill não executado e não
  recomendado automaticamente. `orderEmailEvents` corresponde a `0018/0019` e
  possui quatro registros de evidência. Preservar todos.

Fontes: arquivos do commit acima; inventário read-only de 2026-09-27 às
15:30:18.473Z/15:33:42.794Z; agregados monetários às 15:54:56.148Z. Os artefatos de
auditoria estão temporariamente em `/tmp/l4ckos-migration-governance-audit.BZG8Bi/`.
Antes da implementação, versionar um manifesto estrutural sanitizado; `/tmp` não
é uma dependência durável nem substitui backup.

## 2. Contratos decididos

### A. Preço de item: OPTION A — `unitPrice` canônico

Adotar futuramente `orderItems.unitPrice int NOT NULL`, em centavos inteiros,
como snapshot do preço unitário da compra. Preservar a coluna física existente;
não renomear o banco para `price`, criar duas fontes monetárias ou copiar valores
automaticamente. O símbolo ORM passará a `unitPrice`; compatibilidade de `price`
será feita, quando necessária, no DTO/adapter, não por duas colunas ORM.

| Caminho atual | Evidência local e implicação |
| --- | --- |
| `drizzle/schema.ts:149–157`, `0001` e snapshots legados | Declaram `price`; nenhum schema/SQL local encontrado declara coexistência física com `unitPrice` |
| `server/routers/orders.ts:52–122,289–302` | Calcula subtotal com `products.price * quantity`, adiciona frete/desconto, grava `orders.totalPrice` e reservas; não insere `orderItems` |
| `server/db.ts:1124–1209,1290–1340` | Helpers de pedido não criam itens; reservas também não gravam snapshot de preço |
| `scripts/reset-test-orders.ts:216–230` | SELECT ORM referencia fisicamente `orderItems.price`; é um consumidor concreto incompatível com staging |
| `server/db.ts:2559–2677` | Backup usa `SELECT *` físico; restore usa INSERT ORM, atualmente declarado com `price`; não há adapter de round-trip para `unitPrice` |
| `server/db.ts:1238–1259,1762–1783`; `server/routers/orders.ts:160–173` | Leituras de itens do pedido usam reservas e JOIN com preço atual do produto, não snapshot de `orderItems` |
| `client/src/pages/AcompanharPedido.tsx:74,322`, `PedidoDetalhe.tsx:235` | Consomem `productPrice`; o admin usa nome/quantidade das reservas |
| `server/controllers/paymentController.ts:432–455` | Alerta interno formata preço atual do produto multiplicado pela quantidade |
| `server/routers/admin.ts:549–560`, `server/services/orderEmailDelivery.ts` | Delivery/review não leem preços de itens; o happy path não valida o contrato de itens |
| `server/emails/{components,helpers}/renderOrderItems.jsx`; `EmailOrderSummary.jsx` | Aceitam `price`/`unitPrice` como apresentação; isso não comprova coluna ou unidade física |
| `server/services/email/emailService.js:147–154` | Normaliza `price`/`formattedPrice` como texto; não preserva automaticamente um `unitPrice` numérico |

No código atual, o único INSERT ORM de `orderItems` encontrado é o restore. O
writer que originou a coluna e os dados anteriores não foi identificado no Git
local disponível. Os fixtures conhecidos usaram a coluna física; isso não prova
a origem das linhas anteriores. Os testes atuais de segurança rejeitam preços
fornecidos pelo cliente, mas não cobrem ainda o round-trip real de `orderItems`.

Agregados read-only do staging: 8 itens, 0 preços nulos/negativos, faixa de
100–9900 centavos, quantidade mínima/máxima 1, 0 totais de linha nulos ou
diferentes de `unitPrice * quantity`. Sete pedidos possuem itens e os sete totais
coincidem com a soma das linhas. Não foram consultados IDs ou dados pessoais.

Limite da evidência: quantidade 1 não prova multiplicação para quantidade >1;
coincidência dos totais não prova tratamento de frete/cupom. A unidade em centavos
é coerente com o código de catálogo/checkout e fixtures, mas a origem histórica
de todos os valores permanece desconhecida.

Contrato futuro de `orderItems.totalPrice`: nullable, preservado como snapshot
de total de linha; novas linhas, quando esse writer for implementado, devem
validar quantidade positiva e derivação `unitPrice * quantity` com aritmética
inteira e limites de INT. Não é coluna gerada hoje e nenhum writer atual comprova
sua derivação histórica. Não recalcular dados antigos nem substituir
`orders.totalPrice`, que inclui regras de frete/desconto. Preço textual de template
deve continuar sendo formatado explicitamente pelo adapter.

Riscos monetários: confundir centavos/reais, preço unitário/total de linha,
snapshot/preço atual, ou corrigir totais históricos pela soma sem descontos.
Testes futuros: quantidade >1, preço zero, frete/cupom, alteração posterior do
catálogo, limites/overflow e backup/restore em MySQL local. Persistir snapshots no
checkout é mudança funcional separada; não será embutida no DDL `0020`.

### B. Auditoria: `actorUserId` nullable + `actorType`

Adotar `actorUserId int NULL` e `actorType enum('admin','user','system') NOT NULL`,
preservando o default físico atual `admin` por compatibilidade. Novos writers
devem preencher `actorType` explicitamente, sem depender do default.

Todos os writers atuais encontrados usam um usuário identificado:
`createAuditLog` (`server/db.ts:2339`) recebe número; os routers admin passam
`ctx.user.id`; confirmação manual (`server/db.ts:1385`) grava o ator informado.
Webhook usa `asaasWebhookEvents` e confirmação financeira com responsável NULL,
mas não cria audit com ator NULL nesse caminho. Nenhum worker ou escritor
unauthenticated de `auditLogs` foi encontrado no RC.

Portanto os 11 NULLs existentes são preservados com proveniência desconhecida:
não afirmar que são system/webhook nem confiar no default `actorType=admin` como
prova histórica. Futuramente, audit de sistema terá `actorType=system`, ID NULL e
origem técnica sanitizada; admin/user exigirá ID autenticado no writer. Não criar
usuário artificial. Não aplicar CHECK retroativo antes de avaliar os históricos.
Uma requisição não autenticada não pode se declarar admin ou system pelo input;
eventos de segurança usam origem atribuída pelo servidor.

### C. Estoque: preservar/adotar `restocked` para compatibilidade

Adotar o quinto valor no enum declarativo futuro, sem habilitar uma nova transição
de estoque. Escritas locais observadas: criação `active`, liberação de reservas
anteriores `released`, confirmação `consumed`. Expiração é filtrada por
`expiresAt`; não foi encontrado writer de `expired` ou `restocked` neste RC.
Leituras gerais retornam status; consumo/disponibilidade filtram `active`.

Nenhum código/teste/histórico local identifica a semântica de `restocked`. A
auditoria anterior contou zero registros nesse estado, mas isso não autoriza
reduzir o enum. A interpretação de reposição após consumo é hipótese. Antes de
implementar devoluções, especificar a transição, a baixa/reposição atômica e a
proteção contra reposição dupla. `restocked` não será convertido para outro estado.

## 3. Objetos adotados

| Objeto | Classificação e decisão |
| --- | --- |
| `orderItems.unitPrice` e campos base do item | ADOPT_IN_SCHEMA; preço unitário em centavos, sem DDL monetário em staging |
| `orderItems.totalPrice` | ADOPT_IN_SCHEMA como snapshot nullable; sem backfill ou recalcular históricos |
| `auditLogs.actorUserId` nullable e `actorType` | ADOPT_IN_SCHEMA para representação explícita de identidade |
| `stockReservations.status` com `restocked` | ADOPT_IN_SCHEMA para preservação; regra funcional permanece pendente |
| `productImages.color varchar(60) NULL` | ADOPT_IN_SCHEMA; admin grava e normalizador lê; ProductDetail filtra galeria pela cor |
| `promoBanners.imageUrl`, `mobileImageUrl`, `linkUrl` (`varchar(500) NULL`), `imageAlt` (`varchar(255) NULL`) | ADOPT_IN_SCHEMA; CRUD admin, query pública e PromoCarousel usam imagem desktop/mobile, link e alt |
| `asaasWebhookEvents` | ADOPT_IN_SCHEMA; contrato atual exige a tabela ausente |
| `orderEmailEvents` completo (`0018/0019`) | ADOPT_IN_SCHEMA; preservar constraints, leases e evidências |

Os cinco campos de imagens/banners já aparecem no schema do commit `cd653e0`
(2026-03-28, importação/renomeação do workspace). Essa é a primeira presença
identificada no histórico disponível, não a data comprovada de criação no banco.
Nenhum SQL `0000–0019` os cria. O bootstrap novo deve incluí-los; não fabricar
execução retroativa. `replaceProductImages` possui fallback para schema antigo
que pode omitir cor/variantes: isso não substitui o contrato oficial completo.

## 4. Objetos legados preservados e objetos desconhecidos

Não há evidência suficiente para classificar as extensões financeiras como
LEGACY_BUT_PRESERVE. Essa classificação exige identificar substituição ou
descontinuação. Os SQL/journal `0000–0019` são artefatos legados preservados para
consulta histórica, não uma cadeia executável em bancos existentes.

| Objeto | Classificação | Evidência/decisão |
| --- | --- | --- |
| `payments` | UNKNOWN_REQUIRES_EVIDENCE | 31 campos/3 linhas na auditoria; nenhum repository/writer/leitor local encontrado; preservar PK, UNIQUEs, FK e CHECKs |
| `paymentEvents` | UNKNOWN_REQUIRES_EVIDENCE | 12 campos/6 linhas; nenhum uso atual encontrado; não substitui `asaasWebhookEvents` |
| `notificationOutbox` | UNKNOWN_REQUIRES_EVIDENCE | 16 campos/2 linhas; nenhum worker local encontrado; não substituir/fundir com outbox de pedidos nem despachar registros |
| `orders.checkoutAttemptId`, `checkoutFingerprint` | UNKNOWN_REQUIRES_EVIDENCE | Nenhum uso atual; preservar UNIQUE do attempt ID |
| `orders.fulfillmentStatus`, `fulfillmentIssue`, `fulfillmentIssueAt` | UNKNOWN_REQUIRES_EVIDENCE | Nenhum uso atual; `orders.status` permanece estado funcional, não sincronizar automaticamente dois estados |
| `orders.correlationId`, `couponId`, `couponReleasedAt` | UNKNOWN_REQUIRES_EVIDENCE | Checkout resolve cupom e incrementa uso, mas não grava essas colunas; preservar sem presumir reserva/release de cupom |
| `auditLogs.orderId`, `paymentId`, `event`, `correlationId`, `beforeState`, `afterState` | UNKNOWN_REQUIRES_EVIDENCE | Writers atuais usam `action/entity/entityId/metadata`; não convertem nem preenchem essas extensões |
| Extras de `orderItems`, `productVariants` e `stockReservations` | UNKNOWN_REQUIRES_EVIDENCE | Preservar variantes/snapshots/opções/referências e suas constraints até decisão de ownership |

Busca no código atual e nas referências Git locais disponíveis não encontrou a
implementação que criou as três tabelas. Linhas existentes comprovam uso anterior,
não escrita ativa. Ausência de writer no RC não exclui outro serviço/escritor.
A auditoria não encontrou triggers, rotinas ou eventos neste schema. Nesta etapa
não foram consultados conteúdo financeiro, logs externos ou serviços terceiros.

Decisão de preservação: oficializar um **manifesto físico de compatibilidade**,
separado do contrato de domínio ativo. Ele conterá exatamente as três tabelas,
colunas extras e constraints existentes. Incluí-las no bootstrap como estruturas
preservadas, sem repositories/workers ativos. Adotar um objeto no domínio ativo
exige evidência adicional; não torná-lo autoritativo para pagamentos por mera
existência. O comparador deve considerar domínio + manifesto preservado, nunca
emitir DROP por objetos omitidos do ORM. Na implementação, versionar definições
completas a partir dos metadados sanitizados antes de gerar SQL.

## 5. Baseline model

Baseline significa: “o schema físico identificado por este fingerprint foi
inspecionado e aceito nesta data, com estes contratos e objetos preservados”.
Nunca significa que `0000–0019` foram executadas.

O manifesto aceito deve identificar versão MySQL, charset/collation, tabelas,
tipos, nullability/defaults, enums, PK/UNIQUE/índices, FKs, CHECKs e exclusões
justificadas. Sua canonicalização ordena objetos e normaliza equivalências reais
(ex.: NOW/CURRENT_TIMESTAMP); exclui contador AUTO_INCREMENT, contagens de linhas
e dados. Nomes de índices diferentes só serão equivalentes mediante regra
explícita. O hash de domínio exclui tabelas de governança, cujo DDL terá validação
própria, evitando dependência circular.

Manter manifesto pré-reconciliação e pós-reconciliação. Registrar BASELINE somente
após comparação integral com o manifesto aprovado e assinatura/revisão humana;
não aceitar qualquer estado encontrado automaticamente.

## 6. Migration ledger design

| Estratégia | Avaliação |
| --- | --- |
| `__drizzle_migrations` | Compatível com migrator padrão, mas não distingue baseline/reconciliação; journal legado incompleto e timestamps não resolvem atestação/checksums completos |
| `_l4ckos_schema_migrations` | Escolhida: significado explícito, cadeia nova, preconditions/fingerprints e registros de execução real |
| Manifesto/Git sem ledger no banco | Necessário como evidência versionada, insuficiente sozinho para serialização e saber o que ocorreu no alvo |

Design da tabela, ainda sem SQL: `id` PK, `name` UNIQUE, `checksum` SHA-256,
`kind` (`BASELINE`, `MIGRATION`, `RECONCILIATION`), `appliedAt` UTC,
`applicationCommit` SHA completo, `description`, `preSchemaChecksum`,
`postSchemaChecksum`, `manifestVersion`. Para BASELINE, checksum é o manifesto;
para operações executadas, é o artefato SQL imutável. `appliedAt` de BASELINE é a
data de aceitação, não criação histórica do schema.

Runner dedicado: valida todos os checksums/hashes, usa manifest com ordem e
dependências explícitas e lock de execução único; identidade do alvo confirmada
antes de conectar. Não usar apenas MAX(id/timestamp). DDL pode fazer commit
implícito: guardar tentativas/statement checkpoints em trilha separada de execução
com STARTED/FAILED/COMPLETED e erro sanitizado. Essa trilha não representa migration
aplicada; ledger de sucesso só recebe registro após pós-condições completas.
Se falhar, parar e reconciliar o estado parcial mediante revisão; não reaplicar
statements automaticamente. Conferir resultado incerto antes de qualquer retry.

Bootstrap do ledger será uma ação de governança explicitamente autorizada com
DDL/checksum revisados e trilha externa de execução, não um preenchimento de
history antiga. O primeiro registro BASELINE poderá ser `baseline-v1-existing`:
schema pós-reconciliação inspecionado e aceito. Registrar também `0020` como
RECONCILIATION somente se seu DDL tiver sido realmente executado. Não criar 20
linhas retroativas. Nenhum uso concomitante de dois runners/history autoritativos.

## 7. Existing DB path

1. Confirmar alvo; obter novo inventário/fingerprint read-only e compará-lo ao
   pre-manifest revisado. Divergência desconhecida bloqueia execução.
2. Comprovar backup MySQL completo e restore em clone isolado, incluindo extensões,
   evidências e constraints. Backup JSON da aplicação não satisfaz esse requisito.
3. Validar mudanças locais de contrato ORM/DTO e round-trip, sem modificar dados.
   Simular reconciliação sobre clone local do schema e dados sintéticos.
4. Mediante autorização futura, inicializar governança controlada e executar
   somente a reconciliação aprovada; nenhuma migration legada por descoberta.
5. Comparar post-manifest integral, preservação de contagens e evidências/hash
   relevantes; só contagens não provam que os dados ficaram intactos.
6. Registrar execução real e aceitação BASELINE com seus checksums próprios.
7. A partir daí, aplicar somente migrations da nova linhagem com preconditions,
   lock e history verdadeiro. Deploy/smoke exigem fases próprias autorizadas.

Banco existente sem ledger nunca será tratado como banco vazio. Desconhecer um
schema exige inspeção, não bootstrap automático ou `db:push`.

## 8. Fresh DB path

Organização futura proposta, sem mover/criar SQL agora:

```text
drizzle/legacy/0000–0019 + meta legado (arquivo histórico, fora do runner novo)
database/schema/contract-v1.json + retained-objects-v1.json
database/bootstrap/v1 (DDL completo revisado para banco vazio)
database/migrations/0020_reconciliation (existing-only)
database/migrations/0021... (migrations comuns futuras)
database/lineage-manifest.json (ordem, caminhos e fingerprints aceitos)
```

Manter arquivos antigos imutáveis; a mudança futura de localização terá revisão
própria. O runner novo lê exclusivamente seu manifest, nunca o journal legado ou
um glob de todos os SQL. Drizzle Kit pode auxiliar geração offline em diretório
novo; não será executor autônomo de reconciliação ou remoção de extras.

`bootstrap v1` exige banco explicitamente vazio, cria o contrato oficial completo
e o manifesto físico preservado: 23 tabelas do domínio atual (com contratos
corrigidos), três tabelas extras preservadas, `asaasWebhookEvents`, outbox com
processingToken, campos de imagens/banners, FKs/CHECKs/índices adotados. A contagem
de negócio projetada é 26 tabelas antes de tabelas de governança; não é garantia
sem comparar todos os objetos. Criar pais antes dos filhos/FKs. Não adicionar FK
de productId que invalidaria fixtures productId=0 sem decisão separada.

Registrar somente bootstrap realmente executado e BASELINE aceito. Não registrar
`0020` como aplicada no banco novo: ela é existing-only. O manifest reconhece
dois caminhos que convergem ao mesmo post-fingerprint v1; `0021+` exige esse
baseline aceito, independente do caminho. Não inferir aplicação por número.

CI local futuro: MySQL 8.4 compatível, sem envs remotos, provider mockado e banco
vazio; executar bootstrap e extrair information_schema/SHOW CREATE. Comparar
schema normalizado com domínio + objetos preservados e validar ledger separado.
Comparar também clone pré-reconciliação após `0020` com o mesmo fingerprint.
Testar PK/AUTO_INCREMENT/UNIQUE/FKs/CHECKs, default/nullability/enums, preço com
quantidade >1, audits e outbox. Falhar por diferenças desconhecidas; não normalizar
diferença real para fazer o teste passar. Nenhum teste deve enviar e-mail.

## 9. Proposed 0020 scope

Recomendação: no schema staging atualmente auditado, **DDL de negócio limitado a
CREATE de `asaasWebhookEvents`**, com definição exata correspondente ao schema
atual/`0013`, sem reaplicar o arquivo antigo. `unitPrice`, audit nullable/actorType,
restocked e os cinco campos de imagens já existem: suas decisões requerem ajuste
de contrato local, não ALTER redundante. Outbox permanece integralmente intacta.

Criação do ledger/trilha de execução pertence ao bootstrap de governança e deve
ser revisada separadamente. `0020` não fará INSERT de business data; o runner
registrará apenas sua execução real após validar as pós-condições.

Preconditions: alvo staging inequívoco, backup/restore aprovado, ausência da
tabela de webhook, pre-fingerprint aprovado, contratos locais compatíveis,
preservação das extensões/constraints e ausência de execução concorrente. Se a
tabela já existir, inspecionar igualdade e decidir o caminho explicitamente;
não usar IF NOT EXISTS para ocultar divergência nem fingir criação executada.

Não incluir backfill financeiro, DELETE, DROP, renomear/copiar preços, alterações
de pedidos, resets/reclaim de outbox ou normalização de atores históricos. Se
novo inventário exigir outra alteração real, expandir escopo somente após revisar
design/preconditions, não por diff automático de Drizzle.

## 10. Backup/restore gaps

Exportação atual: `getBackupPayload`, `server/db.ts:2573`, usa 13 SELECTs físicos
em paralelo. Manual: `admin.backupManual`; automática: startup e intervalo de 24h
em `server/_core/index.ts:32–53`. Não há snapshot transacional global, exportação
de DDL/history nem restore comprovado neste contrato. Tabela ausente vira warning
e lista vazia; “backup criado” não significa completo. Fallback manual em `/tmp`
não garante persistência e pode divergir do diretório usado por list/restore.

| Classificação | Tabelas |
| --- | --- |
| COVERED — linhas, não DDL | `users`, `products`, `productVariants`, `productImages`, `orders`, `orderItems`, `coupons`, `productReviews`, `stockReservations`, `userProfiles`, `userAddresses`, `userPaymentMethods`, `auditLogs` |
| MISSING — presentes no staging | `cartItems`, `favorites`, `localAuthUsers`, `promoBanners`, `waitlist_emails`, `emailUnsubscribes`, `passwordResetTokens`, `productReviewUploads`, `payments`, `paymentEvents`, `notificationOutbox`, `orderEmailEvents` |
| MISSING — esperada/ausente no staging | `asaasWebhookEvents`; incluir quando criada |
| MISSING — governança futura | Ledger, trilha de execução e manifesto/fingerprint |

Restore atual (`server/db.ts:2629–2677`) é destrutivo, não possui transação global
e aceita arrays brutos para INSERT ORM. A ordem observada de DELETE é
orderItems → orders → productVariants → productImages → products → coupons →
productReviews → stockReservations → endereços/métodos/perfis → audits → users.

RESTORE_ORDER_RISK:

- `stockReservations.orderItemId` RESTRICT pode impedir DELETE de orderItems.
- `payments.orderId` e `stockReservations.orderId` RESTRICT podem impedir DELETE
  de orders; filhos não são removidos antes. `payments` nem integra o restore.
- FKs SET NULL de notificationOutbox/paymentEvents podem apagar vínculos de
  evidências caso pais sejam removidos; essas tabelas não integram o backup.
- Outbox de e-mail não possui FK: restaurar pedidos sem seus eventos perde a
  garantia persistente e pode reenviar ou associar evidência a IDs reutilizados.
- Dumps de itens usam `unitPrice`; restore ORM espera `price` e omite extras não
  declarados. O mesmo risco de perder extensões vale para outras tabelas.
- SELECTs independentes podem observar instantes diferentes sob escrita;
  falha após alguns DELETEs pode deixar restore parcial.

Classificação: cobertura/ordem/contrato confirmados no código; falha completa de
restore é LIKELY, dependente dos vínculos presentes, não reproduzida remotamente.

Antes da reconciliação, usar backup MySQL completo consistente, com DDL + dados
de todas as tabelas, acesso restrito e secrets/PII protegidos, checksum, retenção
fora do filesystem efêmero e teste de restore em clone isolado. Esse clone deve
ter provider/scheduler desabilitados e não inicializar dispatch de evidências.
Para restore lógico futuro, derivar ordem pelo grafo FK: filhos antes de pais
para remoção, pais antes de filhos para inserção; incluir todos os objetos,
preservar IDs e testar idempotência. Não contornar com FK_CHECKS=0 como correção
geral. Backups/restore e governança são mudanças próprias, não parte implícita da
`0020`. Rollback compensatório terá preconditions e só poderá remover tabela de
webhook recém-criada se vazia e sem consumidores ativos; dados relevantes exigem
preservação/recuperação. Não prometer rollback transacional de DDL MySQL.

## 11. Production prerequisites

Produção não foi acessada; não assumir o mesmo drift ou autorizar produção com
este design. Antes de qualquer ação futura: autorização específica para alvo e
ação; inventário read-only próprio; identidade, versão/modos/collation, schema
completo, history real, constraints, agregados de integridade, writers/owners,
volume/locks e impacto de DDL; backup completo e restore comprovado; plano de
recuperação e janela aprovada. Design/migration de produção dependerão dessa
evidência, não do fingerprint staging. Asaas sandbox permanece obrigatório na
homologação; nenhum endpoint financeiro foi chamado nesta análise.

## 12. Open questions e gates de implementação

1. Quem criou/escreveu payments/paymentEvents/notificationOutbox e extensões?
   Obter fonte/versionamento/owner; até lá preservar no manifesto físico e não
   ativar fluxo financeiro. Não rotular como legado comprovado.
2. Qual origem dos audits com actorUserId NULL? Avaliar evidência sanitizada numa
   etapa própria; manter NULL e tipos históricos sem correção automática.
3. Qual semântica de restocked e quem a escreve? Preservação declarativa decidida;
   regras de devolução/reposição dependem de evidência funcional.
4. Validar preço histórico para quantidade >1 e regras de frete/cupom em testes
   locais; agregados atuais não abrangem essas situações.
5. Definir/adotar owners para todos os objetos retidos e versionar suas definições
   completas antes do bootstrap. Proveniência desconhecida não autoriza DROP.
6. Aprovar o modelo de ledger/runner, manifestos e backup completo antes de
   implementação/aplicação. Nenhum migration SQL/runner foi criado nesta etapa.

O design está pronto para revisão de implementação. As perguntas acima limitam
adoção funcional das extensões e autorização de execução, mas não impedem
implementar preservação estrutural, adapters locais e testes de convergência.
