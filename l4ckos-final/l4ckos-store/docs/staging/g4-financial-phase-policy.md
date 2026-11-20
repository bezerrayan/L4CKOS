# G4 F0 — política local de fases financeiras

Este documento descreve a extensão local do bootstrap financeiro. Não habilita
vendas nem altera qualquer configuração remota. O único runtime aceito para
fases G4 é a tupla Railway compilada no código:

| Identidade | Valor permitido |
| --- | --- |
| Projeto API | `66faf690-a068-40d1-b85c-cb5d8595560a` |
| Ambiente | `5335340d-311c-47e9-9713-6e5a86969c88` |
| Serviço API | `d66762a4-422a-4656-94a1-502215a27aa2` |
| Serviço MySQL privado | `mysql-stock-homologation.railway.internal` |
| Schema MySQL | `railway` |
| Versão MySQL | `9.7.2` |

O app valida hostname e CA TLS antes de importar a aplicação. Em qualquer fase
G4 ativa, conecta ao MySQL antes de escutar e verifica `DATABASE()` e
`VERSION()`. Não executa DDL. Um hostname, schema, versão ou CA diferente
bloqueia o boot.

## Estado fechado

`G4_FINANCIAL_PHASE` ausente significa `CLOSED`; também se pode informar
explicitamente `CLOSED`. Nenhuma variável `G4_*` nova é necessária para esse
estado. O site permanece `PUBLIC_SITE_MODE=coming-soon` e os seis flags abaixo
precisam estar explicitamente em `false`:

- `PUBLIC_CHECKOUT_ENABLED`
- `STOCK_RUNTIME_ENABLED`
- `STOCK_CHECKOUT_ENABLED`
- `ASAAS_WEBHOOK_INBOUND_ENABLED`
- `ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED`
- `PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED`

Um flag aberto sem fase correspondente bloqueia o boot. Os flags de aprovação
nunca abrem uma fase sozinhos. O caminho fechado continua aceitando a
configuração Asaas anterior; a nova variável de chave Sandbox não é exigida.

## Fases e transições

A sequência permitida é `CLOSED → SANDBOX_WEBHOOK → SANDBOX_CHECKOUT →
SANDBOX_RECOVERY`. Não se deve pular uma fase. Cada alteração exige redeploy e
reinício de todas as réplicas; os guards de recuperação capturam a configuração
no boot e rejeitam alterações em processo. Aprovações anteriores são declarações
do operador feitas após guardar e revisar a evidência local/conectada da fase.
Elas não são uma assinatura criptográfica nem substituem a revisão independente.

| Fase | Aprovação/validação exigida | Flags abertos | Efeito permitido |
| --- | --- | --- | --- |
| `SANDBOX_WEBHOOK` | `G4_SANDBOX_WEBHOOK_APPROVED=true` | Apenas `ASAAS_WEBHOOK_INBOUND_ENABLED=true` | Recebe POST no caminho Asaas com token/MAC válido. `review_only` persiste a evidência em revisão; não liquida nem consome estoque. O preflight pode fazer GET Sandbox para conferir a cobrança. |
| `SANDBOX_CHECKOUT` | aprova webhook, `G4_SANDBOX_WEBHOOK_VALIDATED=true` e `G4_SANDBOX_CHECKOUT_APPROVED=true` | `STOCK_RUNTIME_ENABLED=true`, `STOCK_CHECKOUT_ENABLED=true`, `ASAAS_WEBHOOK_INBOUND_ENABLED=true` | Checkout STOCK/PREORDER suportado exclusivamente para IDs autenticados na allowlist sintética; cobrança PIX e webhook usam Sandbox. O recebimento só liquida com todas as provas autoritativas já exigidas pelo runtime. |
| `SANDBOX_RECOVERY` | aprova as fases anteriores, `G4_SANDBOX_CHECKOUT_VALIDATED=true` e `G4_SANDBOX_RECOVERY_APPROVED=true` | Flags de checkout/webhook e `ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED=true` | Worker limitado reprocessa itens recuperáveis da inbox durável. Holds existentes continuam exigindo o procedimento de revisão/release; o worker não os libera automaticamente. |

Em todas as fases Sandbox, `PUBLIC_SITE_MODE=coming-soon` e
`PUBLIC_CHECKOUT_ENABLED=false`. O handler STOCK tem uma exceção de checkout
somente para a sessão autenticada cujo user ID esteja em
`STAGING_SYNTHETIC_BUYER_IDS`; identidade enviada no corpo da requisição não é
usada. A allowlist aceita no máximo 32 IDs únicos. Consultas `resume` também
exigem essa identidade.

No estado `SANDBOX_WEBHOOK`, eventos ficam em `ASAAS_WEBHOOK_RECOVERY_MODE=review_only`.
Em `SANDBOX_CHECKOUT` e `SANDBOX_RECOVERY`, o modo precisa ser `off` para que o
fluxo STOCK suportado possa confirmar recebimentos que passaram pelas validações
financeiras existentes. Na fase RECOVERY o worker continua fechado até a
aprovação explícita. Eventos já retidos com hold não são soltos por uma troca de
fase nem por replay.

