# Workflow de schema L4CKOS — implementação local v2

Nenhuma aplicação remota está autorizada por este documento. Todos os comandos
implementados nesta etapa são **local-only** e não possuem override remoto/force.
Node 22.23.2, pnpm/lockfile existentes e MySQL 8.4.x são os alvos de verificação.

## LEGACY MIGRATIONS — DO NOT RUN ON EXISTING DATABASES

`drizzle/0000–0019` e `drizzle/meta` são históricos, mantidos intactos em seus
caminhos. O journal incompleto não é corrigido, nem consumido pelo runner v2.
Não inferir execução histórica a partir de presença de tabelas, números ou SQL.

## Fonte de verdade e estados distintos

`database/bootstrap/v1/*.sql` contém DDL canônico explícito e revisável, em ordem
pai→filho definida por `database/bootstrap/manifest.json`. SHA-256 por arquivo
cobre os bytes exatos, incluindo comentários/newlines. As 25 definições auditadas
foram copiadas da evidência sanitizada versionada da etapa 1, sem contadores de
alocação. A definição de asaasWebhookEvents vem do contrato local schema.ts/0013,
com engine/charset/collation explicitados; não há dependência de executar SQL legado.

`database/schema/contract-v1.json` é a representação estrutural esperada do
TARGET CANONICAL STATE: **26 tabelas**, incluindo webhook, outbox com
processingToken, imagens/banners, extensões financeiras e demais objetos físicos.
Não confundir com o ORM, que representa apenas o domínio ativo. payments,
paymentEvents e notificationOutbox continuam UNKNOWN_REQUIRES_EVIDENCE quanto
à adoção funcional. Nenhum writer/worker financeiro foi criado.

`database/schema/audited-existing-v1.json` representa o estado histórico auditado
em staging em 2026-09-27: **25 tabelas**, sem asaasWebhookEvents. Derivado da mesma
evidência completa, não é uma consulta atual nem um baseline aceito.
O baseline comum exige o contrato **canônico**, recusando esse estado anterior.

Fingerprints aprovados/versionados nesta implementação local:

```text
Canonical v1: f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d
Audited existing v1: 09f647cdda027984d3425bef6ccee9cb3496a648602515b0930465b7b02d9efe
Governance v1: 47462fe9f093c89f83444b2b849ecf488ae7de04557a79e11286bf48484f693b
```

Contratos são artefatos aprováveis em Git. O runtime não gera/aprende um contrato
a partir de qualquer banco encontrado. Mudança de contrato requer diff/revisão,
DDL explícito e novos testes; não editar v1 após sua adoção em ambiente real.

## Fingerprint estrutural

`database/schema/fingerprint.ts` lê information_schema para tabelas/engine/
collation, colunas em ordem física, COLUMN_TYPE (inclusive enum/unsigned),
comprimento/precision/scale, nullability/defaults, generation expression,
AUTO_INCREMENT como atributo, PK/UNIQUE/índices (ordem, prefixo, direção,
visibilidade e expressão), FKs compostas com regras de atualização/exclusão,
CHECKs e enforcement. Views e objetos desconhecidos causam incompatibilidade;
triggers/routines/events não previstos também alteram o contrato.

Objetos/chaves são ordenados deterministicamente com comparação lexical;
SHA-256 cobre JSON canônico. Valores temporais NOW()/CURRENT_TIMESTAMP(0) são
equivalentes, mas precisão diferente e literais varchar não são normalizados.
DEFAULT_GENERATED é marcador de implementação: a expressão/default real permanece.
Nomes de índices/FKs/CHECKs não entram no contrato; sua semântica e multiplicidade
permanecem. CHECK_CLAUSE é preservado conservadoramente, sem simplificar lógica.
Schema self-reference é normalizada para `$self`; referência externa permanece.
Contador AUTO_INCREMENT, cardinalidades, tamanho físico e dados não entram.

Exclusões explícitas do fingerprint de negócio:
`_l4ckos_schema_migrations` e `_l4ckos_schema_executions`. O contrato destas duas
tabelas é validado **separadamente** por governance-v1.json, sem exclusão por prefixo.
Não há hash circular: criar ledger não altera o fingerprint de negócio.

