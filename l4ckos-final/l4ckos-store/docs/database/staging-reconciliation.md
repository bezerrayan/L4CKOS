# Executor autorizado de reconciliação de staging

Esta etapa implementa e testa o executor **localmente**. Não autoriza PREPARE,
APPLY, deploy ou escrita remota. A execução exige review do novo RC e autorização
específica posterior. O RC anterior a049864 contém a 0020, mas não este executor.

## Fronteira e alvo

Os comandos genéricos db:migrate/db:baseline/db:bootstrap continuam local-only.
Nenhum flag remoto/force foi adicionado; db:push remoto continua proibido.
A entrada separada usa exclusivamente o projeto l4ckos-staging
(2bb90c8e-eb65-43ee-826b-f93750f0499c), environment interno production
(15545eee-bc02-4b70-afc4-19a5db9e6f46), serviço l4ckos-staging
(9f1c7705-f2f9-48cf-b957-8f63a6bba4db), MySQL exclusivo
(bcda5d78-4a0d-4682-8659-8316847addb7) e api-staging.l4ckos.com.br.
Produção real, qualquer ID/nome divergente e outro backend são recusados.

Não existem selectors de projeto/environment/service/host/URL na CLI. DATABASE_URL
local, flags ALLOW_REMOTE/FORCE e variáveis Railway do processo local não escolhem
alvo. O CLI Railway usa caminho fixo, contexto temporário isolado e ambiente
filtrado, sem alterar o vínculo oficial do repo. Status read-only deve comprovar
serviços, domínio e exatamente um deployment ativo; variáveis dos dois serviços
confirmam IDs e igualdade da conexão privada. Metadata independente de private-network
status, selecionando o ID do MySQL fixo, precisa vincular exatamente um domínio
privado ao hostname usado; conexão mal configurada em env também é recusada.
Credenciais ficam somente em memória.
No serviço remoto, IDs/deployment/private host e digest da conexão são reconfirmados.
As interfaces/adapters são código confiável, não plugins carregados por CLI/env.
Executar código arbitrário com acesso aos arquivos privados/credenciais fica fora
dessa fronteira; não prometer proteção contra o próprio operador/DBA malicioso.

## PREPARE

Exige --commit com SHA completo do **novo RC revisado do executor**, HEAD idêntico
e working tree limpo, com única exceção do .npmrc local nunca empacotado.
Valida a linhagem explícita: somente 0020, checksum aprovado e fingerprints fixos.
Reconfirma identidade, /health 200 e preFingerprint duas vezes; webhook e ambas
as tabelas internas precisam estar ausentes. Faz backup v1 de 25 tabelas via uma
conexão e snapshot REPEATABLE READ/WITH CONSISTENT SNAPSHOT, sem DDL/DML remoto.

O bundle usa fontes/artefatos imutáveis dos objetos Git do RC, não o source do
deployment antigo. É transmitido por stdin via SSH ao serviço fixo e executado
em memória, sem instalar dependências, criar arquivos no runtime ou carregar
aplicação/providers. O runtime precisa de Node/MySQL2 compatíveis e SSH disponível.
A resposta do backup é capturada por pipe privado; nunca vai ao terminal/logs.
SHA-256 calculado na origem é conferido após transferência. A cópia definitiva
fica fora do repo, em backup.json 0600; nenhum segredo de infraestrutura é incluído.
Hashes/tokens de dados da aplicação necessários ao restore permanecem no backup.

A prova automática cria MySQL 8.4 efêmero no Docker **local**, network=none,
sem pull, socket privado 0700, UID do operador e dados em tmpfs. O image mysql:8.4
precisa estar disponível previamente. Prepara canonical-v1 menos webhook, restaura
e valida dados, counts/checksums, constraints/referências e fingerprint. Remove
somente seu container ao final. O Docker daemon local precisa ser acessível.
Depois reconfirma source/identidade/schema e grava plan.json + seal.json privados.

## Plan e APPLY

