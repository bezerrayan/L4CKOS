# Fechamento funcional 03/04 — auditoria funcional, operacional e segurança

09/10/2026. **APTO COM RESSALVAS para a última homologação em staging**. Não é autorização de abertura oficial, deploy ou produção. Existem dependências operacionais/comerciais P1 a resolver antes do lançamento, descritas abaixo. Nenhum P0 foi demonstrado no escopo local; isso não prova ausência de vulnerabilidades.

## 1. Escopo e evidências

Worktree `feat/preorder-batch`, HEAD inicial/final `f519c11e94e57f76522db11f04254c5c17874598`, parent `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`. Início: 32 rastreados modificados e 12 novos. Blocos 01/04 e 02/04 preservados, sem descarte, commit, push ou publicação. Skills de isolamento, segurança, e-mail e verificação de release aplicadas.

Inspecionados routers de catálogo/produtos, sacola, favoritos, perfil, pedidos, administração, autenticação e uploads; checkout/ORM, serviços Asaas/frete/e-mail, middleware de sessão, CORS, CSRF, rate limit, image proxy, backup/restore e schema. A auditoria é proporcional e baseada em código/regressões; não é pentest remoto, scanner exaustivo de dependências ou prova de toda configuração de infraestrutura.

Três níveis de evidência:

- **Código:** funcionalidade/controlador existe e caminho foi inspecionado; não implica execução correta no ambiente remoto.
- **Local:** testes automatizados com mocks, MySQL isolado, navegador e artefatos locais.
- **Homologação:** fluxo PREORDER remoto relatado pelo usuário e relatórios anteriores. Nenhuma configuração/deployment remoto foi revalidado nesta tarefa. Não transportar automaticamente essa homologação ao código novo ainda local.

Runtime Node 22.23.2, pnpm/lockfile existentes, sem dependências novas. Nenhuma leitura de `.env` secreto para conexão remota, acesso a Railway/Vercel/produção, dados reais, pedido real #12, pagamento, reembolso, etiqueta ou e-mail real. IDs 12 em mocks da suíte não são o pedido real.

## 2. Inventário funcional

“Implementada e validada” abaixo significa **validada localmente nos cenários citados**, salvo homologação remota explicitamente indicada. Não significa cobertura integral de toda a funcionalidade.