## Ledger e baseline

`_l4ckos_schema_migrations`: id PK/AUTO_INCREMENT, name UNIQUE, kind
(BASELINE/MIGRATION/RECONCILIATION), checksum, applicationCommit, description,
preFingerprint, postFingerprint, manifestVersion, runnerVersion, appliedAt UTC
com milissegundos e executionDurationMs. CHECKs validam os formatos de SHA.

Baseline significa **schema inspecionado e aceito naquele estado**. Não significa
que migrations legadas rodaram. `baseline-v1` usa checksum dos bytes do contrato,
fingerprints canônicos iguais e descrição EXISTING CANONICAL ou FRESH BOOTSTRAP.
Aceite exige `--accept-fingerprint` explícito, igualdade ao contrato versionado,
identidade local e schema sem drift. Repetição compatível retorna ALREADY_BASELINED,
sem nova linha; incompatibilidade de ledger/checksum/fingerprint falha.

O runner só faz INSERT no ledger. Não há UPDATE/DELETE/UPSERT/repair de registros
concluídos. O operador futuro deve usar privilégios sem UPDATE/DELETE nessa tabela,
separados do UPDATE da trilha de execução. Um DBA com privilégios administrativos
pode adulterar objetos: não prometer proteção criptográfica contra esse ator.
Checksums/cadeia verificam registros contra os artefatos versionados a cada execução.
Não coexistir com outro runner autoritativo ou fabricar __drizzle_migrations.

## Bootstrap fresh

`db:bootstrap` exige banco já criado **sem nenhum objeto**, incluindo governança.
Valida checksums de todos os artefatos antes de escrever. Cria governança,
registra tentativa, executa os 26 CREATEs sem dados de negócio, valida o fingerprint
e grava exatamente um BASELINE com descrição FRESH BOOTSTRAP. Registro de sucesso
e conclusão da trilha são DML em uma transação posterior ao DDL. Dois bancos
independentes devem produzir o mesmo fingerprint, comprovado em teste real.
Bootstrap repetido é recusado; não usar IF NOT EXISTS para esconder schema parcial.

## Nova linhagem / runner v2

`database/migrations/manifest.json` é a única descoberta autorizada. O bloco
`unbaselined.reconciliations` contém somente a 0020; `migrations: []` continua
sem migrations ordinárias. Fixtures de testes na mesma árvore não são descobertas. Paths devem ficar dentro de database/migrations, inclusive
após resolver symlinks; caminhos legados/escapes são rejeitados.

Cada entrada tem name, kind, path, checksum exato, description,
expectedPreFingerprint e expectedPostFingerprint. A ordem da lista é a ordem
oficial; dependências/fingerprints devem encadear. SQL usa conexão com
multipleStatements=false; para arquivos com mais de um statement, separar com
uma linha exata `-- l4ckos:statement-breakpoint`. Session control, USE, alterações
da governança e desabilitação de FKs não fazem parte das migrations de negócio.
Scripts SQL são código confiável revisado em Git, não uploads/input de clientes.

Antes de executar, validar artefatos, governança, baseline/cadeia/checksums,
ausência de recovery pendente e fingerprint corrente. Depois de cada mudança,
validar o postFingerprint **antes** de inserir sucesso. Entradas já aplicadas
são verificadas e não reaplicadas. Checksum divergente bloqueia sem atualizar
registro antigo. Defaults/constraints não são omitidos para fazer testes passar.

## Locks, atomicidade e recovery

GET_LOCK com nome L4CKOS derivado do database é adquirido e liberado na mesma
conexão dedicada. Timeout padrão 1 segundo, limite permitido 0–10; falha aborta.
RELEASE_LOCK acontece em finally, inclusive em erro. Uma conexão não pode ter
operações de schema sobrepostas. Exclusão cooperativa não bloqueia SQL de outros
operadores: o destino precisa estar offline e sem outro escritor de DDL.

