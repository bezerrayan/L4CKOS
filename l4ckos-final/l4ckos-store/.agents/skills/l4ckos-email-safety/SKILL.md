---
name: l4ckos-email-safety
description: Orienta segurança, evidência e idempotência dos e-mails L4CKOS. Use para Resend, envio, templates, e-mails transacionais/marketing, unsubscribe, review request, scheduling, outbox ou idempotência de e-mail.
---

# E-mail e outbox

Para acesso remoto, aplique [l4ckos-staging-safety](../l4ckos-staging-safety/SKILL.md); para smoke/release, aplique também [l4ckos-release-verification](../l4ckos-release-verification/SKILL.md).

## Destinatário e provider

- Em staging, envie somente com autorização para o fluxo e para destinatário sintético/controlado. Nunca use cliente real em smoke. Quando `STAGING_CLIENT_EMAIL` for a fonte aprovada, compare o destinatário resolvido sem revelar seu valor; não suponha que uma allowlist externa é aplicada pelo código.
- Não imprima endereço completo desnecessariamente. Verifique remetente autorizado, classificação transacional/marketing, consentimento/descadastro aplicáveis e fallbacks de URLs antes do envio.
- Respeite least privilege: não amplie scope da API key nem crie credenciais para facilitar auditoria. Uma chave sending-only não deve ser usada para listar mensagens; separe auditoria read-only externa do envio quando necessário.
- Aceite pelo provider, `scheduled`, `sent` e `delivered` são evidências diferentes. Não declare entrega em mailbox sem evento correspondente; correlacione provider ID, timestamps e outbox sem conteúdo sensível.

## Idempotência e falhas

- Exija chave lógica persistente única por pedido + tipo de evento; memória local ou “consultar antes de enviar” não bastam. Reentrada após sucesso não pode reenviar nem modificar provider metadata, tentativa ou agendamento original.
- Use provider idempotency key determinística quando suportada. Tanto aceite do provider quanto persistência local devem ser auditáveis; resultado incerto não autoriza reenvio automático.
- O claim deve ser atômico e proteger concorrência. Torne observáveis os estados não iniciado/pending, processing, sent/agendado e failed, com tentativas, timestamps e IDs correlacionáveis.
- Processing órfão exige lease com expiração e reclaim atômico, nunca reset cego para pending. Worker antigo não pode finalizar uma lease substituída. Avalie a janela de idempotência do provider antes de recuperar resultado ambíguo; startup não deve despachar evidências históricas por surpresa.
- Erros após claim devem persistir failed, timestamp e erro sanitizado; falha dessa persistência precisa de log explícito e recuperação por lease. Não use `catch {}` silencioso nem deixe erro comum abandonar processing.
- Drizzle/MySQL pode encapsular `ER_DUP_ENTRY` em `error.cause.code` (errno 1062). Na reserva, reconheça exclusivamente a duplicidade esperada da chave lógica, sem parsing textual nem mascarar outros erros; preserve o evento existente.

## Review e verificação

- A review request em homologação usa aproximadamente **+5 minutos**. Confirme `scheduledAt`, delta real, provider ID e hosts de review/unsubscribe conforme o staging definido na skill de isolamento; inspecione todos os links/fallbacks.
- Nunca clique automaticamente em review/unsubscribe durante smoke. Considere descadastro após agendamento ao revisar mudanças nesse fluxo.
- Para mudanças de outbox, cubra reentrada, concorrência, erro normal, falha do provider e crash/reclaim com provider mockado e banco local quando necessário. Qualquer envio remoto requer o escopo autorizado do teste.