| Funcionalidade | Classificação | Evidência e limite |
| --- | --- | --- |
| Catálogo/categorias | Implementada e validada | Filtros em `products.list`, carregamento de catálogo nos fluxos de navegador. CRUD completo/categorias não possuem homologação remota específica nesta auditoria |
| Cores/tamanhos/variantes | Implementada e validada | Snapshots, ownership de variante, preços/quantidades e demanda MySQL. Alteração administrativa de todas as combinações ainda requer homologação |
| Estoque físico | Implementada e validada | Reserva, consumo, cancelamento, expiry/recovery, rollback e STOCK + PREORDER locais; não presumir inventário físico correto |
| PREORDER/lotes/produção | Implementada e validada | Fluxo remoto anterior relatado pelo usuário; capacidade/concorrência/demanda/snapshots reforçados localmente. Código novo ainda não publicado |
| Fabricação/postagem/transporte | Implementada e validada | Bloco 01/04, componentes/admin/navegador, timezone e migration 0022 locais; exige homologação da versão nova |
| Sacola | Implementada e validada | Sacola local revalidada, antiga/acima de limite, lotes compartilhados e polling. Router persistido autenticado existe; não confundir com sincronização completa da sacola local |
| Favoritos | Implementada, mas não homologada | Router protegido e ownership por `ctx.user.id`; não há prova end-to-end específica de persistência/listagem nesta etapa |
| Cupons/descontos | Implementada e validada | Inteiros monetários, limites/UTC, equação do total e rollback locais. Regras comerciais e criação/edição pelo painel precisam de homologação |
| Cadastro/login local | Implementada; desativada intencionalmente por padrão em runtime production | Flags `ALLOW_LOCAL_AUTH_IN_PRODUCTION`, `ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION` e allowlist; não foram alteradas. Confirmar caminho público escolhido antes da abertura |
| Recuperação de acesso | Implementada e validada | Token hash/expiração, troca bcrypt, consumo único e revogação de sessões; nova prova MySQL de concorrência/rollback. Recebimento do e-mail e fluxo completo de usuário precisam de homologação |
| Google OAuth | Implementada, mas não homologada nesta auditoria | State/nonce, redirect allowlist e sessão existem/testes locais de redirect; habilitação, credenciais e login Google real não consultados |
| Endereços/perfil | Implementada, mas não homologada integralmente | Ownership por usuário, snapshots de entrega e edição limitada em pedidos. Cadastro/edição completa de perfil requer ensaio específico |
| Checkout/cálculo final | Implementada e validada | Backend autoritativo, recotação, snapshots, locks, idempotência, falha/recovery e integridade STOCK/MIXED/MySQL |
| PIX | Implementada e validada localmente | Asaas Sandbox homologado no fluxo principal segundo usuário; modalidade exata/evidência individual não revalidada. Confirmar QR/copia-e-cola e recebimento no smoke autorizado |
| Cartão | Implementada, mas não homologada por modalidade | `CARD` abre invoice Asaas com `billingType: UNDEFINED`; não há captura própria de cartão. Não comprova opção exclusiva de cartão/captura/3DS no provedor |
| Boleto | Implementada, mas não homologada por modalidade | Serviço/checkout permitem `BOLETO`; falta evidência de geração/linha digitável/vencimento/liquidação Sandbox nesta tarefa |
| Integração Asaas/webhook | Implementada e validada | Fluxo remoto anterior e regressões locais de assinatura/valor/moeda/replay/corridas. Configuração efetiva de eventos não foi consultada |
| Melhor Envio/frete | Implementada e validada localmente | Parser, indisponibilidade, recotação/backend, cotação obsoleta e snapshots. Pacote/peso, transportadora e preço efetivo remotos não homologados aqui |
| Entrega local | Implementada e validada localmente | Região e mensagens de agendamento existentes, sem prazo inventado. Capacidade operacional/geografia precisam de aceite comercial |
| Pedidos/acompanhamento | Implementada e validada | Ownership, histórico vs previsão atual, estados de produção, rastreio/entrega locais; fluxo remoto PREORDER anterior informado |
| Cancelamentos | Implementada e validada | Bloco 02/04: reserva ativa, consumo preservado, concorrência e evidência financeira. Cancelamento por item/cliente não disponível |
| Reembolsos/conciliação | Parcialmente implementada | Eventos observados/auditados; não existe workflow de solicitar/executar/alocar/encerrar estorno nem painel de saldo. Não apresentar cancelamento como devolução |
| E-mails transacionais | Parcialmente implementada e validada | Templates/gatilhos normais e outbox de entrega/review testados; cancelamento/estorno/cronograma ausentes por política pendente. Mailbox não comprovada |
| Painel administrativo | Implementada e validada nos fluxos cobertos | Lotes, cronograma, pedidos, auth/admin e imagens; CRUD integral, mensagens e todas as ações irreversíveis ainda exigem roteiro manual |
| Auditoria/backups/rotinas | Implementada e validada localmente | Ledger, backup/restore e migrations MySQL. Retenção/off-site/agendamento real dependem de infraestrutura não consultada; restore da aplicação é deliberadamente local-only |
| Procedimento operacional de recovery/estorno | Ausente no produto como workflow completo; necessário antes do lançamento ao menos como processo formal | Definir responsável, evidência, prazo e autorização manual. Não exige automatizar operações financeiras para abrir |

## 3. Achados, severidade e correções

P0 bloqueia imediatamente; P1 deve ser resolvido antes do lançamento; P2 aceita postergação somente mediante avaliação de risco; P3 não bloqueante. “CONFIRMED” exige demonstração/caminho inequívoco, “LIKELY” aponta falta de reprodução específica, “HARDENING” não afirma exploração.

