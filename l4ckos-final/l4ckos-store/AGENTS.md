# L4CKOS repository instructions

- Produção real é proibida por padrão. Para Railway, Vercel, banco ou qualquer operação remota, use `$l4ckos-staging-safety` ([instruções](.agents/skills/l4ckos-staging-safety/SKILL.md)). Pare diante de alvo ambíguo.
- Para releases, RCs, deploys, migrations, smoke, homologação, rollback ou promoção, use `$l4ckos-release-verification` ([instruções](.agents/skills/l4ckos-release-verification/SKILL.md)).
- Para Resend, e-mail, templates, unsubscribe, review requests, scheduling ou outbox, use `$l4ckos-email-safety` ([instruções](.agents/skills/l4ckos-email-safety/SKILL.md)).
- Para mudanças sensíveis à segurança em runtime, configuração ou schema, use `$l4ckos-security-review` ([instruções](.agents/skills/l4ckos-security-review/SKILL.md)).
- Use `$l4ckos-pentest-staging` somente quando o usuário pedir explicitamente teste de segurança/pentest/red-team autorizado da L4CKOS ([instruções](.agents/skills/l4ckos-pentest-staging/SKILL.md)).
- Combine as skills aplicáveis; leia os respectivos `SKILL.md` antes de agir.
- Nunca faça commit do `.npmrc` local. Preserve alterações do usuário; não descarte trabalho não relacionado silenciosamente.
- Prefira Node **22.23.2** na verificação do backend, salvo mudança intencional da configuração do projeto. Confirme scripts e gerenciador no `package.json`/lockfile.
- Alterações exclusivamente documentais exigem validação documental, não build completo da aplicação.
