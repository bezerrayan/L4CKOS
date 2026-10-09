# Fechamento funcional 01/04 — fabricação, postagem e entrega

## Revisão vigente — cronograma manual por lote (09/10/2026)

**Veredito: APTO PARA STAGING**, para revisão e posterior homologação autorizada. Implementação local concluída; nada publicado. Esta seção substitui as ressalvas técnicas da revisão anterior reproduzida abaixo: cadastro de fabricação implementado e dois testes de empacotamento agora executados.

### 1. Diagnóstico e solução

A estrutura anterior possuía janelas de venda/postagem e marcos reais de produção, mas não o compromisso estimado de fabricação. Foram adicionadas duas datas civis manuais por lote, sem duração fixa, derivação da postagem, backfill fictício ou mudança automática de status. A mesma comunicação distingue fabricação, postagem e transporte no produto, sacola, checkout, confirmação, e-mail de pagamento, detalhe e acompanhamento do pedido. Componentes e estilos existentes foram reutilizados.

Preservadas todas as correções locais anteriores de capacidade, prazos vencidos, indisponibilidade de frete, cotações obsoletas e histórico. O worktree estava **sujo** no início desta implementação: 19 arquivos rastreados modificados e três novos da revisão anterior. Nenhuma alteração prévia foi descartada. Branch e HEAD principal permanecem `feat/preorder-batch` / `f519c11e94e57f76522db11f04254c5c17874598`.

### 2. Estrutura de dados e validações

| Entidade | Campo | Semântica |
| --- | --- | --- |
| `productionBatches` | `estimatedManufacturingStart`, `estimatedManufacturingEnd` | `DATE NULL`, datas civis `AAAA-MM-DD` de Brasília, cadastradas pelo administrador |
| `productionBatches` | `manufacturingScheduleRequired` | Marcador interno: zero para lotes já existentes na migration, default um para novos; não aceito na API de edição |
| `orderItems` | `estimatedManufacturingStartAtPurchase`, `estimatedManufacturingEndAtPurchase` | `DATE NULL`, snapshots imutáveis de compra |

- Datas inválidas/impossíveis, par incompleto e início posterior ao término são rejeitados com mensagens específicas. Mesmo dia é permitido, sem inventar horário intra-dia.
- Postagem configurada, tanto início quanto fim, não pode ser anterior ao **dia de Brasília** do término da fabricação. Instantes UTC/offset de postagem são convertidos para Brasília apenas para esta comparação. Testados os limites `02:59:59Z` e `03:00:00Z`.
- Inputs de fabricação são `type=date`, explicitamente rotulados como data de Brasília; não passam por conversão automática para timestamp. Vendas/postagem continuam no contrato preexistente de timestamps, com inputs explicitamente UTC e explicação do fuso. O calendário UTC exibido para postagem histórica foi mantido, sem reinterpretar compras antigas.
- Novos rascunhos podem ser cadastrados incompletos, mas não podem transitar para `OPEN` sem o período. Um novo lote já aberto não pode ter o período apagado. Lotes anteriores com marcador zero continuam gerenciáveis/abríveis sem fabricação; caso cadastrada, a janela também deve ser válida. Nenhum pedido antigo é invalidado.
- Clientes administrativos antigos que omitam ambos os campos não apagam dados existentes: a edição faz merge sob o lock, valida o estado efetivo e audita esse estado.
- Datas vencidas não são avançadas automaticamente: o catálogo informa cronograma aguardando atualização. Histórico continua mostrando o período original.

### 3. Histórico, auditoria e integridade funcional

O checkout congela fabricação junto dos snapshots existentes, dentro da transação e locks já homologados. Mudanças administrativas não atualizam `orderItems`; o acompanhamento distingue previsão atual de compromisso registrado na compra. A comparação de snapshots após cotação também detecta mudança de cronograma durante o checkout. Repetições idempotentes preservam a compra original e não cobram novamente.