| Prioridade / classe | Evidência e impacto | Tratamento |
| --- | --- | --- |
| P1 / CONFIRMED, corrigido | `auth.resetPassword` antes fazia atualização da senha, consumo/exclusão de token e rotação de sessão em chamadas independentes. Duas requisições com mesmo token podiam escrever senhas diferentes; falha parcial podia deixar sessão/token inconsistentes | Novo `consumePasswordReset` bloqueia usuário/token/credencial e valida expiração sob transação. Troca de hash, exclusão dos tokens e incremento de sessionVersion são atômicos. MySQL prova exatamente um vencedor, replay/expiry rejeitados e rollback sem consumir token ou revogar sessão indevidamente |
| P2 / CONFIRMED, corrigido | `securityLog` imprimia tokens curtos integralmente e prefixo/sufixo de tokens longos | Redação integral para campos token; booleans de presença mantidos. Testes com valores sintéticos e spies de console; não se afirma que toda string arbitrária/provider error está sanitizada |
| P1 / dependência operacional | Sem caminho público de autenticação comprovado; login/signup locais são restritos por padrão e Google efetivo desconhecido | Homologar um caminho permitido para clientes sem ampliar allowlists/flags automaticamente. Se nenhum funcionar, bloqueia abertura |
| P1 / dependência financeira | Workflow e políticas de cancelamento pago/reembolso, valores parciais, mínimo/fornecedor e recovery não concluídos | Aceitar processo manual documentado, auditável e responsável definido, ou implementar fluxo posteriormente autorizado. Não lançar sem forma operacional de resolver dinheiro recebido após cancelamento/expiry/resultado incerto |
| P1 / dependência de release | Código novo consulta colunas 0022 e configuração Sandbox/eventos/hosts não revalidada | Migration específica, backup/restore, fingerprint e origem; depois backend/frontend e smoke. Backend novo sobre schema antigo é bloqueio concreto |
| P1 / dependência por modalidade | Cartão/boleto não possuem prova de homologação individual | Homologar cada modalidade anunciada ou decidir formalmente não oferecê-la até validação; nenhuma modalidade foi habilitada/desabilitada nesta auditoria |
| P2 / LIKELY, requer reprodução | `saveProfileData` salva múltiplas entidades sem transação e admin sync de variantes tolera falha parcial | Reproduzir interrupção de gravação em fixtures de perfil/CRUD antes de afirmar integridade integral. Não houve alteração estrutural dessas rotinas nesta tarefa |
| P2 / validação operacional | Rate limiter/login attempt store em memória; múltiplas réplicas não compartilham limite | Confirmar topologia e aceitar risco para instância única; antes de escalar, revisar store compartilhado. Não foi introduzido Redis |
| P2 / HARDENING | CSP desativada no backend; logs podem conter e-mail/reason; mídia original aceita SVG administrativo; dependências não passaram por audit de CVEs nesta etapa | Revisar política de conteúdo, retenção/acesso a logs e origem de mídia, e executar análise de dependências na preparação autorizada. Não foi demonstrado XSS/secret leak por esses caminhos nem removido suporte de imagem |
| P2 / operação | Backup diário é local e inicia no startup; durabilidade/retention off-site e restore remoto não estão comprovados | Validar armazenamento persistente, acesso restrito, retenção e prova de restore isolado. Não considerar arquivo local equivalente a plano de recuperação |
| P3 / UX visual | Confirms/prompts nativos, consistência visual/admin, refinamento de mensagens | Registrar para 04/04/design; não mudar layout ou ampliar escopo nesta auditoria |

Nenhum caminho de acesso remoto/produção foi explorado. Aprovação local não equivale a certificação de segurança ou teste ofensivo remoto.

## 4. Segurança e integridade verificadas

