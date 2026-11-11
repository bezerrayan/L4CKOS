# L4CKOS RC3 Gate P14 — reconciliação local de migrations

**Status:** investigação local concluída; rollout e qualquer decisão sobre o estado remoto continuam bloqueados por attestation. Este relatório registra observações em MySQL descartável. Não é evidência do schema nem do histórico de produção.

## Escopo e preservação

- Worktree: `l4ckos-stock-checkout-forwardport/l4ckos-final/l4ckos-store`.
- HEAD/base: `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156` (detached).
- O trabalho local dos Gates P4–P13 foi preservado. O journal original, snapshots, migrations e código de aplicação não foram alterados.
- Os testes usaram MySQL `8.4.11`, banco e usuário sintéticos descartáveis, Docker local e conteúdo sintético. O container foi removido ao final.
- Nenhuma conexão ou SQL remoto foi executado; nenhuma ferramenta Railway/Vercel foi usada.

## MIGRATION_CHAIN

O mecanismo presente no repositório é Drizzle Kit. `drizzle.config.ts` aponta para `drizzle/schema.ts`, `out: ./drizzle`, dialect MySQL e exige `DATABASE_URL`. O `package.json` define `db:push`, mas não define script próprio de migration. O comando `pnpm exec drizzle-kit migrate` usa `drizzle/meta/_journal.json` como a lista ordenada aplicável. `db:push` é outro mecanismo e não foi usado para resolver a cadeia.

O journal e os snapshots versionados terminam em `0007`; há arquivos SQL `0000` a `0017`. Portanto, `0008` a `0017` existem no diretório, mas não estão na sequência que o migrador padrão lê. Em MySQL descartável, o Drizzle aplicou apenas `0000–0007`, criou 18 tabelas-base e registrou 8 linhas em `__drizzle_migrations`; `orders.paymentStatus` ainda não existia.

Há ainda divergência entre a declaração da base e sua cadeia SQL: `git show HEAD:./drizzle/schema.ts` declara `orders.paymentStatus` e os campos de confirmação financeira, embora a migration que os introduz seja `0016`, fora do journal. Também declara os campos de snapshot de entrega introduzidos por `0010`, igualmente fora do journal. No baseline reproduzido apenas com `0000–0007`, ambos os grupos de colunas estavam ausentes. A declaração TypeScript, isoladamente, não prova que essas colunas existam remotamente.