Reutilizados `batch.created`/`batch.edited` e eventos de transição na auditoria. Nenhuma notificação automática de alteração de cronograma foi introduzida. E-mails transacionais existentes recebem a fabricação **registrada na compra**, com escaping dos templates React Email. Em `paymentController.ts` e `admin.ts` houve somente complementação do payload do e-mail, sem mudar autenticação, processamento financeiro, idempotência, webhook ou outbox.

Regressões MySQL e mocks confirmam capacidade compartilhada, pedidos pendentes, pagamento sem duplicar reserva, cancelamento, concorrência, lotes ilimitados, STOCK, pedidos mistos, propriedade dos pedidos, valores de frete validados no backend e etapas de produção. Nenhum pedido real, cobrança, etiqueta ou envio externo foi criado; o pedido real #12 não foi acessado. Identificadores 12 em logs da suíte são mocks sintéticos.

### 4. Migração e artefatos

Nova migration incremental: `database/migrations/0022_preorder_manufacturing_schedule.sql`. Checksum SHA-256: `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`.

A migration adiciona colunas nulas, grava marcador zero nos lotes existentes pelo default inicial e então muda apenas o default para um. Não preenche datas, não altera valores/status/reservas e não edita migrations já aplicadas. Executada somente em schemas MySQL 8.4.11 locais sintéticos, com replay e backup/restore verificados.

Contrato v3 é um delta aditivo verificável de cinco colunas sobre o contrato v2 imutável. Bootstrap v3 reutiliza tabelas v2 não alteradas e dois novos artefatos SQL. Fingerprint final: `a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e`; predecessor v2: `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a`.

`manifest-v3.json` de migrations contém a linhagem operacional 0021 + 0022. Seu `version: 2` é a versão do formato do runner, não a versão do schema. `db:migrate` local e bootstrap operacional usam essa linhagem explicitamente. O manifesto original e os executores fixos de staging 0020/0021 permanecem intactos: **não aplicar 0022 pelo comando fixo `db:staging:preorder:apply`** nem remover proteções para reutilizá-lo.

### 5. Testes e resultados

Runtime Node **22.23.2**, pnpm/lockfile existentes; nenhuma dependência adicionada.

| Gate final | Resultado |
| --- | --- |
| Suíte Vitest completa, sem exclusões | **41 arquivos, 429 testes aprovados; zero falhas, zero ignorados** |
| `manufacturingSchedule.test.ts` | 12 aprovados: datas, consistência, UTC/Brasília, legado, componentes reais, mistos e e-mail renderizado |
| `preorder.mysql.test.ts` | 56 aprovados: inclui novos cadastros, edição/auditoria, snapshots e migração de legado |
| `checkout.mysql.test.ts` | 22 aprovados: integridade STOCK, snapshots, replay, rollback e backup |
| `preorderUi.test.ts` | 16 aprovados em Chromium: formulário administrativo real, produto, sacola, checkout, histórico e acompanhamento |
| `shippingDeadlines.test.ts` | 23 aprovados; demais regressões incluídas no total, sem somar novamente |
| `stagingTransport.test.ts` + `staging0021Transport.test.ts` | 18 aprovados, incluindo os dois probes de empacotamento anteriormente ausentes |
| `pnpm check` | PASS, TypeScript cliente e servidor |
| `pnpm build` | PASS, Vite e esbuild |
| `git diff --check` | PASS, saída vazia |

As execuções intermediárias identificaram uma consulta de teste usando `batch.update` em vez de `batch.edited`, e uma espera do navegador por aviso já ocultado após o formulário fechar. Ajustados os testes e a auditoria do estado efetivo; a execução final acima passou. Não se apresentam aquelas execuções parciais como aprovação.

Comando da suíte completa, na cópia temporária isolada:

```bash
env DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store \
  PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
  L4CKOS_MYSQL_TEST=1 \
  L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock \
  pnpm exec vitest run
```