- **Checkout:** preços/quantidades/snapshots calculados no backend; seleção de variante validada, frete recotado e cupom validado sob lock. Testes adulteram total/valores e exercitam rollback. Frontend não decide preço/pagamento. Pedido completo persiste antes do provider; resultado incerto bloqueia criação repetida.
- **Reservas:** PREORDER inclui pendentes e pagos uma vez; cancelamento/concorrência protegidos. STOCK tem reserva temporal; pagamento depois de expiry não aprova sem conciliação. MIXED é atômico. Não se restaura estoque consumido ou dinheiro automaticamente.
- **Pagamentos:** webhook autenticado, BRL/status/valor, ledger persistente único. Admin confirmação exige privilégio/evidência; estados finais são revalidados na transação. Endpoint legado possui claim durável e não pode gerar nova cobrança para pedido do checkout transacional. Reembolso é observação para conciliação, não alteração financeira automática.
- **Auth/sessões:** bcrypt/política de senha, token reset hash, JWT com issuer/audience, sessão/versionamento e usuário bloqueado. Cookies HttpOnly/SameSite=Lax; Secure depende de HTTPS/proxy. Rotação no logout/login/reset deve ser comprovada no staging real, inclusive domínio frontend/API.
- **Permissões/dados:** protectedProcedure/adminProcedure, ownership por usuário nos pedidos/perfil/sacola/favoritos; uploads de produto exigem admin, reviews exigem compra/ownership. Não foi consultado dado real. Não foi reproduzido bypass administrativo/cross-user no escopo dos testes; isso não cobre todo endpoint possível.
- **HTTP:** CORS allowlist, CSRF double-submit assinado para mutações com cookie, exceção webhook autenticado, limites gerais/auth/public writes, body limits/Helmet e erro público sanitizado. Testes cobrem controles, não topologia de proxy/CDN real.
- **Input/SQL/XSS:** Zod, queries parametrizadas/Drizzle, snapshots e escaping React/e-mail; image proxy valida DNS/IP/redirect e limite/timeout para SSRF. Uploads limitam tamanho/extensão/MIME e geram variantes com sharp; publicação/headers do armazenamento remoto permanecem desconhecidos.
- **Admin:** confirmações existentes em status/cancelamento/lote; restore exige literal RESTORE e target local antes de conectar. Nem todo CRUD tem auditoria/atomicidade integral comprovadas: verificar roteiro abaixo. Não habilitar restore remoto ou migração genérica removendo guards.
- **Auditoria/persistência:** ledger, checksums/fingerprints, locks, backup/restore locais reais; snapshots de compra preservados. Eventos falhos/uncertos não autorizam replay cego. `admin.auditList` é a ferramenta existente de inspeção, não um workflow completo de conciliação.

## 5. E-mails: gatilhos e lacunas

Cadastro/welcome e recuperação possuem templates/gatilhos; checkout envia pedido criado/pagamento pendente; aprovação usa snapshots persistidos e não deve ocorrer para transação bloqueada. Preparação e envio acompanham mudança administrativa de estado; entrega/review usam eventos duráveis, claim/lease e chave lógica testados. Não se confundem aceite Resend, sent, scheduled e delivered/recebimento em mailbox.

Cancelamento, reembolso e mudança de cronograma **não disparam novas notificações**. Políticas/textos/idempotência ainda precisam de aprovação. Os campos de fabricação são originais na compra; previsão atual não reescreve o compromisso. Falha/remoção de cobrança em estados pagos/finais não deve incentivar cobrança duplicada. Outbox e fluxos financeiros do bloco 02/04 foram preservados; não foi enviado e-mail real.

Nem todos os gatilhos normais possuem a mesma garantia durável da entrega/review: verificar duplicidade/falha/recovery de preparação/envio no roteiro administrativo e não pressupor mailbox por log local.

## 6. Testes executados

**Execução final: 42 arquivos, 446 testes PASS, zero falhos, zero ignorados e sem exclusões.**

| Gate | Resultado |
| --- | --- |
| `pnpm check` | PASS cliente/servidor |
| `pnpm build` | PASS Vite/esbuild |
| `preorder.mysql.test.ts` | 63 PASS, inclui reset concorrente/expiry/replay/rollback e todas as reservas/produção anteriores |
| `security.logging.test.ts` | 2 PASS, tokens curtos/longos redigidos |
| `checkout.mysql.test.ts` | 22 PASS, valores/cupons/estoque/falha/rollback/backup |
| `security-hardening.test.ts` | 31 PASS, auth/ownership/webhook/exceções |
| `preorderUi.test.ts` | 17 PASS em Chromium, catálogo/admin/produto/sacola/checkout/histórico/acompanhamento |
| Empacotamento/transporte offline | 18 PASS nos dois arquivos, incluindo os probes de bundle Git |
| Outras regressões de auth/OAuth redirects/uploads/imagens/reviews/e-mail/ledger/schema/restore | Incluídas no total; não somadas novamente |
| `git diff --check` | PASS, saída vazia |

Uma execução intermediária falhou apenas porque o teste novo esperava sessionVersion 1 após reset, mas o default do usuário já é 1 e a revogação correta resulta em 2. Corrigida a expectativa e acrescida prova de rollback; execução final inteira repetida e aprovada. Não se contou a execução parcial como aprovação.

