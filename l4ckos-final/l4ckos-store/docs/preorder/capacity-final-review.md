# Revisão final de capacidade PREORDER

Veredito final: **APTO PARA STAGING**. As duas ressalvas técnicas foram resolvidas: o diff cosmético foi reduzido com equivalência verificada e os testes de empacotamento passaram em origem Git limpa, temporária e independente. Suíte completa: **382 testes aprovados, zero falhas e zero ignorados**. Nenhuma publicação foi realizada. Auditoria concluída em 09/10/2026.

## Origem e isolamento

- Branch: `feat/preorder-batch`, worktree atual.
- HEAD: `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`.
- Parent: `3f54861b64fc854592455e7e6cab97d1fee8f2b7`.
- Runtime: Node `22.23.2`; scripts e lockfile pnpm verificados.
- Alterações funcionais locais anteriores preservadas. Sem commit no repositório principal, push ou deploy. Commits exclusivamente nos repositórios temporários independentes usados para verificar empacotamento; não alteram branch, histórico ou índice principal.
- MySQL `8.4.11`, container local `l4ckos-final-fixes-mysql`, ID `915561f7b6e1`, imagem `mysql:8.4`, sem portas publicadas. Socket do host: `/tmp/l4ckos-final-fixes-mysql/mysqld.sock`. Os testes criam bancos com nomes sintéticos aleatórios e removem esses bancos ao terminar.
- Testes executados com `DATABASE_URL` vazio; testes de navegador bloqueiam hosts externos e simulam as APIs. Asaas/cotações de checkout são mocks nos testes transacionais.
- Sem acesso a Railway, Vercel, bancos remotos, produção ou ao pedido real #12. Os testes reproduzem o cenário com fixtures sintéticos.

## Diagnóstico e correções

O backend transacional existente já estava correto: trava produtos e lotes em ordem determinística, usa `READ COMMITTED`, soma todos os itens PREORDER de pedidos não cancelados e verifica a capacidade antes de inserir o pedido e chamar o provedor. A confirmação de pagamento modifica a evidência do pedido; não cria uma segunda reserva. Cancelamento exclui o pedido da soma. A consulta informativa usa a mesma regra em um SELECT consistente, sem escrever ou adquirir reservas. Não foi necessário alterar `checkout.ts` ou `productionBatches.ts`.

A primeira correção local já expunha `capacity.maximumQuantity`, `claimedQuantity` e `remainingQuantity`, filtrava lotes esgotados na disponibilidade e apresentava avisos/bloqueios no frontend. Esses comportamentos foram preservados.

Problemas adicionais corrigidos:

- **CONFIRMED — disponibilidade desatualizada:** a sacola podia reaproveitar snapshots antigos ou produtos ausentes do catálogo. Agora consulta novamente ao montar, ao recuperar foco e a cada 15 segundos; produtos ausentes bloqueiam a finalização. Botões de finalização aguardam a consulta em andamento.
- **CONFIRMED — revalidação na finalização:** o checkout agora executa uma consulta nova e bloqueia a mutation de cobrança se a disponibilidade for insuficiente ou não puder ser atualizada. O navegador testou a mudança depois de preencher um checkout inicialmente válido.
- **CONFIRMED — teto indevido:** `preorderAdditionalLimit` devolvia 99 para lotes sem máximo. Agora devolve `null`, permitindo que o total do lote na sacola ultrapasse 99. O limite geral preexistente de 99 por linha do checkout permanece; quantidades inválidas são identificadas.
- **HARDENING — ações repetidas:** as mutações da sacola consultam a referência atual de itens, inclusive para ações seguidas antes de um novo render. Quantidade e limite são calculados considerando todos os produtos/variantes do lote; chamadas de atualização que abrangem várias linhas também dividem a capacidade entre elas.
- **Apresentação:** Home e vitrine exibem `PRÉ-VENDA ESGOTADA` ou indisponível; produto, sacola e drawer mantêm os avisos e bloqueios. Vitrine e produto atualizam a consulta a cada 15 segundos. A sacola vazia utiliza o snapshot da página do produto em vez de priorizar seu catálogo desativado e antigo.