Empacotamento: cópia `/tmp/l4ckos-manufacturing-release-1Bu913`, 618 arquivos rastreados e novos copiados, conteúdo conferido por SHA-256, sem `.env`/`.npmrc` local. Árvore Git sintética `bef09ff4f4cc64e4ac818a5ea96890a938b99dff`, objeto de referência `b5e3c08262731de1c62da25f9f21357577c94431`, origem limpa. Usado plumbing Git somente nessa cópia, sem executar `git commit`, hooks, push ou alterar HEAD/índice/histórico principal. Dependências locais reutilizadas por symlink ignorado. Os probes executam bundles localmente com CLI/transporte mockados, sem Railway, SSH, DB remoto ou rede.

Os dois casos têm nome exato **“builds the exact Git bundle and executes it locally, without any DB/SSH/network access”**, um em cada arquivo de transporte. Foram incluídos na suíte completa e reexecutados separadamente para evidência. Nenhum caso foi ignorado. Não executados: homologação remota, integrações reais Asaas/Melhor Envio/Resend, entrega em caixa postal e benchmark de carga. Não equivalem a testes aprovados.

### 6. Inventário de alterações

Diff acumulado contra HEAD: **29 arquivos rastreados, 552 inserções e 173 remoções**, além de **10 arquivos novos**. Inclui o trabalho prévio preservado, não apenas esta implementação. Nenhuma formatação global, alteração de CSS, dependência ou reformulação visual.

- Compartilhado/schema: `shared/preorder.ts`, `drizzle/schema.ts`.
- Frontend rastreado: `client/src/components/CartDrawer.tsx`, `client/src/components/PreorderInfo.tsx`, `client/src/components/admin/batches/AdminBatches.tsx`, `client/src/pages/AcompanharPedido.tsx`, `client/src/pages/FAQs.tsx`, `client/src/pages/MeusPedidos.tsx`, `client/src/pages/Pagamento.tsx`, `client/src/pages/PedidoDetalhe.tsx`, `client/src/pages/ProductDetail.tsx`.
- Backend rastreado: `server/database/checkout.ts`, `server/database/productionBatches.ts`, `server/db.ts`, `server/routers/orders.ts`, `server/routers/admin.ts`, `server/controllers/paymentController.ts`, `server/services/shippingService.ts`, `server/services/email/emailService.js`, `server/services/emailService.d.ts`, `server/emails/transactional/OrderCreated.jsx`, `server/emails/transactional/PaymentApproved.jsx`.
- Governança rastreada: `database/bootstrap/bootstrap.ts`, `database/migrations/runner.ts`, `database/schema/artifacts.ts`, `scripts/database-schema.ts`.
- Testes rastreados: `server/database/checkout.mysql.test.ts`, `server/database/preorder.mysql.test.ts`, `server/database/preorderUi.test.ts`.
- Novos desta implementação: `database/migrations/0022_preorder_manufacturing_schedule.sql`, `database/migrations/manifest-v3.json`, `database/bootstrap/manifest-v3.json`, `database/bootstrap/v3/orderItems.sql`, `database/bootstrap/v3/productionBatches.sql`, `database/schema/contract-v3.json`, `server/database/manufacturingSchedule.test.ts`.
- Novos anteriores preservados: `server/database/orderShippingSnapshot.ts`, `server/database/shippingDeadlines.test.ts`, este relatório.

### 7. Publicação futura restrita ao staging e rollback

Necessárias **migration, backend e frontend**, após autorização explícita. Sequência segura:

1. Revisar diff e artefatos, preparar origem limpa autorizada e identificar inequivocamente staging. Fazer backup e provar restore isolado; conferir fingerprint v2, ledger e checksums. Suspender alterações administrativas de lote durante a janela.
2. Preparar execução **específica da 0022** com a governança de staging e autorização próprias. O CLI `db:migrate` desta entrega continua **somente local**; não substituir sua URL por remota nem contornar seus guards. Nenhum executor remoto da 0022 foi implementado/autorizado nesta tarefa. Migration MySQL usa DDL com commits implícitos: falha parcial exige inspeção/recovery, não retry cego.
3. Aplicar 0022 pelo fluxo futuro revisado, verificar fingerprint v3, dados preservados e marcador dos lotes legados. Backend antigo tolera as colunas adicionais; não expor backend novo antes do schema, pois suas consultas usam as colunas novas.
4. Publicar backend (serviços, routers, shared, schema e templates) e então frontend. API é aditiva; frontend anterior continua funcionando, mas não cadastra fabricação, portanto não pode abrir novos lotes sem as datas exigidas. Não operar novos lotes nessa janela.
5. Homologar rascunho válido/inválido, impedimento de abertura sem fabricação, edição auditada e legado; produto/sacola/checkout; compra sintética Sandbox autorizada e snapshots; mudança posterior distinguida do original; misto e lotes distintos; transporte/local; capacidade/concorrência e STOCK. Nunca usar ou alterar o pedido #12. Compras, cobrança Sandbox e envio externo dependem de autorização futura, não desta entrega.

Rollback: voltar frontend e backend aos artefatos comprovadamente bons, mantendo as colunas aditivas e todos os snapshots/ledgers/auditorias. Não executar DROP/backfill/reembolso nem repetir cobranças, webhooks ou e-mails. O backend anterior ignora as novas colunas, mas não impõe a nova obrigatoriedade: manter criação/abertura de lotes suspensa enquanto ele estiver ativo. Confirmar novamente schema, saúde e histórico após rollback autorizado.

### 8. Compatibilidade, pendências e riscos

- Lotes/pedidos históricos permanecem com fabricação desconhecida; nenhum compromisso foi inventado. Novas compras de lotes legados sem período registram essa ausência explicitamente.
- Calendário de postagem legado permanece UTC, explicitamente identificado no admin; migrar essa semântica para datas civis exige decisão/versionamento separados. A comparação com fabricação usa Brasília de forma explícita.
- Aviso proativo de alteração de cronograma, margem fornecedor/preparação, eventual fechamento por previsão vencida e remessas fracionadas continuam decisões comerciais pendentes. Não impedem a funcionalidade manual definida nesta solicitação e não foram implementadas por suposição.
- Estimativas não garantem entrega; operação precisa manter datas e atender alterações. Sem benchmark de desempenho ou validação externa de termos de transportadora.
- Homologação remota e executor específico de migration 0022 ainda são passos de release autorizada, não evidências desta revisão local.

**APTO PARA STAGING**: gates locais aprovados e implementação pronta para revisão; publicação somente após preparo/autorização da migration e homologação. Sem deploy, commit, push, acesso remoto ou alteração financeira nesta tarefa.

---

## Registro histórico — revisão anterior de comunicação de prazos

O conteúdo abaixo descreve o estado **anterior** à implementação de fabricação. Seus totais, pendências, ausência de migration e veredito não são o resultado vigente; foram preservados como trilha de diagnóstico.

Data: 09/10/2026. Veredito: **APTO COM RESSALVAS**, para revisão local e futura homologação das correções implementadas. **O fechamento integral desta etapa ainda depende da definição e implementação do cadastro do período estimado de fabricação por lote.** Não foi criada uma política comercial por suposição. Nada foi publicado.

## 1. Origem, escopo e isolamento