Comando final na cópia temporária limpa `/tmp/l4ckos-manufacturing-release-z2Sfiy`:

```bash
env DATABASE_URL= VITE_API_URL=same-origin VITE_SITE_MODE=store \
  PLAYWRIGHT_MODULE=/tmp/l4ckos-final-visual-tools/node_modules/playwright/index.mjs \
  L4CKOS_MYSQL_TEST=1 \
  L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-final-fixes-mysql/mysqld.sock \
  pnpm exec vitest run
```

MySQL 8.4.11/socket local, schemas sintéticos e Docker independente de restore; navegador com hosts externos bloqueados. 621 arquivos copiados/conferidos por hash, incluindo novos, sem `.env`/`.npmrc` local. Árvore Git sintética `cec02855d2bf746a27d5a49907775e71c06d9864`, referência `3116932b695352d3989ff0f45763751fd8f19478`. Somente plumbing em /tmp; nenhum `git commit` ou alteração de índice/HEAD principal. Relatório escrito após os testes, sem mudar runtime.

**Não executados:** smoke/health/startup de deployment remoto, OAuth Google real, PIX/cartão/boleto externos, Melhor Envio real, upload remoto, e-mail em mailbox, carga distribuída, scanner de CVEs e pentest remoto. Não contam como aprovação. Testes de navegador não percorrem cada tela da loja; autenticação reset completa no navegador e favoritos/perfil/CRUD integral são itens de homologação, não alegações de cobertura automatizada.

## 7. Arquivos alterados e migrations

Incremento desta auditoria:

- `server/db.ts`: função transacional de consumo de reset/credencial/sessões.
- `server/routers.ts`: integra consumo atômico e rejeita token concorrente/replay.
- `server/_core/security.ts`: redação integral de token.
- `server/database/preorder.mysql.test.ts`: regressão MySQL de reset e rollback.
- Novo `server/_core/security.logging.test.ts`.
- Novo `docs/preorder/final-functional-audit.md`.

Diff acumulado contra HEAD **34 arquivos rastreados, 775 inserções/193 remoções**, mais **14 novos** incluindo este relatório. Inclui os blocos anteriores preservados; não é só o incremento 03/04. Inventários dos demais arquivos nos relatórios 01/04 e 02/04. Sem CSS, layout, dependência ou formatação global.

**Nenhuma migration nova em 03/04.** A 0022 permanece byte a byte, SHA-256 `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`; ledger/bootstrap/contrato v3 e migrations anteriores preservados. Reset reutiliza tabelas existentes. Novas correções são de backend; a entrega acumulada ainda exige frontend e backend.

## 8. Sequência futura de staging, rollback e interrupção

1. Autorizar release específica, revisar diff acumulado e produzir origem limpa sem arquivos locais secretos; não publicar diretamente o worktree sujo. Confirmar alvo staging, SHA, artefatos, Node, hosts, auth/CORS/cookies e Asaas Sandbox sem divulgar secrets.
2. Backup e prova de restore isolado. Conferir schema/ledger v2 e preparar executor/autorizações **específicos da 0022**; ferramentas fixas 0020/0021 não aplicam essa migration. CLI local não pode ser transformado em remoto contornando guards.
3. Aplicar 0022 pela execução futura autorizada, sem migrations adjacentes/backfill; validar v3 `a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e`. Se DDL parcial, parar e inspecionar: MySQL tem commits implícitos, sem retry cego.
4. Backend → startup/health → frontend → smoke controlado. Pausar alterações administrativas durante a janela. Não confundir backend/API compatível com aprovação dos cronogramas novos no frontend anterior.
5. Resolver/aceitar formalmente pendências P1 e obter evidência por modalidade/serviço antes da abertura oficial. Esta auditoria não executa nenhuma dessas fases remotas.

Rollback de código: retornar aos artefatos anteriores comprovados, mantendo colunas aditivas, snapshots, auditoria, tokens consumidos, sessionVersion e claims. Não restaurar tokens usados/senhas antigas ou reabrir tentativas financeiras por reset de dados. Não DROP, reembolso, restock, repetição de webhook/e-mail/cobrança. Backend anterior reintroduz defeitos de reset/financeiros: restringir temporariamente operações afetadas e revisar sessões caso retorno inevitável.