O scheduler de expiração de reserva STOCK acompanha `STOCK_RUNTIME_ENABLED` e
só inicia em CHECKOUT/RECOVERY. O worker de notificação de pagamento precisa
permanecer `false` em todas as fases. `RESEND_API_KEY` deve ficar ausente;
`EMAIL_ENV=staging` e `EMAIL_MODE=restricted` são obrigatórios. Assim o outbox
pode manter intenção durável, mas entrega externa permanece fechada.

## Configuração exigida nas fases Sandbox

Todas as fases Sandbox exigem a tupla Railway exata, `NODE_ENV=production`,
`APP_ENV=staging`, `PUBLIC_SITE_MODE=coming-soon`, os seis flags no valor da
matriz e as seguintes identidades:

- Banco: `DATABASE_URL` com hostname e schema fixos acima;
  `STOCK_DATABASE_ENV=staging`, `STOCK_EXPECTED_DATABASE=railway`,
  `STAGING_DB_TLS_HOST=mysql-stock-homologation.railway.internal` e CA/hash
  correspondentes ao certificado desse host.
- Asaas: `ASAAS_ENV=sandbox`, `STOCK_ASAAS_MODE=sandbox`,
  `ASAAS_API_URL=https://api-sandbox.asaas.com/v3`,
  `ASAAS_CHECKOUT_BASE_URL=https://sandbox.asaas.com`,
  `ASAAS_SANDBOX_API_KEY` com prefixo `$aact_hmlg_`, `ASAAS_WEBHOOK_TOKEN`,
  `ASAAS_WEBHOOK_ACCOUNT_ID` e `ASAAS_WEBHOOK_ACCOUNT_CURRENCY=BRL`. O guard
  rejeita chaves `$aact_prod_`, formatos desconhecidos e `ASAAS_API_KEY`
  genérica quando a fase Sandbox está ativa.
- API privada: `STAGING_API_ACCESS_TOKEN` com pelo menos 32 bytes. A exceção de
  token do proxy vale só para POST nos dois caminhos fixos de webhook durante
  uma fase ativa; o guard de intake ainda exige a flag de fase e o controller
  verifica o MAC antes de persistir. Todo o restante da API mantém o token.
- Checkout: `STAGING_SYNTHETIC_BUYER_GATE_ENABLED=true` e uma allowlist explícita
  de IDs numéricos sintéticos só em CHECKOUT/RECOVERY.
- Notificações: `PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED=false`,
  `EMAIL_MODE=restricted`, sem `RESEND_API_KEY`.

A aplicação nunca imprime a chave nem os valores do banco. O prefixo `$aact_hmlg_`
é uma validação local de formato, não prova criptográfica de origem nem de conta.
A variável dedicada e os endpoints fixos do Sandbox impedem selecionar o caminho
de produção por configuração; na etapa conectada, o G4A ainda precisa autenticar
a chave no Sandbox e conferir o `account.id` esperado, sem colocar a chave nos
logs ou evidências.

## Parada e retorno a CLOSED

Parar imediatamente diante de identidade incompatível, acesso de usuário fora
da allowlist, endpoint/chave/conta/moeda divergente, TLS/schema/versão incorretos,
webhook sem MAC válido, qualquer liquidação sem prova autoritativa, envio externo
de e-mail ou retry inesperado. Fechar o intake e as vendas pela configuração
`CLOSED`, colocar os seis flags em `false`, definir coming-soon e reiniciar todas
as réplicas. Confirmar no health/attestation que o processo novo está em CLOSED;
configuração de variável sem reinício não altera o guard em memória.

Manter o código da política F0 implantado durante o retorno a CLOSED. Um rollback
de código para a árvore publicada antes de F0, usando apenas
`ASAAS_SANDBOX_API_KEY`, pode falhar no bootstrap antigo, que exige
`ASAAS_API_KEY`; esse comportamento é fechado, mas pode deixar o serviço
indisponível. Não copiar a credencial Sandbox para um campo genérico para
contornar o erro. Se for necessário reverter o código, primeiro preparar e
revisar a configuração compatível com o candidato anterior, ainda com todos os
flags financeiros fechados.

## Risco de redeploy por atualização de variáveis

A árvore publicada `5c56cb8918abec78d546d7624a37b4783cf7d96c` não contém esta
política. Se o serviço estiver ligado a uma branch GitHub, salvar variáveis pode
acionar um novo deploy da branch atualmente vinculada; a árvore antiga vai
rejeitar flags financeiros abertos e pode ficar sem iniciar. Antes de qualquer
configuração futura, a equipe de deploy deve verificar o SHA de origem e a
política de auto-deploy, publicar/revisar primeiro o candidato F0 com tudo em
CLOSED, comprovar o SHA efetivamente em execução e só depois avançar uma fase.
Este trabalho não inspecionou nem alterou Railway, GitHub, chaves ou variáveis
remotas.
