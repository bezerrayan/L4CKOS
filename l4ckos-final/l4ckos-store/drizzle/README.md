# LEGACY MIGRATIONS — DO NOT RUN ON EXISTING DATABASES

SQL 0000–0019 e `meta/` preservam história incompleta. Não representam uma cadeia
executável sobre o schema existente; não preencher retroativamente o journal.
Os arquivos permanecem nos caminhos originais para compatibilidade das ferramentas.

O runner oficial novo lê somente `database/migrations/manifest.json`. Bootstrap
usa somente `database/bootstrap/manifest.json`; nenhum deles descobre este diretório.
`db:push` é ferramenta guardada exclusivamente para bancos locais descartáveis e
não define o contrato físico completo. Consulte `docs/database/migration-workflow.md`.
