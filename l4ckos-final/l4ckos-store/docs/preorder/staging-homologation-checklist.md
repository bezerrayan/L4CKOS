# L4CKOS — Checklist de homologação staging 04/04

09/10/2026. **Roteiro preparado; nenhum item remoto executado.** Depende de autorização posterior. Consultar [RC e gates](staging-release-candidate.md) e [runbook aprovado](refund-reconciliation-runbook.md).

## Registro e autorização

Preencher em cada caso: responsável, data/hora/fuso, SHA/deployment backend/frontend, IDs sintéticos, configuração não secreta, entrada, resultado esperado/observado, evidência sanitizada (request/status/audit/ledger/provider quando permitido), PASS/FAIL/BLOCKED/NOT RUN e decisão. Nunca anexar token, cookie, CPF real, cartão ou senha. Teste bloqueado/ignorado não é aprovado.

- [ ] Autorização define deploy/schema/testes e, separadamente, cobranças **Sandbox**, e-mails **somente destinatários aprovados** e cotação externa. Sem autorização de efeito externo, usar simulação local e marcar item real NOT RUN.
- [ ] Alvo exclusivamente projeto l4ckos-staging; ambiente interno production não é produção real. Não consultar projeto l4ckos-production/Vercel externo.
- [ ] Fonte limpa aprovada inclui os 57 arquivos do delta (36 modificados + 21 novos), inclusive shared/apiConfig.ts, server/apiConfig.test.ts e 0022; SHA e deployment ativo conferidos, não só build SUCCESS. Referência/identidade da RC atual no relatório; HEAD principal sozinho não contém as correções locais.
- [ ] Backup completo, checksum, restore isolado e plano 0022 aprovados; schema v3/ledger pós-migração corretos.
- [ ] Build usa **VITE_DEPLOY_TARGET=staging**, **VITE_API_URL=https://api-staging.l4ckos.com.br** e VITE_SITE_MODE=store conforme roteiro. VITE_BACKEND_URL/same-origin/URL relativa não substituem a configuração obrigatória de staging. Registrar resultado do gate Vite antes de publicar.
- [ ] Inspecionar assets frontend: nenhum destino api.l4ckos.com.br; única origem da API da loja é api-staging.l4ckos.com.br. Registrar hashes do bundle futuro e comparar a fonte aprovada. No gate local atual: 38 assets JS, zero arquivos com hostname da API de produção e 13 regressões de isolamento aprovadas, incluídas em 464/464 (0 falhos/ignorados).
- [ ] Verificar negativas com mocks/localmente: API ausente/URL inválida/destino produção num build staging falham explicitamente; zero chamadas de rede; artefato de produção no host staging é bloqueado. Nunca executar essas negativas fazendo requisição à API real de produção.
- [ ] Frontend aponta somente api-staging.l4ckos.com.br; API/Asaas/checkout/links/e-mail/transporte e storage isolados. Inspecionar Network e redirects antes de clicar em compra; conferir auth/tRPC/admin/CSRF/CEP na mesma origem de API.
- [ ] Criar fixtures novas identificadas `[STAGING RC04]`, usuários A/B e admin separados. Não usar dados de cliente/pedido #12. Registrar baseline estoque/capacidade/cupom/contador/audit; preservar fixtures até aceite e autorização de limpeza.
- [ ] Registrar os dois fundadores como responsáveis iniciais e identificar nominalmente executor, observador financeiro e aprovador; combinar janela de manutenção/webhook e observação. GO preflight explicitamente assinado.

## Conta, sessões e segurança

- [ ] Cadastro público conforme flags aprovadas: senha inválida rejeitada; válida cria usuário comum, não admin; e-mail duplicado rejeitado. Persistência após reload/login.
- [ ] Login errado não autentica; login correto emite cookie HttpOnly/Secure/Lax sobre HTTPS e funciona entre frontend/API sem CORS wildcard credentials.
- [ ] Novo login invalida sessão anterior conforme versionamento; logout limpa cookie e JWT antigo não acessa rotas privadas em outro navegador.
- [ ] Conta bloqueada não autentica. Sessão expirada e JWT inválido não acessam perfil/pedidos/admin; usuário normal não executa mutação administrativa por requisição direta.
- [ ] Recuperação responde de modo neutro para existente/inexistente. Link de fixture usa host staging, token não aparece em logs; mailbox só se autorizado.
- [ ] Reset troca senha, senha antiga falha, senha nova funciona; duas submissões do mesmo link têm um vencedor; token expirado/repetido rejeitado; todas sessões anteriores revogadas. Falha simulada preserva credencial/token conforme teste local, não injetar falha em ambiente compartilhado sem plano.
- [ ] Troca de senha disponível via recuperação: não afirmar existência de fluxo independente autenticado. Revogação com banco indisponível requer tratar erro/alerta, não presumir sucesso global.
- [ ] A não lê/edita pedidos, endereços ou favoritos de B; acesso direto por ID rejeitado. Frontend privado e backend protegido concordam.
- [ ] CSRF inválido/ausente em mutation rejeitado; origem externa rejeitada; fluxo legítimo funciona. Webhook conserva isenção CSRF e autenticação própria.
- [ ] OAuth se habilitado: credenciais/redirect staging, state/nonce inválidos rejeitados, callback válido, logout, usuário comum sem promoção por e-mail não verificado. Se desabilitado, registrar decisão e caminho público alternativo validado.

