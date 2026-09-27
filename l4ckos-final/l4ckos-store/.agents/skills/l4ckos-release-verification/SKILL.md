---
name: l4ckos-release-verification
description: Verifica origem, schema, runtime e evidências de releases L4CKOS. Use em release, RC, deploy/redeploy, migration, smoke, homologação, rollback ou promoção de ambiente.
---

# Verificação de release

Para operações remotas, aplique primeiro [l4ckos-staging-safety](../l4ckos-staging-safety/SKILL.md). Siga apenas as fases autorizadas; a sequência não concede permissão para executar a próxima.

`SOURCE → PREFLIGHT → SCHEMA/CONFIG → DEPLOY → STARTUP → HEALTH → FUNCTIONAL SMOKE → PROVIDER/EXTERNAL EVIDENCE → FINAL VERDICT`

## Origem e gates

- Registre SHA completo, parent SHA, branch, working tree e arquivos do escopo. Preserve alterações locais; nunca construa um release a partir de working tree sujo.
- Para deploy manual crítico, prefira worktree limpo detached no SHA exato. Confirme HEAD, `git status --porcelain` vazio e `.npmrc` ausente; exclua arquivos locais/artefatos não commitados do contexto.
- Execute os gates locais pertinentes com runtime e scripts verificados: check, testes relevantes/suíte, build e Docker/startup quando houver risco de runtime. Não instale/atualize dependências nem use `--fix` como efeito implícito da verificação.

## Schema, configuração e rollback

- Separe migration de deploy quando possível. Compare SQL versionado com schema: nomes, tipos, defaults, nullability, enums, PK, UNIQUE e FKs; `AUTO_INCREMENT` precisa de chave compatível. Valide DDL novo em MySQL local/efêmero compatível antes da aplicação remota autorizada.
- Migrations devem ser forward-only. Inspecione estrutura e histórico reais; não aplique migrations antigas cegamente nem `db:push` amplo em banco com drift. Nunca falsifique migration history. Preserve migrations já aplicadas.
- Use o runner oficial quando o histórico for confiável. DDL isolado em banco com histórico irregular exige autorização específica e deve corresponder exatamente ao arquivo/SHA revisado, sem migrations adjacentes ou backfill implícito.
- Antes da escrita, confirme backup/restore ou rollback viável e registre snapshots read-only. Depois compare estrutura, contagens e campos/hashes relevantes; contagens iguais sozinhas não provam preservação dos dados.
- Documente rollback exato e suas condições; DDL MySQL pode fazer commit implícito. Em falha, pare, registre estado parcial e não tente reparar automaticamente nem apagar evidências.

## Deploy e evidência

- Registre deployment ID, origem/SHA e configuração efetiva sem segredos. Aplicar staged configuration no Railway pode disparar deployment da branch GitHub integrada: **não presuma que “Deploy” usa o RC local**. Verifique source/SHA do deployment ativo; drift não revisado bloqueia homologação.
- `Build SUCCESS` sozinho não aprova deploy. Confirme startup, processo ativo/estável, ausência de crash/restart, healthcheck e GET `/health` HTTP 200. Antes de usar a resposta pública como prova, confirme que o deployment novo é o ativo.
- Deploy não executa smoke com escrita/efeitos externos automaticamente. Em smoke autorizado, use fixtures sintéticos e caminho normal da aplicação, registre mutations/audits e snapshots; não repita uma operação com resultado incerto.
- Preserve fixtures/evidências até o término da homologação e autorização de limpeza. Separe aceite local, estado do provider e entrega efetiva; registre verificações externas pendentes.
- Emita GO/NO-GO **para a próxima etapa especificada**, com evidência, blockers concretos, warnings e limitações. Não transforme GO de staging em autorização de produção.

Referência histórica de homologação do fluxo e-mail/outbox em 2026-09-27: `28910fcdc616a95ce522bbe9860f1911e96ff5e9`. Não presumir HEAD ou deployment atual a partir dessa referência; revalidar em cada execução.