| Arquivo     | Observação local relevante                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0008`      | Cria `waitlist_emails` com `IF NOT EXISTS`.                                                                                                                                                       |
| `0009–0012` | Adicionam `users.sessionVersion`, snapshots de entrega, tabela de unsubscribe e tokens de reset.                                                                                                  |
| `0013`      | Cria `asaasWebhookEvents` com `eventId` único, hash, estado de processamento e correlação opcional com pedido/pagamento.                                                                          |
| `0014`      | Contém seis `ALTER TABLE` sem separadores Drizzle. O migrador padrão tentou enviá-los como uma instrução e MySQL falhou ao chegar ao segundo `ALTER`.                                             |
| `0015`      | Primeiro apaga avaliações duplicadas por `userId, productId`, depois adiciona campos/índices/constraints e cria `productReviewUploads`; múltiplas instruções no arquivo, sem separadores Drizzle. |
| `0016`      | Adiciona campos de confirmação financeira a `orders` e depois executa o backfill baseado em eventos. Duas instruções no arquivo, sem separadores Drizzle.                                         |
| `0017`      | Remove o unique `(userId, productId)` criado em 0015, mantendo a unicidade de reserva.                                                                                                            |

**Sequência esperada pelo migrador atual:** somente tags `0000–0007` listadas no journal. **Sequência efetivamente reproduzida no ensaio completo:** Drizzle aplicou `0000–0007`; um executor de teste local dividiu os SQL de `0008–0017` em instruções e os aplicou na ordem numérica. Essa divisão foi apenas para reproduzir a intenção SQL em scratch; não é um procedimento de produção aprovado nem uma mudança do mecanismo.

Dependências observadas: `0010` depende de `orders`; `0013` introduz o ledger consultado por `0016`; `0015` depende de `productReviews`; `0016` depende de `orders` e `asaasWebhookEvents`; `0017` depende do índice criado por `0015`. A ordem numérica respeita essas dependências. Não foi encontrada prova no repositório de aplicação manual em produção, de um migrador alternativo ou de quais arquivos foram efetivamente aplicados.

## JOURNAL_MISMATCH_CAUSE

**Causa observada no checkout:** divergência entre os artefatos: o diretório contém SQL `0008–0017`, enquanto o journal e snapshots só registram `0000–0007`. Além disso, migrations multi-statement `0014–0016` não têm `statement-breakpoint`; `drizzle-kit migrate` falhou na 0014 em MySQL 8.4 quando enviou seis `ALTER TABLE` como uma instrução. Logo, adicionar apenas tags ao journal não basta para fazer a cadeia atual executar pelo migrador padrão.

**Causa histórica:** desconhecida. A árvore local não demonstra se os arquivos foram executados manualmente, por outro mecanismo, em outro commit, parcialmente ou nunca no banco remoto. Não corrigir o journal antes de comparar essa evidência.

## LOCAL_REPRODUCTION

| Ensaio                                                                     | Resultado observado                                                                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle-kit migrate` com journal original                                 | PASS local: 8 entradas (`0000–0007`), 18 tabelas-base; `orders.paymentStatus` ausente.                                                             |
| `drizzle-kit migrate` com journal scratch temporário incluindo `0008–0014` | Falha em `0014`: erro de sintaxe ao segundo `ALTER TABLE`, porque a migration foi enviada como statement único. O journal original não foi tocado. |
| Replay SQL separado em instruções, em scratch, de `0008–0014`              | PASS: 0008–0013 executaram uma instrução cada; 0014 executou seis.                                                                                 |
| Replay SQL separado em instruções de `0015`                                | PASS; 3 instruções. Com duas avaliações sintéticas do mesmo usuário/produto, restou uma após o `DELETE` de deduplicação.                           |
| Replay SQL separado em instruções de `0016`                                | PASS; 2 instruções. Ver detalhe abaixo.                                                                                                            |
| Replay de `0017`                                                           | PASS; após remover a unicidade por usuário/produto, uma segunda avaliação sintética do mesmo par foi aceita.                                       |

O ensaio integral deixou `__drizzle_migrations` com 8 linhas: o replay manual não foi registrado pelo Drizzle como histórico de migrations. Isso demonstra que executar SQL fora do migrador não atualiza automaticamente o histórico padrão.

## MIGRATION_0016_RISK

0016 adiciona `paymentStatus` como `unconfirmed` para as linhas existentes e marca como `confirmed` pedidos com ao menos um evento persistido cuja combinação seja `status='processed'`, `orderId` não nulo e tipo em `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` ou `PAYMENT_OVERDUE_RECEIVED`. O status logístico (`orders.status`) não é condição de confirmação. O backfill grava fonte `asaas_webhook`, horário e referência; se `processedAt` for nulo, usa `orders.updatedAt`.

**Sim: pode alterar dados financeiros já existentes.** Executá-la pode confirmar em massa pedidos históricos com eventos elegíveis. A migration não valida assinatura original do webhook, valor pago, usuário, associação com `payments`, nem se a semântica antiga de `processed` comprova liquidação. A segurança do backfill depende da integridade e significado históricos de `asaasWebhookEvents`.

No dado sintético:

- Pedido pendente sem evento elegível permaneceu `unconfirmed`.
- Pedido logístico `delivered`, mas com evento elegível `failed`, permaneceu `unconfirmed`.
- Evento `PAYMENT_RECEIVED` processado confirmou pedido `shipped`.
- Pedido cujo status era `paid`, mas só tinha evento `PAYMENT_CREATED` processado, permaneceu `unconfirmed`.
- Para um pedido com dois eventos elegíveis, `MAX(processedAt)` escolheu a data mais recente, enquanto `MAX(eventId)` escolheu o maior valor lexical (`evt-z-older`), que era o ID do evento mais antigo na fixture. Como os máximos são independentes, `paymentConfirmedAt` e `paymentConfirmationReference` podem apontar para eventos diferentes.

`0015` também é destrutiva: apaga linhas duplicadas de avaliações antes de adicionar constraints. Em fixture com duas linhas duplicadas, uma foi apagada. Antes de qualquer aplicação remota, é necessário medir impacto por agregados não identificáveis e definir retenção/decisão sobre os duplicados.

## STOCK_LEGACY_CONFLICTS

Os conflitos abaixo são observados no código atual e foram reproduzidos na fixture. O schema sintético adicionou apenas para esse ensaio colunas/estado variant STOCK; não representa prova de schema remoto.

1. **Dois contadores de estoque:** o caminho legado `reserveStockForOrder` calcula disponibilidade de `products.stock` menos reservas ativas de produto. O adapter STOCK reserva `productVariants.stock - reservedStock` sob lock da variante. Nenhum consulta/reserva inclui o outro contador.
2. **Overselling cruzado:** com produto e variante em 1 unidade e uma reserva legada ativa de 1, o adapter STOCK ainda viu 1 disponível e reservou mais uma; a fixture ficou com 2 reservas ativas para 1 unidade física.
3. **Consumo divergente:** consumir STOCK deixou `products.stock=1`, enquanto a variante virou 0; consumir pelo legado deixou `products.stock=0`, enquanto a variante permaneceu 1. Assim, cada caminho pode vender novamente a mesma unidade ou apresentar disponibilidade inconsistente.
4. **Reservas legadas sem variante:** a base tem reserva ligada ao produto/pedido, sem attempt/variant/snapshot STOCK. Não é seguro atribuí-las a uma variante por inferência. Reservas abertas precisam ser drenadas ou reconciliadas antes de habilitar aquele produto.
5. **Administração de variantes:** `replaceProductVariants` apaga todas as variantes do produto e recria outras. Com reservas ou itens STOCK referenciando IDs, isso pode falhar sob FKs; sem FKs, pode destruir identidade referenciada e tornar os snapshots difíceis de reconciliar. O writer precisa preservar/deativar IDs referenciados e impedir alteração de estoque durante reserva aberta.
6. **Dois ledgers de webhook:** o webhook legado usa `asaasWebhookEvents`/`runAsaasWebhookOnce` e `markOrderPaid`; STOCK usa `stockWebhookEvents` e consome variantes. Se ambos aceitarem o mesmo evento/pedido, há duas rotas idempotentes e duas semânticas de inventário. Exigir roteamento exclusivo pelo vínculo da tentativa/pedido e um único owner financeiro por pedido.

Até existir segregação comprovada e guardas transacionais, os escritores legado e STOCK não podem operar sobre o mesmo produto/inventário. Não criar migration STOCK neste gate.

## PRODUCTION_UNKNOWN

Desconhecidos que o replay local não resolve:

- Quais tags/hashes constam de `__drizzle_migrations` remoto e se essa tabela sequer representa o histórico completo.
- Se `0008–0017` foram aplicadas total, parcialmente, manualmente ou por outro release.
- Colunas, tipos, defaults, índices, constraints, FKs, triggers e dados já existentes em cada tabela.
- Contagens agregadas de duplicatas afetadas por 0015 e eventos elegíveis por pedido para 0016; integridade dos payload hashes e significado operacional de `processed`.
- Pedidos/eventos históricos com ligações incompletas ou inconsistentes; reservas abertas por produto; estoque agregado e por variante.
- Outros writers (checkout legado, webhook, admin/estoque manual, jobs) que podem concorrer ou atualizar os mesmos registros.
- Compatibilidade de ordem de execução, locks e duração da migration com volume e carga reais.