Não houve mudança no status automático do lote, processamento Asaas/webhooks, pedidos confirmados, schema ou dependências. A revisão React orientou o estado derivado de disponibilidade e os bloqueios durante consultas.

## Inventário: arquivos modificados e novos

São **14 arquivos rastreados modificados** e **3 arquivos novos não rastreados**. Todos têm relação direta com a disponibilidade PREORDER, suas regressões ou esta auditoria. Não há alteração em `server/database/checkout.ts`, `server/database/productionBatches.ts`, processamento Asaas/webhooks, configuração, schema, lockfile ou dependências.

| Área | Arquivos |
| --- | --- |
| Contrato e backend, incluindo correções locais preservadas | `shared/preorder.ts`, `server/db.ts`, `server/routers/products.ts`, `server/routers/orders.ts` |
| Sacola e checkout | `client/src/contexts/CartContext.tsx`, `client/src/components/CartDrawer.tsx`, `client/src/pages/Carrinho.tsx`, `client/src/pages/Pagamento.tsx` |
| Apresentação | `client/src/components/ProductCard.tsx`, `client/src/components/PreorderInfo.tsx`, `client/src/pages/ProductDetail.tsx`, `client/src/pages/Home.tsx`, `client/src/pages/Produtos.tsx` |
| Regressão rastreada modificada | `server/database/preorder.mysql.test.ts` |
| Novos, não rastreados | `server/database/preorderCapacity.test.ts` (40 linhas), `server/database/preorderUi.test.ts` (407 linhas), `docs/preorder/capacity-final-review.md` |

### Origem do volume e limpeza

O diff inicial desta auditoria tinha **4.388 inserções e 1.990 remoções**, totalizando 6.378 linhas alteradas. A maior parte do volume vinha de reformatação abrangente: quebra de linhas, aspas, parênteses em arrows, indentação e conversão para LF de arquivos historicamente mistos LF/CRLF. Não foi encontrada reorganização funcional não relacionada à PREORDER.

Restaurou-se a apresentação dos trechos semanticamente inalterados a partir do HEAD, preservando as alterações funcionais aprovadas. Cada gravação exigiu igualdade do código normalizado por Prettier e do JavaScript emitido pelo esbuild com whitespace minimizado. A verificação final dos 14 arquivos contra o snapshot anterior à limpeza confirmou ambas as equivalências, incluindo comentários na normalização. Nenhum teste ou proteção foi removido.

Os arquivos historicamente mistos continuam mistos nos trechos intocados; linhas adicionadas com CR sinalizado como whitespace foram normalizadas para LF. Não houve conversão global adicional. Restaram algumas diferenças de apresentação necessárias para preservar exatamente o JSX emitido, inclusive espaços renderizados.

Resultado: **573 inserções e 143 remoções**, total de 716 linhas alteradas — redução de **88,8%**. A evidência local de equivalência está em `/tmp/l4ckos-capacity-equivalence-final.json`; fingerprint agregado: `4688641006415be9df97698c9870b5c38341bd1fdef205b5add8290b42ac6eda`. O snapshot anterior à limpeza está em `/tmp/l4ckos-capacity-audit-BISkf4`. Esses caminhos são evidências temporárias desta máquina, não artefatos de publicação.

## Testes aprovados

Os 90 testes específicos abaixo estão também incluídos na execução final completa: **39 arquivos, 382 testes aprovados, zero falhas e zero ignorados**, após a limpeza.

| Suíte | Resultado |
| --- | --- |
| `preorder.mysql.test.ts` | 51 aprovados, incluindo MySQL real e contratos |
| `checkout.mysql.test.ts` | 22 aprovados, incluindo STOCK, transações e idempotência |
| `checkoutApi.test.ts` | 5 aprovados |
| `preorderCapacity.test.ts` | 3 aprovados |
| `preorderUi.test.ts` | 9 aprovados em Chromium, componentes reais e APIs simuladas |