- Worktree atual, branch `feat/preorder-batch`.
- HEAD inicial e final: `f519c11e94e57f76522db11f04254c5c17874598`; parent: `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`.
- Worktree estava limpo no início desta tarefa; a revisão de capacidade anterior já integrava o HEAD. Não houve commit, push, checkout de branch ou descarte de alterações.
- Node `22.23.2`, scripts e lockfile pnpm existentes. Sem novas dependências.
- MySQL exclusivamente local, socket `/tmp/l4ckos-final-fixes-mysql/mysqld.sock`, versão 8.4.11. Testes criam schemas sintéticos isolados; provas de restore usam MySQL Docker local independente.
- `DATABASE_URL` vazio na execução dos testes; conexões de teste apontam explicitamente para localhost/socket. Nenhuma leitura de banco remoto, Railway, Vercel, produção ou pedido real #12.
- Navegador Chromium com APIs simuladas e bloqueio de hosts externos. Asaas, Melhor Envio e Resend mockados; nenhum pedido, pagamento, envio de e-mail ou etiqueta real.
- Aplicadas as skills de isolamento, verificação de homologação, segurança e e-mail. As orientações de React e e-mail mantiveram hooks, componentes, escaping e templates existentes; somente comunicação e dados necessários foram alterados, sem reformulação visual ou mudança de outbox/webhook.

## 2. Diagnóstico técnico

O lote possui `salesOpenAt`/`salesCloseAt`, `estimatedShippingStart`/`estimatedShippingEnd` e marcos **reais** `productionStartedAt`, `receivedAt`, `shippingStartedAt` e `completedAt`. Não possui período **estimado** de fabricação nem duração/marco inicial configuráveis. Datas reais de produção não podem ser tratadas como compromisso futuro do fornecedor.

Os itens de pedido já preservam nome do lote e janela de postagem em `*AtPurchase`. O checkout transacional congela esses dados sob os locks existentes. O histórico consulta o status atual do lote, sem reescrever snapshots. As condições de transporte, porém, não eram registradas como prazo de compra.

### Inconsistências confirmadas e correções

| Achado | Evidência/correção |
| --- | --- |
| Entrega calculada a partir de hoje/pagamento, omitindo fabricação | `Pagamento.tsx` somava dias de transporte à data atual e dizia “após a aprovação do pagamento”. Removidos o cálculo e os textos, inclusive no layout legado. Transporte começa após postagem; fabricação/preparação são etapas distintas. |
| Produto mostrava “dias úteis” sem indicar marco inicial | Calculadora de `ProductDetail.tsx` passou a usar a mesma mensagem de transporte do checkout, sem inferir data final ou regra de feriados. |
| “Envio estimado” confundido com entrega | Componentes e administração agora dizem **postagem estimada**. Janela não é previsão de chegada. Datas mantêm ano, evitando ambiguidade entre anos. |
| Datas vencidas continuavam prometidas como futuras | Catálogo/sacola/checkout identificam previsão anterior e cronograma aguardando atualização. Não há avanço automático de datas, fabricação ou status. Se apenas o início venceu e o fim ainda é válido, informa-se o limite final existente, sem fabricar um novo início. |
| Datas incompletas/inválidas | Início, fim e ausência tratados explicitamente; dados inválidos não causam `Invalid Date`/erro de renderização. Janela invertida é identificada. Uma janela de postagem de um único instante/dia passa na validação; vendas continuam exigindo intervalo não vazio. |
| Encerramento sem horário/fuso | Produto exibe instante de encerramento em Brasília, incluindo hora. Administração continua explicitamente em UTC, com explicação UTC−3. Datas históricas de postagem mantêm o calendário UTC do contrato existente; não foram convertidas retroativamente para outro dia civil. |
| Frete inventado após falha de consulta | Frontend não cria entrega local por conta própria. Backend não oferece opção local fora da faixa de CEP preexistente quando token/serviço/cotação estiver ausente. Lista vazia bloqueia finalização, e o backend rejeita antes de pedido/cobrança. |
| Prazo artificial de 3 dias / preço inválido convertido em gratuito | Parser não inventa prazo; aceita intervalos de objeto/string, campos customizados e zero válido. Prazo ausente fica `null`; preço ausente/inválido/negativo elimina a opção. Falha fora da área local retorna `source: unavailable`. |
| Entrega local prometida em 1–2 dias | Backend não inventa duração. Mensagens indicam agendamento após disponibilidade de todos os itens, não transporte postal. Preço e região preexistentes foram preservados. |
| Cotação desatualizada após troca de CEP/sacola | Checkout invalida seleção por CEP e descarta respostas fora de contexto ou superadas por outra consulta. Produto descarta resposta de outro produto/CEP/quantidade. Checkout aguarda cotação em andamento. |
| Envio conjunto omitido entre lotes PREORDER distintos | Aviso também cobre diferentes lotes; o pedido segue a regra existente de remessa única quando todos os itens estiverem disponíveis. Não foram implementadas remessas fracionadas. |
| Histórico sem condições de transporte | Novo checkout grava `shippingAtPurchase` em `auditLogs.metadata` do evento preexistente `checkout.created`, na transação e antes do provedor. Detalhe/rastreio retornam somente DTO validado após autorização de ownership. Pedidos antigos sem esse registro exibem ausência explícita; não são recotados nem preenchidos retroativamente. |
| Mudança de cronograma invisível ou confundida com contrato original | DTO inclui janela atual do lote separada do snapshot. Histórico/rastreio preservam a previsão da compra e mostram aviso separado de alteração enquanto ainda não enviado/entregue/cancelado. |
| Pedido PREORDER apresentado como já em separação | Histórico e detalhe distinguem acompanhamento de produção; STOCK mantém os rótulos normais. O acompanhamento existente já distinguia produção e foi preservado. |
| E-mails ambíguos sobre prazo | Confirmação do pedido usa a janela registrada na compra; e-mail de pagamento distingue transporte e aponta para as condições do pedido, sem nova data ou início imediato de fabricação. Templates renderizados localmente, sem envio. |

