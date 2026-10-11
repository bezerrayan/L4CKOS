# L4CKOS — Backup lógico e validação do MySQL staging

**GO para o gate de backup desta cópia, restaurada e validada localmente. NO-GO para executar a migration 0022 ou publicar nesta operação.** Esta entrega autoriza somente leitura/exportação remota e restauração local. Não houve deploy/restart remoto, migration, mudança de plano/porta/configuração, DML remoto, operação financeira, commit ou push. Produção e seus metadados não foram acessados. Nenhuma ação de negócio ou alteração foi realizada no pedido #12.

## Identidade e origem

| Item | Identidade conferida |
|---|---|
| Release candidate local | `ce9e84946d2773cdadee61254fc3ba5592f05001` |
| Branch | `feat/preorder-batch` |
| Railway CLI | 5.64.1; CLI e SSH disponíveis |
| Projeto exclusivo | `l4ckos-staging` |
| Project ID | `2bb90c8e-eb65-43ee-826b-f93750f0499c` |
| Environment ID | `15545eee-bc02-4b70-afc4-19a5db9e6f46` |
| Nome interno do environment | `production`, pertencente somente ao projeto staging acima |
| Serviço MySQL | `mysql` / `bcda5d78-4a0d-4682-8659-8316847addb7` |
| Deployment MySQL ativo observado | `23828bf1-c7d6-4ef2-b6d5-91dfe812fd89` |
| Database exportado | `l4ckos_staging` |
| MySQL/mysqldump remoto | 8.4.11 |
| MySQL de restauração | 8.4.11, imagem local `mysql:8.4`, sem pull |

Metadados consultados com `railway status --project <ID staging> --environment <ID autorizado> --json`, em diretório temporário isolado. Nenhum vínculo do repositório foi modificado. SSH sempre recebeu project/environment/service IDs explícitos; identidade e deployment foram reconferidos dentro do serviço antes das leituras. Conexão MySQL remota por loopback dentro desse serviço; nenhuma porta pública foi criada. Não foram consultados serviços de produção nem o backend para obter credenciais.

## Preflight e consistência

- **30 tabelas, todas InnoDB**; tamanho estimado dados + índices: **1.228.800 bytes**. Nenhuma view, trigger, routine ou event observados (contagens zero).
- Ferramentas remotas existentes: mysql, mysqldump, gzip, df e sh. Nenhuma instalação.
- Privilégios necessários confirmados: SELECT, SHOW VIEW, TRIGGER, EVENT e SHOW_ROUTINE. A representação dos grants lista privilégios explicitamente; não depende da expressão ALL PRIVILEGES. Grants brutos, senha e URL autenticada não constam neste relatório.
- Espaço local disponível antes da exportação: **10,391,265,280 bytes**. Exigido mínimo de 256 MiB ou 20× tamanho estimado, o maior. Espaço remoto disponível observado: aproximadamente 2,05 TB na raiz e 4,49 GB no volume MySQL; nenhum dump foi gravado nesses volumes.
- Dump usa snapshot transacional com `--single-transaction --quick --skip-lock-tables`; não executa DML nem DDL no remoto. Não houve pausa/configuração da aplicação nesta tarefa. Schema/DDL, contagens e checksums de conteúdo por tabela foram comparados antes e depois da exportação: **iguais**. Leituras CHECKSUM TABLE EXTENDED não alteram dados.

## Método, datas e artefato privado

Execução remota de mysqldump via SSH; stdout do dump canalizado diretamente para gzip local, sem imprimir registros ou gravar arquivo remoto. Credencial resolvida somente dentro do serviço por variável de ambiente, sem senha em argumentos de processo, relatório ou Git. Códigos/erros foram filtrados; saídas privadas do transporte não foram publicadas.

Início do dump: **09/10/2026 22:18:29 UTC / 09/10/2026 19:18:29 Brasília (UTC−3)**.
Fim da exportação e evidências posteriores: **09/10/2026 22:18:38 UTC / 09/10/2026 19:18:38 Brasília (UTC−3)**.
Validação local do conteúdo: **09/10/2026 22:23:26 UTC / 09/10/2026 19:23:26 Brasília (UTC−3)**.
Conferência final de integridade/permissões e parada do contêiner: **09/10/2026 22:27:13 UTC / 09/10/2026 19:27:13 Brasília (UTC−3)**.