| Cenário solicitado | Evidência |
| --- | --- |
| Lote aberto com capacidade | MySQL aceita abaixo/no máximo; navegador adiciona pela página do produto |
| Lote esgotado | ORM retorna máximo 2, comprometido 2, restante 0; Home, produto e sacola bloqueiam |
| Quantidade acima do restante | MySQL rejeita sem pedido/cobrança; página limita 4 a 2; drawer não aumenta acima de 2 |
| Sacola antiga com 4 peças e restante 0 | Navegador mantém quantidade identificável, bloqueia incremento e finalização; MySQL rejeita a tentativa sem novo pedido |
| Produtos/variantes no mesmo lote | Navegador testa linhas de produtos distintos e variantes do mesmo produto; MySQL agrega por lote |
| Pedidos pendentes | Reservam capacidade em MySQL e no catálogo ORM |
| Pagamento sem dupla contagem | Catálogo permanece com comprometido 2 antes/depois da confirmação; confirmação repetida é idempotente |
| Concorrência | Oito conexões/attempts independentes, produtos distintos: exatamente 5 compras para máximo 5 |
| Sem máximo | MySQL aceita pedidos de 99 + 99; navegador permite total 198 e incrementa linha 98 para 99 |
| Encerrado/indisponível | MySQL testa estados e janelas; navegador testa CLOSED e CANCELLED |
| Bloqueio antes da cobrança | MySQL verifica mock do provedor não chamado e ausência de pedido parcial; navegador não envia mutation após revalidação insuficiente |
| Mudança durante navegação | Navegador verifica polling convertendo a vitrine para esgotada e produto ausente bloqueando a sacola |

Comando da execução completa na cópia isolada:

```bash
env DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store \
  L4CKOS_MYSQL_TEST=1 \
  L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock \
  PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
  pnpm exec vitest run
```

Para repetir em outra máquina, confirme um MySQL local isolado e indique o módulo Playwright local disponível. Sem as variáveis habilitadoras, essas suítes condicionais podem ser ignoradas; isso não representa aprovação.

## Diagnóstico dos dois testes de empacotamento

A execução anterior, excluindo a interface executada separadamente, tinha 371 aprovados e duas falhas. Nesta auditoria, a falha foi reproduzida e a causa inspecionada, não presumida. Nomes exatos:

- `server/database/stagingTransport.test.ts` → `fixed Railway transport, offline API fixtures only` → `builds the exact Git bundle and executes it locally, without any DB/SSH/network access`.
- `server/database/staging0021Transport.test.ts` → `fixed 0021 Railway transport, offline API fixtures only` → `builds the exact Git bundle and executes it locally, without any DB/SSH/network access`.

Ambos falhavam com **`STAGING_REVIEWED_CLEAN_SOURCE_REQUIRED`**, lançado por `reviewedSource()` em `database/staging/railway.ts:19` e `database/staging0021/railway.ts:21`. A guarda de skip examina apenas o diretório específico do transport, mas a política de empacotamento examina o status Git de todo o projeto. Assim, arquivos PREORDER modificados fora desses diretórios permitem iniciar o teste, mas corretamente impedem empacotar uma origem suja.

Prepararam-se cópias independentes em `/tmp`, contendo os 608 arquivos do projeto, incluindo os três novos, com hashes SHA-256 byte a byte e modos verificados. `.env*` e `.npmrc` locais não foram incluídos; as dependências existentes foram reutilizadas por link ignorado. Um repositório Git novo e um commit local somente nessa cópia forneceram a origem limpa exigida. Não se alterou a política de segurança nem se fez commit no principal.