## Loja, valores, estoque e frete

- [ ] Catálogo/categorias/busca e produto/cores/tamanhos/variantes corretos; variante de outro produto rejeitada pelo backend.
- [ ] STOCK disponível pode comprar; sem estoque bloqueia; reserva pendente/expiração e consumo após pagamento sem negativo/dupla baixa.
- [ ] Favoritos e endereço/perfil A/B persistem e isolam dados; cadastrar/editar/usar no checkout. CRUD variantes sem sucesso aparente após falha parcial.
- [ ] Sacola reload mantém itens e revalida catálogo; produto removido/indisponível e excesso mostram mensagem; favorito não contorna disponibilidade.
- [ ] Cupom válido/expirado/limite/valor mínimo/concurrente conforme regra existente; total/centavos/frete/desconto backend conferidos. Alterar preço/subtotal/frete no request não muda valor cobrado.
- [ ] Cotação para CEP elegível e inelegível: prazo postal após postagem, local por agendamento; sem confundir fabricação com entrega. Carrier/método/valor correspondem à recotação backend.
- [ ] Ausência/falha do transporte não inventa opção; checkout rejeita antes de persistir pedido/cobrança quando não há opção válida.
- [ ] Mudar CEP/itens durante consulta: resposta atrasada não restaura cotação anterior. Backend rejeita opção inexistente/manipulada.
- [ ] Pedidos STOCK+PREORDER e lotes diferentes exibem envio conjunto e períodos distintos; nenhuma data final inventada. Histórico mantém condições da compra mesmo após recotação.

## Pagamentos — cada modalidade anunciada

Somente Asaas Sandbox e autorização específica para testes externos. Usar fixtures e ferramentas oficiais do provedor; não cartões/dados reais. Não marcar modalidade aprovada apenas porque cobrança foi criada.

- [ ] PIX: geração única, QR/copia-e-cola, pedido pending, simulação de liquidação autorizada, webhook autenticado, total/correlação corretos e uma aprovação/auditoria/e-mail quando permitido.
- [ ] Cartão: conferir invoice hospedada (`CARD` usa UNDEFINED), presença e escolha efetiva de cartão, parcelamento anunciado compatível, sucesso/recusa/erro e webhook. Se não pronto, NO-GO para anúncio até bloqueio autorizado backend+frontend.
- [ ] Boleto: documento/linha digitável, valor/vencimento, pendência, liquidação e webhook; vencido não significa cancelado nem liberação automática PREORDER.
- [ ] Timeout/resultado incerto conserva claim/pedido/reserva e exige conciliação; repetir botão/request/reload não cria segunda cobrança.
- [ ] Mesmo checkoutAttemptId repete resultado autorizado sem novo pedido/cobrança; payload alterado rejeitado; replay de pedido cancelado bloqueado.
- [ ] Evento duplicado/fora de ordem não dobra baixa/reserva/e-mail, não regrede pagamento/fulfillment. Token ausente/incorreto rejeitado e não muta dados.
- [ ] Valor/status/identificador divergente não aprova pagamento; pagamento após cancelamento ou STOCK expirado registra conciliação e não ressuscita pedido.
- [ ] Checkout legado não cria cobrança para pedido já pago/cancelado/com tentativa ou cobrança existente. Teste concorrente somente fixtures e escopo aprovado.

## PREORDER, fabricação e histórico