DDL MySQL pode fazer implicit commit. `_l4ckos_schema_executions` guarda STARTED,
FAILED/COMPLETED, checksum/commit, checkpoint de statements concluídos,
pre/observed fingerprint e erro sanitizado. Falha parcial mantém objetos alterados
e evidências, retorna RECOVERY_REQUIRED e **não** insere migration concluída.
STARTED/FAILED bloqueiam novas tentativas. Não há retry ou limpeza automática.
Se governança falhar durante seu próprio CREATE inicial, pode não existir trilha
completa; preservar o schema parcial e a evidência sanitizada retornada pelo CLI.
Banco não vazio impede repetir bootstrap. Não afirmar rollback do DDL.

Recovery exige inspeção do estado real, preservação das evidências, artefatos e
plano compensatório revisado/autorizado. Não apagar a trilha, trocar checksum,
preencher ledger à mão ou usar --force. Perda de conexão pode tornar o resultado
incerto: verificar ledger e trilha antes de qualquer nova operação. Ferramenta
automática de recovery não faz parte desta etapa.

## Reconciliação futura de existing DB

O runner suporta **somente quando declarado explicitamente no novo manifesto**
um bloco `unbaselined`, com expectedInitialFingerprint reconhecido e lista
ordenada `reconciliations`. Ela deve partir do estado auditado versionado (ou
canônico para teste local) e alcançar o canônico. O manifesto oficial aceita
somente o pre-state exato da 0020 e não inicializa governança num banco arbitrário.

### 0020 — primeira RECONCILIATION da nova linhagem

Arquivo: `database/migrations/0020_reconcile_asaas_webhook_events.sql`.
Nome: `0020_reconcile_asaas_webhook_events`; kind: `RECONCILIATION`.
DDL byte a byte igual ao CREATE do bootstrap canônico: somente asaasWebhookEvents,
PK int AUTO_INCREMENT, eventId varchar(191) UNIQUE, campos nullable preservados,
status processing/processed/failed, timestamps/defaults, InnoDB e utf8mb4_unicode_ci.
Strict CREATE, sem IF NOT EXISTS. Não há INSERT/UPDATE/DELETE de negócio nem
backfill: a tabela nasce vazia; histórico de webhooks não é inventado.

```text
preFingerprint:  09f647cdda027984d3425bef6ccee9cb3496a648602515b0930465b7b02d9efe
postFingerprint: f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d
SQL SHA-256:     cad11dda08787cf7935390a1531002627f7a2894455ad250357b0ec1fa050423
```

O pre-state local é derivado explicitamente dos CREATEs aprovados do bootstrap,
excluindo somente asaasWebhookEvents; não executa legacy. O teste comprova que
todas as outras estruturas permanecem idênticas após 0020. Tabela já existente,
tabela desconhecida ou qualquer outro drift falha antes de criar governança/DDL.
Um byte alterado de SQL invalida o checksum antes de execução.

Com aceite explícito do contrato canônico, o runner local adquire lock, verifica
pre-state, cria/valida governança, executa somente 0020 e exige o postFingerprint
canônico antes de gravar RECONCILIATION. Em seguida aceita automaticamente o
BASELINE canônico: descrição POST RECONCILIATION, schema existente reconciliado,
canonical-v1 validado como ponto inicial confiável; sem afirmação de execução
legacy. `db:baseline` posterior retorna ALREADY_BASELINED. Reexecutar `db:migrate`
valida checksums/cadeia/fingerprint e retorna UP_TO_DATE, sem DDL ou duplicatas.

Fresh bootstrap pula o bloco existing-only **sem registrar** sua execução.
Histórico existing começa por RECONCILIATION e depois BASELINE; histórico fresh
começa por BASELINE. Ambas as cadeias convergem ao mesmo contrato para migrations
comuns. Falha/acknowledgement incerto após CREATE mantém evidência FAILED/STARTED,
sem registrar sucesso nem baseline e bloqueando retry com RECOVERY_REQUIRED.

Ordem futura **sujeita a autorização específica**, ainda sem aplicação remota:

1. Preflight: reconfirmar projeto/ID/environment/service e MySQL exclusivo de
   staging, versão, existência da tabela/governança e metadata read-only atual.
   Fingerprint atual deve ser **exatamente** o preFingerprint; diferença é NO-GO.