**STOP:** alvo/ambiente ambíguo; origem/schema/checksum divergentes; backup/restore não comprovado; DDL parcial; secrets expostos; login público inexistente; false payment/dupla cobrança; estoque/capacidade excedidos; histórico alterado; recovery sem responsável; health/crash ou e-mail para destinatário não autorizado. Registrar evidências e solicitar direção, sem remediação financeira automática.

## 9. Checklist objetivo de homologação final

- [ ] Identidade staging, SHA, schema v3, backups/restore e health/startup verificados.
- [ ] Login/cadastro permitido para cliente e admin; Google se ofertado; usuário bloqueado, logout e sessão inválida negados.
- [ ] Reset recebido em destinatário controlado, token expirado/reutilizado/concorrente rejeitado e sessões antigas revogadas.
- [ ] Dois usuários sintéticos: pedidos, endereços, favoritos, sacola e uploads sem acesso cruzado.
- [ ] Catálogo/filtros/cores/tamanhos/variantes corretos; CRUD/estoque e falha parcial administrativa exercitados sem perda silenciosa.
- [ ] STOCK, PREORDER, MIXED e lotes distintos; sacola antiga/quantidade excessiva; concorrência e limite compartilhado.
- [ ] Preço/frete/cupom adulterados rejeitados; desconto, limites/expiry e valores finais conferidos no backend.
- [ ] PIX/cartão/boleto individualmente homologados se anunciados; Asaas apenas Sandbox, destinatários controlados e autorização prévia para efeitos externos.
- [ ] Webhook assinatura inválida, replay, out-of-order, valor divergente, atraso após cancelamento/expiry e resultado incerto sem aprovação/cobrança falsa.
- [ ] Cancelamento pendente/pago/produção/recebimento/envio, estoque/capacidade/auditoria e conciliação manual conferidos; nunca usar pedido #12.
- [ ] Mínimo/fornecedor/prazo alterado tratados segundo política aprovada; nenhuma devolução automática indevida.
- [ ] Frete/local/integrador indisponível, pacote/preço e prazo após postagem; cronogramas atuais vs snapshots preservados.
- [ ] Pedido/produção/rastreio/entrega e e-mails corretos, idempotência/recovery observados; aceite do provedor separado de mailbox.
- [ ] Operadores/responsáveis de conciliação, reembolsos, backup, retenção/logs e contingência definidos; eventos/configuração comprovados.
- [ ] Gate final revisado; problemas P2 aceitos formalmente; autorização distinta para abertura oficial. Não iniciar reformulação visual durante smoke funcional.

## 10. Veredito

**APTO COM RESSALVAS** para revisão e última homologação em staging: dois defeitos locais corrigidos, regressões completas aprovadas e blocos anteriores preservados. Não há autorização/evidência suficiente para abrir oficialmente a loja nesta entrega. Fechar as dependências P1 de autenticação pública, modalidades anunciadas, schema/release e resolução financeira operacional; avaliar riscos P2. Melhorias visuais P3 ficam separadas para a próxima fase.

## Atualização operacional — aprovação dos fundadores (09/10/2026)

As políticas financeiras da V1 foram aprovadas conforme comunicação do usuário: reembolsos manuais supervisionados, conciliação obrigatória com Asaas, parciais manuais, tratamento individual dos lotes abaixo do mínimo, responsabilidade inicial dos dois fundadores, auditoria das aprovações e ações e respeito aos prazos legais, direitos do consumidor e política de cancelamento aplicável. O [runbook aprovado](refund-reconciliation-runbook.md) é a referência operacional atual. Menções anteriores neste relatório a aprovação financeira pendente descrevem o estado histórico e ficam superadas somente quanto a essas regras e à responsabilidade inicial.

Essa decisão não implementa um módulo de reembolsos, dupla aprovação em tela, saldo conciliado, notificações ou recovery automático. Homologação operacional, identificação nominal das funções/canal e evidências do Asaas continuam pendentes. A [RC atual](staging-release-candidate.md) registra o veredito por etapa. Nenhuma operação financeira, alteração de pedido ou ação remota foi executada nesta formalização.