A primeira repetição isolada dos dois arquivos passou: **18 testes aprovados**, incluindo ambos os casos de empacotamento. Após a limpeza final, a suíte completa passou na cópia `/tmp/l4ckos-capacity-release-lE2Yhb`, SHA isolado `3672995f5a2fcdd3565e11bcc9189d967a35ac8b`: **382/382**, sem skips. O manifesto externo está em `/tmp/l4ckos-capacity-release-lE2Yhb.manifest.json`. Este SHA é da cópia temporária, não da branch principal nem de um deployment. Após a atualização documental, a repetição dos dois arquivos numa cópia limpa contendo também o relatório final confirmou novamente **18 aprovados, zero falhas e zero ignorados**. Os transports usam fixtures offline, sem chamadas a Railway ou acesso SSH.

Nenhum teste da execução final ficou ignorado. Nenhuma falha de teste permanece. Homologação do site remoto, Asaas Sandbox remoto, benchmark de carga e verificação remota do pedido #12 não foram executados, conforme o escopo. Referências a pedido 12 em fixtures são sintéticas; o pedido real não foi acessado ou alterado.

## Gates e diff

- `pnpm check`: aprovado, cliente e servidor sem erros TypeScript.
- `pnpm build`: aprovado, cliente Vite e servidor esbuild.
- `git diff --check`: aprovado, saída vazia e código 0.
- `git diff --stat`: **14 arquivos rastreados, 573 inserções e 143 remoções**, após limpeza equivalente.
- `git diff --stat` não inclui arquivos novos ainda não rastreados: os dois testes novos (40 + 407 linhas) e este relatório. Todos permanecem locais para revisão; nada foi adicionado ao índice.

### Diff final por arquivo rastreado

```text
client/src/components/CartDrawer.tsx          | 20
client/src/components/PreorderInfo.tsx        | 4
client/src/components/ProductCard.tsx         | 13
client/src/contexts/CartContext.tsx           | 336
client/src/pages/Carrinho.tsx                 | 52
client/src/pages/Home.tsx                     | 5
client/src/pages/Pagamento.tsx                | 140
client/src/pages/ProductDetail.tsx            | 58
client/src/pages/Produtos.tsx                 | 2
server/database/preorder.mysql.test.ts        | 27
server/db.ts                                 | 28
server/routers/orders.ts                     | 12
server/routers/products.ts                   | 6
shared/preorder.ts                           | 13
14 files changed, 573 insertions(+), 143 deletions(-)
```

## Integridade e riscos remanescentes

Os testes completos e a equivalência confirmam preservação de máximo/restante, reservas pendentes e pagas sem duplicação, capacidade compartilhada, sacolas antigas, bloqueio antes do provedor, concorrência, cancelamento, STOCK e lotes sem máximo. Asaas e confirmação via webhook foram verificados com mocks locais; seu código não foi alterado. Pedido real #12 preservado por ausência total de acesso remoto.

Disponibilidade é um snapshot informativo e pode mudar entre consulta e clique. O polling tem intervalo de 15 segundos e é pausado em abas em segundo plano pelo comportamento padrão do cliente; o checkout transacional continua sendo a autoridade final. A consulta periódica da sacola usa o endpoint de catálogo existente com limite 10000 e aumenta o volume de leituras; acompanhar esse custo na homologação. Não foi realizado benchmark de carga.

## Preparação de publicação: somente staging, autorização futura

São necessárias publicações de **backend e frontend**, usando os artefatos completos do processo normal de build, não copiando arquivos TypeScript avulsos.

- Backend: `server/db.ts`, `server/routers/products.ts`, `server/routers/orders.ts` e `shared/preorder.ts`.
- Frontend: os nove arquivos de componentes/contexto/páginas do inventário e `shared/preorder.ts`.
- Testes e relatório: entram na revisão/CI da origem; não são alterações de runtime a publicar separadamente.
- **Sem mudança de schema, migration, dependência ou variável de runtime.** O schema PREORDER preexistente é pré-requisito. Confirmar sua presença no staging autorizado antes de publicar; não executar `db:push` ou migrations antigas por suposição.