2. Backup operacional imediatamente antes da escrita, com restore comprovado e
   preservação de ledger/trilha quando existentes. Nenhum backup remoto foi
   autorizado nesta etapa de preparação da 0020.
3. Reconciliation: executar o SQL/checksum revisado, sob lock e sem legacy/backfill.
4. Validate: exigir contrato/fingerprint canônico e registrar execução verdadeira.
5. Baseline: aceitar canonical-v1 como início confiável da governança, depois da
   reconciliação e validação (no runner local, passo automático sob o mesmo lock).
6. Smoke: validar runtime e contrato de webhook, dentro do escopo autorizado.

Read-only preflight não autoriza escrita, criação de ledger, baseline ou deploy.
Não adaptar automaticamente a migration caso a inspeção atual revele drift.

Os guards implementados permanecem local-only: autorização remota e confirmação
de alvo precisarão de uma etapa própria, sem remover controles genericamente.
Produção exige autorização concreta, inventário próprio, backups/restores,
constraints/owners, janela, recovery e gates; não presumir equivalência a staging.

## CLI local

Comandos não carregam `.env`, não descobrem DATABASE_URL e não imprimem secrets.
Exigem L4CKOS_LOCAL_SCHEMA=1, NODE_ENV diferente de production, ausência de
RAILWAY_*, host literal local, banco l4ckos_local_* / l4ckos_test_* e URL sem
query/fragment. Socket opcional fica em `/tmp/l4ckos-<id>/mysqld.sock`. Configuração
efetiva da conexão, MySQL 8.4, autocommit, FKs ativas e strict mode são conferidos.
Use conexão recém-aberta dedicada; não inicie uma transação antes do runner.

```sh
export PATH=/home/yan/.nvm/versions/node/v22.23.2/bin:$PATH
export NODE_ENV=test
export L4CKOS_LOCAL_SCHEMA=1
export L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-reconciliation-socket/mysqld.sock
export DATABASE_URL=mysql://root@localhost/l4ckos_test_example
pnpm db:schema:fingerprint
pnpm db:bootstrap --accept-fingerprint f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d
pnpm db:baseline --accept-fingerprint f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d
pnpm db:migrate --accept-fingerprint f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d
```

Bootstrap não cria o database; operador/teste cria somente o banco local vazio.
`db:push` foi substituído por wrapper que recusa remote/Railway/production antes
de chamar Drizzle, sem expor URL. Sem flags/config custom ou socket; Drizzle usa
exatamente a URL local fornecida. É ferramenta para **dev descartável**, pois ORM
não representa todas as extensões preservadas; nunca usar para reconciliação,
bootstrap canônico ou banco existente. Acesso direto ao binário não é workflow
oficial e não deve ser usado para contornar o wrapper.

## Backup v1 e testes

Backup de dados v1 agora reconhece explicitamente as duas tabelas internas e
valida sua estrutura separadamente. Não as captura nem sobrescreve: governança
do destino é criada pelo bootstrap e atesta as operações realmente feitas ali.
Restauração requer tabelas **de negócio** vazias, podendo já existir BASELINE de
fresh bootstrap. Fingerprint de negócio e todos os dados/centavos/outbox ficam
iguais; timestamps de governança são fatos próprios de cada destino.
Backup completo para disaster recovery de ambiente remoto deve também preservar
ledger/trilha via dump operacional separado, com retenção e restore comprovados.

`L4CKOS_MYSQL_TEST=1 pnpm test` usa a instância MySQL efêmera via socket, sem rede
externa. Confira instruções do container em backup-restore.md. Suíte compara
DDL com inventário auditado independente, bootstrap em dois bancos, baseline,
drift/tabelas desconhecidas, UNIQUE/AUTO_INCREMENT/CHECK, legacy isolation,
checksum SQL/ledger, dois runners concorrentes, falha parcial/postcondition,
caminho unbaselined e backup/restore de 26 tabelas. Somente bancos criados com
sucesso pelo teste são removidos; nomes preexistentes nunca são descartados.