- [ ] Novo lote DRAFT: datas fabricação válidas; par incompleto, inválido, início>fim e postagem anterior ao fim rejeitados com mensagem. OPEN sem fabricação bloqueado; admin autorizado pode corrigir previsões.
- [ ] Lote antigo flag0/NULL continua gerenciável; pedidos históricos exibem prazo a confirmar, sem preenchimento fictício. Abertura/encerramento UTC e fabricação civil Brasília não deslocam dia indevidamente.
- [ ] Produto/sacola/checkout/confirmado/e-mail/histórico/acompanhamento distinguem fabricação, postagem e transporte; postagem não promete entrega; datas vencidas pedem revisão.
- [ ] Alterar cronograma grava auditoria; catálogo mostra novo período; compra anterior mantém snapshot original e previsão atual separada. Não dispara notificação de alteração não aprovada.
- [ ] Lote max2 com duas peças comprometidas (pagas ou pendentes) mostra restante0. Sacola antiga4 bloqueia produto/sacola/checkout antes de cobrança.
- [ ] Dois produtos/variantes do mesmo lote compartilham capacidade; compras concorrentes não excedem max; pago não conta duas vezes. Cancelado libera pela regra atual, sem inferir reembolso.
- [ ] Sem máximo não introduz teto99; CLOSED/CANCELLED/fora da janela indisponíveis sem mudar status automático por esgotamento.
- [ ] Encerramento abaixo do mínimo/fornecedor indisponível registra decisão administrativa manual; não cancela/reembolsa pagos automaticamente.
- [ ] Produção/transições/recebimento/rastreio/entrega individual seguem regras atuais, snapshots e quantidades confirmadas preservados. Validar acompanhamento de A e isolamento de B.

## Administração e conciliação

- [ ] CRUD produto/estoque/variantes/lotes/cupom e tracking auditados conforme rotas existentes; usuário comum não executa, admin vê erros reais e não sucesso indevido.
- [ ] Cancelar fixture pendente STOCK libera active uma vez; PREORDER/MIXED reserva/capacidade corretas. Repetir cancelamento sem dupla liberação; estoque consumed não retorna automaticamente.
- [ ] Cancelar pago/produção/recebido/enviado preserva evidência paga; tela diferencia pedido cancelado de devolução. Não reativa pedido cancelado.
- [ ] Concorrência confirmação/cancelamento serializa ou gera pendência auditável; registrar quem aprovou decisão sem realizar reembolso externo.
- [ ] Eventos refund_in_progress/refunded/denied/partial/deleted/overdue **simulados localmente** têm evidência e nenhuma devolução/status financeiro fictício. Em staging só replay sintético se mecanismo/escopo autorizado; nunca expor bypass de autenticação ou marcar evento forjado como evidência do provedor.
- [ ] Auditoria identifica order.cancelled, payment.reconciliation_required e claims incertos; operador segue runbook e não edita ledger/SQL para forçar “resolvido”.
- [ ] Remetente/links/destinatários/outbox/e-mail aprovação, envio/entrega/review somente conforme autorização; aceite de provider não é recebimento mailbox. Cancelamento/reembolso/alteração de cronograma sem automações não aprovadas.

## Aceite e interrupção

- [ ] Conferir deltas finais de estoque/capacidade/financeiro/cupons/históricos contra baseline, não só status visual.
- [ ] Registrar cada caso PASS/FAIL/NOT RUN e evidências sanitizadas. Modalidades/auth/frete/e-mail não testados permanecem pendentes explícitos.
- [ ] Nenhum P0/P1 técnico; P1 operacionais/comerciais encerrados ou escopo restrito claramente aprovado; P2 aceitos nominalmente; P3 no backlog visual.
- [ ] Aprovação técnica, operacional e comercial separadas; aceite staging não autoriza abertura oficial/deploy produção.

Interromper imediatamente por host/alvo errado, segredo, acesso cruzado de usuário, cobrança duplicada/confirmação falsa, alteração financeira indevida, capacidade/estoque negativos, schema parcial ou origem errada. Preservar logs/fixtures, restringir mutations e executar plano de rollback autorizado da RC; não repetir operações incertas nem limpar evidências.

O fallback inseguro da API foi removido e o bloqueio técnico foi encerrado localmente. Configuração, backup/execução governada de 0022, origem publicável e autorização de deploy continuam gates pendentes; auth pública, cada modalidade anunciada e aplicação das políticas financeiras aprovadas ainda exige homologação operacional. Não fazer rollback para bundle cujo isolamento da API não esteja comprovado.

## Políticas financeiras aprovadas — conferência operacional

- [ ] Aplicar o runbook aprovado: reembolsos manuais supervisionados, conciliação obrigatória com Asaas e parciais manuais; nenhuma automação de refund.
- [ ] Registrar decisão individual para cada lote abaixo do mínimo, sob responsabilidade inicial dos dois fundadores.
- [ ] Preservar auditoria das aprovações e ações, prazos legais, direitos do consumidor e política de cancelamento aplicável. Conferir canal restrito, funções nominais e acompanhamento de cada caso.
- [ ] Separar evidência técnica (audit/ledger/cancelamento) do controle manual de aprovação, montante, execução e conciliação: o módulo completo de reembolsos não existe nesta release. Nenhuma operação financeira está autorizada nesta preparação local.