Compatibilidade temporária: `productionBatch.capacity` é aditivo e opcional; o frontend anterior ignora o novo campo, o contrato de entrada dos pedidos permanece igual e a autoridade transacional continua no backend. Com frontend anterior, o bloqueio visual ainda não estará completo, mas o backend impede excesso. O frontend novo tolera ausência de capacidade no backend anterior, sem assegurar a nova informação visual. Por isso, publicar **backend primeiro**.

Sequência recomendada, a executar somente após autorização específica:

1. Confirmar origem limpa revisada, Node 22.23.2, SHA da release e IDs dos deployments atuais de backend/frontend para rollback. O SHA temporário desta auditoria não substitui uma release revisada no repositório real.
2. Reconfirmar isolamento dos destinos: Railway projeto `l4ckos-staging` (`2bb90c8e-eb65-43ee-826b-f93750f0499c`), serviço `l4ckos-staging`, ambiente interno chamado `production` **somente desse projeto isolado**; Vercel projeto `l4ckos-staging`. Se qualquer identidade divergir ou for ambígua, parar. Não usar o projeto real de produção.
3. Publicar backend no staging; verificar saúde e contrato de catálogo em `https://api-staging.l4ckos.com.br`, ainda com frontend antigo.
4. Publicar frontend do staging (`https://staging.l4ckos.com.br`), confirmar que aponta para o backend de staging e verificar versão dos artefatos.
5. Executar homologação abaixo. Integrações de pagamento exclusivamente Asaas Sandbox; não promover produção nesta etapa.

### Homologação após publicação autorizada

Primeiro, verificações sem escrita: lote sintético OPEN esgotado retorna máximo 2/comprometido 2/restante 0; vitrine e produto exibem esgotamento; sacola antiga com 4 peças bloqueia checkout e incrementos; polling/foco atualizam disponibilidade; STOCK e lote sem máximo continuam navegáveis. Não consultar nem modificar pedido real #12 como parte desta auditoria.

Em uma fase **separadamente autorizada para escritas sintéticas no staging**, testar novo lote com capacidade, produtos/variantes compartilhando limite, pagamento pendente ocupando capacidade, cancelamento liberando reserva, concorrência, confirmação Sandbox sem reserva duplicada e rejeição sem chamada ao provedor. Usar dados novos e descartáveis, nunca pedido #12. Confirmar autenticação/idempotência do webhook com o fluxo homologado, sem modificá-lo. Registrar evidências, SHA e IDs dos deployments. Esta auditoria não autoriza criar pedidos ou cobranças.

### Rollback

Antes de publicar, guardar IDs e SHAs dos deployments de staging comprovadamente bons. Não presumir que HEAD ou seu parent correspondem à versão publicada.

- Falha apenas no frontend: restaurar o deployment anterior do frontend; o backend novo mantém compatibilidade e capacidade transacional.
- Falha no backend: coordenar retorno do frontend anterior e depois do backend anterior comprovadamente bom, que já possua proteção transacional PREORDER e o fluxo de pagamento/webhook homologado. Se a versão anterior não tiver essas garantias, parar e avaliar; não fazer rollback cego.
- Sem rollback de banco: não apagar lotes, reservas, pedidos, pagamentos, tabelas ou migrations. Não reenviar cobranças nem reproduzir webhooks para restaurar estado. Preservar identificadores de tentativas e reservas já confirmadas/pendentes.
- Revalidar saúde, catálogo, checkout sem excesso e isolamento Sandbox após rollback. Nunca executar rollback em produção a partir deste plano.

**APTO PARA STAGING**: implementação local pronta para revisão e publicação posteriormente autorizada. As duas ressalvas técnicas foram resolvidas; TypeScript, build, integridade funcional, testes completos e whitespace estão aprovados. A homologação remota é a próxima fase, não evidência obtida nesta auditoria. Nada foi publicado e este veredito não autoriza deploy ou produção.