## 3. Condições preservadas

- Locks, isolamento, ordem determinística de reserva e controle de capacidade não foram reimplementados.
- Pedidos pendentes e pagos continuam ocupando capacidade sem duplicação; cancelamento mantém a liberação existente; lotes sem máximo e produtos STOCK continuam compatíveis.
- Revalidação de sacolas antigas, limite compartilhado entre produtos/variantes, bloqueio de lote esgotado e proteção concorrente permanecem aprovados em MySQL/navegador.
- Preço de frete continua recotado/validado pelo backend; frontend não define preço nem prazo contratual de cobrança. A gravação do snapshot acrescenta metadados, não altera valores ou sequência de criação da cobrança.
- `orderItems` e snapshots existentes não são atualizados após mudanças no lote/cotação. Repetição idempotente usa o pedido original e não recota nem cobra novamente.
- Código Asaas, processamento/autenticação/idempotência dos webhooks e outbox não foram alterados. Os testes de segurança cobrem esses fluxos com mocks; qualquer “pedido 12” em logs de testes é fixture sintética, não acesso ao pedido real.

## 4. Decisões comerciais pendentes — não implementadas como regras definitivas

1. **Cadastro de fabricação por lote:** escolher entre janela estimada absoluta de início/conclusão acordada com o fornecedor (alternativa recomendada por não exigir inventar marco de contagem) ou duração com marco inicial definido. Na segunda alternativa, definir dias úteis/corridos, calendário e contagem a partir de encerramento, mínimo do lote, pagamento ou aceite do fornecedor. A decisão foi solicitada durante o trabalho; permanece pendente. Os campos e snapshots de fabricação **ainda não foram implementados**. A interface informa “período estimado de fabricação: a confirmar”, sem derivá-lo da postagem.
2. **Preparação:** definir se haverá janela própria de preparação/expedição e qual compromisso operacional a sustentará. Não foi adicionada duração padrão.
3. **Lote OPEN com postagem vencida:** decidir entre suspender novas vendas até revisão do cronograma ou permitir compra mediante previsão a confirmar. Mantida a regra existente de vendas/status/capacidade; a comunicação identifica atraso, sem fechar lote automaticamente.
4. **Compras perto do encerramento:** seguem o mesmo calendário do lote, sem inventar uma nova fabricação individual a partir do pagamento. Validar com o fornecedor se esse calendário é operacionalmente viável e se deve haver margem antes da postagem.
5. **Mudanças do fornecedor:** decidir política de aviso proativo, revisão da estimativa e atendimento ao cliente. A mudança fica visível no acompanhamento, mas não cria e-mails automáticos nem substitui a condição da compra. Disparo de notificações exige fluxo autorizado e idempotente próprio.
6. **Fuso/calendário da postagem:** preservar por ora o calendário UTC histórico; decidir se novos cadastros usarão datas civis de Brasília. Uma mudança futura deve versionar a semântica, sem reinterpretar compras antigas. Vendas já são mostradas como instante preciso em Brasília.
7. **Unidade do transporte e previsão final:** confirmar documentalmente os termos de cada serviço (dias úteis/corridos, feriados e contingências). Exibe-se o prazo recebido conforme a cotação; não se soma automaticamente ao calendário de fabricação nem se calcula uma data garantida de chegada.
8. **Entrega local/remessas distintas:** validar limites geográficos e capacidade de agendamento da regra preexistente. Qualquer remessa fracionada, novo custo ou promessa de data exige definição comercial separada.