## ATTESTATION_REQUIREMENTS

Antes de decidir rollout, DBA/proprietário deve aprovar um alvo específico e um método de inspeção. O mínimo é:

1. Identificar projeto, serviço, database/schema e host pretendidos; aprovar origem/rede da sessão e CA/hostname TLS esperados.
2. Usar principal dedicado, temporário se apropriado, sem `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `FILE`, `PROCESS`, `SUPER` ou privilégios administrativos. O acesso deve ser limitado a leitura dos metadados requeridos no schema escolhido; nenhum root.
3. Entregar saída sanitizada, sem dados pessoais, payloads, tokens, hashes de credenciais ou valores financeiros: versões/nome de tabelas e migrations; colunas e tipos/defaults/nullability; índices/uniques; FKs/checks; triggers; presença e contagem/tags do histórico de migrations.
4. Para risco de backfill, somente após autorização explícita separada, devolver agregados não identificáveis: quantidade de duplicatas em `productReviews(userId,productId)`; contagem por tipo/status de eventos 0016 com `orderId`; casos por pedido/evento em que a regra proposta diverge dos campos financeiros atuais; reservas ativas legadas e divergências de totais de inventário. Não ler nomes, e-mails, endereços ou payloads.
5. Confirmar por escrito se existem operadores fora do mecanismo Drizzle (SQL manual, jobs, dashboards, outros serviços) e qual sistema mantém o histórico oficial.

Não havia nesta rodada evidência de autorização, identidade read-only, host/origem aprovada e TLS validado. Portanto não houve conexão nem execução de consulta.

**Escopo futuro de consultas:** `INFORMATION_SCHEMA.TABLES`, `COLUMNS`, `STATISTICS`, `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `CHECK_CONSTRAINTS`, `TRIGGERS` e apenas metadados da tabela `__drizzle_migrations`; consultas a dados exigem autorização separada e devem retornar somente os agregados acima. Não se deve deduzir a ausência de tabelas pela ausência de privilégio de visibilidade.

## Decisão e próximos passos

- **A cadeia local é reproduzível?** Parcialmente. O baseline `0000–0007` é reproduzível pelo migrador padrão. A intenção SQL `0008–0017` foi reproduzida sequencialmente em scratch com statements separados, mas a cadeia não é reproduzível tal como configurada/arquivada pelo `drizzle-kit migrate`: não está no journal e 0014 falha como multi-statement. Isso não define o estado remoto.
- **0016 pode alterar dados financeiros existentes?** Sim. Confirma pedidos históricos conforme o ledger `asaasWebhookEvents`; a fixture demonstrou que o maior `eventId` pode não corresponder à data mais recente.
- **Menor conjunto de evidências para decidir rollout:** attestation read-only autenticada de schema + histórico real; inventário de writers e ledgers; agregados sanitizados que estimem impacto 0015/0016 e reconciliem reservas/estoques; validação de backup/restauração isolada. DDL candidato ainda precisa ser ajustado ao schema observado e repetido em MySQL descartável.
- **Ação bloqueada até attestation:** escolher, gerar e executar qualquer migration/backfill, liberar produtos ao fluxo STOCK ou habilitar checkout. Attestation sozinha não autoriza execução; backup, revisão e autorização de mudança continuam obrigatórios.

**NEXT_ACTION:** obter do DBA a confirmação de alvo e autorização para fornecer a attestation read-only sanitizada segundo o escopo acima. Não enviar segredo em texto aberto. Depois comparar a evidência com o contrato P13 e decidir o tratamento da cadeia e dos dados históricos.

**FILES_CHANGED:** somente este relatório P14. **REMOTE_CHANGES=NONE.**