Raiz fixa /tmp/l4ckos-staging-reconciliation, owner atual e 0700; cada plan usa UUID.
Plan contém metadata segura: SHA do RC, target/deployment/digest da conexão,
0020/kind/checksum, fingerprints, saúde, origem/restore e hashes/counts por tabela.
Não contém linhas, PII, URL, password ou API token. Expira em 15 minutos; backup
precisa continuar recente também. Não há renovação silenciosa.

Digest SHA-256 canônico vincula todos os campos; selo HMAC usa chave local 0600.
Alterar plan e recomputar somente o digest não basta. Guarde a raiz/chave no mesmo
ambiente controlado; não copie plans para outro operador nem exponha backups.
Arquivos não são sobrescritos: O_EXCL/O_NOFOLLOW, owner/permissões/nlink verificados;
diretórios ficam ancorados por file descriptors Linux (/proc/self/fd).
Paths fora da raiz, traversal, symlinks e hardlinks são recusados.

APPLY exige --plan absoluto válido e --confirm exatamente igual ao planId.
Antes de conexão de escrita verifica selo, expiry, SHA do backup, provas, commit,
checksum/manifesto, identidade/deployment e health. Revalida schema e ausência de
ledger. Capability opaca/WeakMap, vinculada à conexão, plan/digest/expiry/target,
entra no **mesmo** runner V2, sem falsear env dos guards locais.

O runner adquire GET_LOCK finito na mesma conexão, revalida pre-state e compara
novo snapshot de counts/checksums com o backup aprovado antes de qualquer DDL.
Autoriza somente as duas estruturas governance-v1, a 0020 estrita e o BASELINE
canonical-v1 após postcondition. Tabela webhook precisa nascer vazia antes de
registrar sucesso. Não autoriza 0021, backfill, writers financeiros ou legacy.
O fingerprint de negócio exclui governança, validada separadamente.

O lock de schema é cooperativo: a janela operacional deve estar sem outros
escritores de DDL/dados. A comparação detecta drift até o último snapshot, mas
não paralisa writers externos durante implicit commits MySQL. Não usar PREPARE
como autorização para um banco que continua recebendo tráfego de escrita.

## Concorrência, replay e recovery

Dois APPLY do mesmo plan são serializados pelo arquivo apply.lock (espera finita),
além do lock MySQL. O segundo valida ledger/fingerprint e retorna ALREADY_APPLIED,
sem novo DDL/ledger. Replay exige plan ainda válido, source e backup intactos,
identidade/health e história verdadeira do RC; não confia somente em result.json.
Plans distintos também ficam protegidos pelo lock MySQL/pre-state.

result.json 0600 registra plan/digest, timestamps, target, migration, fingerprints,
ledger/baseline, health e SHA do backup. Erro após início conserva evidências e
resultado RECOVERY_REQUIRED; não apaga/edita ledger, não retry e não rollback
DDL destrutivo. Perda de transporte é resultado incerto: inspecionar remotamente
em etapa autorizada antes de qualquer nova tentativa. Lock de plan órfão após
crash exige revisão, nunca limpeza automática para forçar execução.

Logs são eventos estruturados sem SQL, URL, dados ou conteúdo de backup. Não
imprimir stderr/stdout bruto de transporte. Backup pós-aplicação e restore
canônico, runtime stability e preservação de dados permanecem etapas operacionais
obrigatórias do controlled application, separadas deste PREPARE/APPLY restrito.

## Exemplos para etapa futura autorizada

```sh
pnpm db:staging:reconcile:prepare --commit <SHA-completo-do-novo-RC-revisado>
pnpm db:staging:reconcile:apply --plan /tmp/l4ckos-staging-reconciliation/<UUID>/plan.json --confirm <UUID>
```

Sem --yes/--force/target custom. .npmrc e artefatos privados não entram em Git.
O executor não faz deploy, push, pedido, webhook, e-mail ou chamada Asaas/Resend.