## 5. Testes e gates executados

Execução final ampla: **38 arquivos, 396 testes aprovados, zero falhas e zero testes ignorados entre os executados**. Dois arquivos foram explicitamente excluídos, descritos abaixo; portanto, não se declara aprovação de toda a suíte sem exclusões.

| Evidência principal | Resultado final |
| --- | --- |
| `shippingDeadlines.test.ts` — novas regressões de texto, parser/provider mockado, timezone, histórico, componentes e e-mails | 23 aprovados |
| `preorder.mysql.test.ts` — capacidade, transações, snapshots, ownership e novas regressões de prazo/frete | 53 aprovados |
| `checkout.mysql.test.ts` — STOCK, reserva, integridade, idempotência e rollback | 22 aprovados |
| `preorderUi.test.ts` — componentes reais em Chromium, administração, produto/frete, sacola, checkout, histórico/rastreio e resposta atrasada | 16 aprovados |
| `preorderEmail.test.ts` | 5 aprovados |
| `checkoutApi.test.ts` | 5 aprovados |
| `preorderCapacity.test.ts` | 3 aprovados |
| Outras regressões da execução ampla, incluindo segurança/webhooks, e-mail/outbox e schema/backup locais | Aprovadas; incluídas no total de 396, não somadas novamente |
| `pnpm check` | PASS, cliente e servidor |
| `pnpm build` | PASS, Vite e esbuild |
| `git diff --check` | PASS, saída vazia e código 0 |

Comando da execução ampla final:

```bash
env DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store \
  PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
  L4CKOS_MYSQL_TEST=1 \
  L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock \
  pnpm exec vitest run \
    --exclude server/database/stagingTransport.test.ts \
    --exclude server/database/staging0021Transport.test.ts
```

### Não executados nesta etapa

- `server/database/stagingTransport.test.ts` e `server/database/staging0021Transport.test.ts`: **18 casos fora da execução**, pois o empacotamento exige origem Git limpa. Não foi criado commit, nem mesmo em cópia temporária, sob a restrição atual. Aprovação da auditoria anterior não é aprovação desta execução. Esses arquivos não foram modificados.
- Homologação remota, cotações reais do Melhor Envio, compra de frete/etiqueta, confirmação externa Asaas Sandbox, entrega de e-mail em caixa postal e benchmark de carga: não realizados.
- Não há teste de configuração de fabricação, porque esse recurso permanece pendente de definição/implementação. Não foi considerado aprovado.

## 6. Arquivos modificados e novos

19 rastreados modificados:

- Compartilhado: `shared/preorder.ts`.
- Frontend: `client/src/components/CartDrawer.tsx`, `client/src/components/PreorderInfo.tsx`, `client/src/components/admin/batches/AdminBatches.tsx`, `client/src/pages/ProductDetail.tsx`, `client/src/pages/Pagamento.tsx`, `client/src/pages/PedidoDetalhe.tsx`, `client/src/pages/AcompanharPedido.tsx`, `client/src/pages/MeusPedidos.tsx`, `client/src/pages/FAQs.tsx`.
- Backend: `server/services/shippingService.ts`, `server/database/checkout.ts`, `server/database/productionBatches.ts`, `server/db.ts`, `server/routers/orders.ts`.
- Templates: `server/emails/transactional/OrderCreated.jsx`, `server/emails/transactional/PaymentApproved.jsx`.
- Testes existentes: `server/database/preorder.mysql.test.ts`, `server/database/preorderUi.test.ts`.

3 novos, ainda não rastreados:

- `server/database/orderShippingSnapshot.ts`.
- `server/database/shippingDeadlines.test.ts`.
- `docs/preorder/shipping-deadlines-review.md`.

`git diff --stat`: **19 arquivos rastreados, 344 inserções e 137 remoções**. Os três novos não entram nesse stat. Não houve formatação global, novas imagens, CSS ou reformulação de layout. O relatório anterior de capacidade foi preservado.

## 7. Impacto de frontend, backend e schema

Necessária atualização de **ambos** para disponibilizar todas as correções, somente após revisão/autorização. Backend primeiro: mantém cotação válida, novos metadados e campos aditivos nos DTOs. Frontend depois: trata prazo ausente, falta de cotação e histórico sem snapshot. O frontend novo tolera backend anterior sem novos campos; não deve ser usado como prova de prazo histórico quando esses dados não existem.

**Nenhuma migration necessária para as mudanças implementadas.** Utiliza-se a coluna de metadados de auditoria já existente para o registro do transporte. Não há alteração de schema/ledger/bootstrap, backfill ou reinterpretação dos dados históricos. O cadastro estruturado futuro de fabricação e seus snapshots provavelmente exigirá migration aditiva após a decisão comercial, incluindo contrato e verificação MySQL local; não está preparado/aplicado nesta entrega.

Em eventual rollback autorizado de staging, voltar aos artefatos anteriores comprovadamente bons; não apagar os novos metadados de compra, pedidos ou reservas. Backend antigo ignora metadados adicionais. Não desfazer schema nem repetir cobranças/webhooks/e-mails.

## 8. Riscos remanescentes e veredito

- O período de fabricação ainda não pode ser cadastrado/exibido como compromisso estruturado por lote. Este é o motivo principal da ressalva; **não afirmar que o fechamento 01/04 está concluído**.
- Estimativas de postagem e transporte não garantem entrega. Mantém-se necessidade operacional de revisar datas vencidas e comunicar mudanças aos compradores; a interface não executa essas ações.
- Janela atual e snapshot são expostos separadamente; o aviso não constitui aceite comercial automático de alteração pelo cliente.
- Snapshots de transporte ficam nos metadados do checkout: preservar esses eventos durante a retenção do pedido. Histórico anterior sem metadados permanece explicitamente desconhecido. As novas leituras adicionam custo à lista/detalhe; não houve benchmark.
- Cotação Melhor Envio continua usando o modelo de pacote/peso já existente; sua adequação física e termos por transportadora não foram homologados externamente nesta tarefa.
- Ausência de frete fora da área local agora bloqueia a compra, em vez de oferecer modalidade inválida. Confirmar esse comportamento na futura homologação autorizada.

**APTO COM RESSALVAS** para homologar as correções locais implementadas, com gates aprovados e sem publicação. Para encerrar integralmente esta etapa, é necessário decidir o modelo de fabricação por lote e implementar/testar sua configuração, apresentação e snapshots. Nenhuma autorização de deploy, envio real ou produção decorre deste relatório.