```text
/home/yan/.local/share/l4ckos/staging-backups/20261009T221822Z/l4ckos-staging.sql.gz
```

| Propriedade | Resultado |
|---|---|
| Tamanho comprimido | **22,542 bytes** |
| Tamanho SQL descomprimido | **133,881 bytes** |
| SHA-256 do gzip | `96fc3beb86861455196aa98ac465a3b76e6e6a83c3ca3422513477d8428a2848` |
| Integridade gzip | PASS, descompressão integral verificada |
| SHA-256 após restauração | PASS, igual ao arquivo exportado |
| Permissões | Diretórios 0700; arquivo, checksum e manifests/provas 0600 |
| Localização | Privada, fora do repositório, preservada nesta máquina |

No mesmo diretório privado: `SHA256SUMS`, `backup-manifest.json`, `source-before.json`, `source-after.json`, `restore-proof.json` e evidências privadas de schema/diagnóstico. Não incluir esses arquivos no Git, chat ou serviços externos. O backup contém dados sensíveis da aplicação; não é um artefato público de release.

Opções utilizadas (além de host loopback, usuário e database):

```text
--single-transaction --quick --routines --events --triggers --hex-blob --set-gtid-purged=OFF --no-tablespaces --skip-lock-tables --skip-add-locks --skip-disable-keys --order-by-primary --complete-insert --skip-extended-insert --tz-utc --default-character-set=utf8mb4 --skip-comments --column-statistics=0
```

Exportado o database completo da aplicação, incluindo audit, pagamentos/webhooks, outbox e ledger de schema. Não foram exportados os schemas internos do servidor MySQL nem contas/grants globais. O backup não inclui arquivos externos de storage ou configuração de provedores.

## Restauração isolada e validação

Criado contêiner exclusivo `l4ckos-staging-backup-restore-20261009t221822z`, com `--network none`, sem portas publicadas, dados em tmpfs e socket privado. Nenhuma aplicação/worker foi iniciado; event_scheduler OFF e binlog desabilitado no MySQL local. Criado somente o schema local vazio `l4ckos_test_backup_restore`; SQL enviado por stdin exclusivamente para `docker exec ... mysql`. Nenhum comando de restore foi dirigido ao SSH ou banco remoto.

| Validação | Resultado |
|---|---|
| Importação SQL local | PASS, saída 0 |
| Tabelas restauradas | **30/30**, conjunto igual ao da fonte |
| Registros agregados | **208/208** |
| Integridade de dados por tabela | **30/30** contagens e CHECKSUM TABLE EXTENDED iguais à fonte; comparação vai além das contagens |
| Chaves estrangeiras | **10 verificações; 0 órfãos** |
| Fingerprint estrutural de negócio | `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a` — igual ao contrato v2 versionado |
| Fingerprint de governança | `47462fe9f093c89f83444b2b849ecf488ae7de04557a79e11286bf48484f693b` — igual ao contrato de governança versionado |
| Ledger de migrations | Nomes, tipos, checksums, fingerprints e applicationCommit iguais à fonte |
| DDL | Equivalência integral após duas normalizações delimitadas; fingerprints também conferidos |
| Contêiner final | Parado; backup e evidências preservados; nenhum serviço local da aplicação iniciado |

Ocorrências de verificação, sem ocultar falhas: a primeira chamada do validador local retornou `LOCAL_RESTORE_VALIDATION_FAILED` após a importação SQL já ter terminado. O erro original não foi apresentado em bruto; não se atribui causa não comprovada. O gate permaneceu NO-GO durante a investigação. A repetição do mesmo validador, sobre o mesmo restore, retornou 0 e aprovou as verificações acima; processo principal mysqld e isolamento foram confirmados antes do aceite final.

A comparação literal adicional dos dumps de DDL falhou inicialmente: o MySQL restaurado explicitou `CHARACTER SET utf8mb4` em colunas que já tinham `COLLATE utf8mb4_unicode_ci` e reserializou `DEFAULT (now())` como `DEFAULT CURRENT_TIMESTAMP`. Após normalizar **somente essas duas representações equivalentes**, os DDLs inteiros coincidiram; nenhuma coluna, índice, constraint, valor literal de negócio ou dado foi ignorado. Hash SHA-256 do DDL normalizado: `0bda4967f1b0404a3e482f2698555f069cd859fd6217b36ed17a4f7f19af403d`. O hash do backup permaneceu intacto. A falha da comparação bruta e o resultado normalizado estão separados na prova privada.

## Migrations e ausência de 0022

| Registro existente | Estado observado |
|---|---|
| `0020_reconcile_asaas_webhook_events` | Ledger presente; execução COMPLETED; checksum igual ao manifesto aprovado |
| `baseline-v1` | Ledger e execução COMPLETED preservados; não foi regravado/recriado no remoto |
| `0021_preorder_production_batches` | Ledger presente; execução COMPLETED; checksum/pre/post fingerprints iguais ao manifesto aprovado |
| `0022_preorder_manufacturing_schedule` | **Ausente do ledger e dos registros de execução observados** |

As cinco colunas adicionadas por 0022 estão **ausentes na fonte e no restore**; fingerprint v2 confirmado. Nenhuma 0022 foi executada, nem localmente, nesta operação. A comparação das migrations não inventou histórico nem reaplicou baseline/0020/0021.

## Riscos, limites e procedimento futuro

- Snapshot lógico de um momento, sem PITR/binlogs ou snapshot nativo Railway; não protege alterações posteriores. Contagens/checksums/DDL antes/depois iguais sustentam a consistência observada, mas não congelam o staging. Antes de migration futura autorizada, definir janela, coordenar ausência de DDL concorrente, revalidar identidade e estado e produzir backup atual se houver qualquer mudança relevante.
- Não houve pausa de tráfego ou transações no staging. Single-transaction garante snapshot dos dados InnoDB; DDL concorrente não é coberto por essa garantia. O DDL observado antes/depois e na leitura adicional permaneceu igual.
- Uma cópia persistente local, fora do runtime e Git, foi validada. Não existe cópia off-site nesta operação; backup não foi enviado a serviço externo. Retenção, redundância e política de armazenamento continuam decisões operacionais. Gzip comprime, sem criptografia adicional; acesso restrito do diretório/arquivo foi confirmado.
- CHECKSUM TABLE é evidência de conteúdo, sem ser um hash criptográfico por linha. SHA-256 comprova integridade do arquivo; fingerprints estruturais, restore completo, ledger e FKs complementam a validação básica. Não foi executada auditoria de cada regra de negócio nem reativado processamento de pagamentos/e-mails.
- Recuperação futura deve restaurar primeiro em alvo isolado, verificar checksum/schema/dados/ledger e reconciliar eventos posteriores antes de qualquer substituição autorizada. Nunca restaurar cegamente sobre o staging ativo. Contas/permissões do servidor, storage externo e credenciais precisam de plano separado de recuperação.
- Não usar a ferramenta local de restore como caminho para operação remota. Executor governado da 0022, autorização específica, janela, backup atualizado e gates da [RC](staging-release-candidate.md) permanecem necessários. DDL MySQL tem commits implícitos; este GO não autoriza aplicar a migration.

## Veredito

**GO — gate de backup validado para o artefato identificado**, com restore local, integridade de conteúdo/schema/ledger e permissões comprovados. **NO-GO — executar 0022 ou publicar nesta tarefa**: fora do escopo autorizado e dependente de procedimento específico, preflight/janela e origem/configuração de release. O snapshot deve ser reavaliado no momento de uma futura escrita autorizada.

Somente este relatório foi criado no repositório. Scripts/evidências de execução ficaram em /tmp e no diretório privado; dump não foi adicionado ao Git. HEAD da candidata preservado; nenhum commit/push/deploy/publicação nesta operação.
