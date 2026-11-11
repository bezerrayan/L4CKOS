# Sprint 9: notificações e preflight

## Escopo local

Branch `codex/transactional-notifications-sprint9`, iniciada sobre o estado local da Sprint 8 (`9689fd8`). Esta worktree não altera a branch nem os arquivos do Claude. No início da revisão, o HEAD V6 observado era `d1a7cbd2dfc18cce0cc986433f29ca5b515ecd0f`; na conferência final, avançara para `41f788b48f1e905ad0595e310aae7c1cb21e8b21`, com `server/stock/stockCheckout.integration.mysql.test.ts` modificado sem commit. Esses arquivos foram somente consultados para mapear as dependências; o HEAD pode avançar novamente.

Nenhuma chamada remota, migration, cobrança ou entrega de e-mail foi realizada. O preflight apenas avalia configuração local ou um snapshot sanitizado fornecido pelo operador.

## Eventos e integração com os outboxes atuais

| Evento                   | Identidade lógica                      | Estado no V6 observado                                              |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| Pedido registrado        | `order-created-email:v1:order:{id}`    | Enfileirado pelo outbox financeiro existente                        |
| Pagamento pendente       | `payment-pending-email:v1:order:{id}`  | Enfileirado pelo outbox financeiro existente                        |
| Pagamento confirmado     | `payment-approved-email:v1:order:{id}` | Enfileirado pelo outbox financeiro existente                        |
| Pedido cancelado         | `order-cancelled-email:v1:order:{id}`  | Integração pendente; esta branch adiciona apenas o template isolado |
| Solicitação recebida     | `req:{id}:received:{revision}`         | Outbox exclusivo existente; revisar a revisão em cliques repetidos  |
| Acesso aprovado/recusado | `req:{id}:{decision}:{revision}`       | Outbox exclusivo existente                                          |
| Acesso revogado          | `grant:{id}:revoked`                   | Outbox exclusivo existente                                          |

`server/services/email/transactionalNotificationPolicy.ts` é uma política pura reutilizável, sem tabela, worker, cliente Resend ou envio. O integrador deve chamar as funções ao adaptar os dois outboxes existentes, preservando a separação transacional que já possuem. A chave de evento não contém endereço, código de acesso nem conteúdo da mensagem.

Os templates V6 existentes já cobrem criação, pendência, confirmação e decisões do acesso exclusivo. Foi adicionado `OrderCancelled.jsx` com o layout atual. Ele não está registrado no renderer V6 porque `emailRenderer.js` e `emailEvents.js` estão sob integração do Claude. Só apresenta estado de estorno quando recebido explicitamente como dado persistido. Nenhum prazo de expedição é inferido por template.

## Política testável

- Worker de notificações explicitamente opt-in; ausente, vazio ou `false` mantém desativado e valor desconhecido falha fechado. A política é isolada; o startup V6 ainda precisa adotá-la: a configuração atualmente permite default ligado fora de staging.
- Tentativas limitadas a cinco, backoff exponencial com jitter e falhas permanentes em estado terminal.
- Falha de rede/timeout é ambígua; após a janela de idempotência do provedor, sai de retry automático para reconciliação (`review`). Não repetir uma entrega de resultado incerto depois dessa janela.
- Campos de log limitados a chave interna, código sanitizado, tentativa e ação. Mensagem do provedor, e-mail e payload não são persistidos por esta política.
- Reclaim de lease e claim atômico continuam pertencendo aos outboxes existentes. O outbox de pagamento V6 já usa claim com lock/lease. O outbox exclusivo reobtém leases expirados, mas seu caminho observado não oferece retry automático controlado nem chave estável em cliques repetidos de `request_received`; resolver esses pontos no arquivo V6 do Claude antes de ligar notificações.

## Preflight offline

`node scripts/stock-staging-preflight.mjs --snapshot <arquivo-json>` avalia um snapshot sanitizado de Railway, Vercel, MySQL/TLS, flags, Asaas, webhook, Resend, health, preflight de migrations e rollback. Campos ausentes ou desconhecidos bloqueiam. A saída contém apenas nomes de verificações e estados; não imprime snapshot nem segredos. O comando não coleta os dados e não acessa redes ou bancos.

O preflight exige MySQL `9.7.2` isolado e sintético para a validação descrita, checkout e worker fechados, endpoint Asaas sandbox e um SHA anterior restaurável. Não é evidência de que recursos remotos atendem esses requisitos.

## Bloqueio de acesso Railway

O acesso de leitura ao projeto/ambiente staging foi negado pela autorização Railway já consultada na Sprint 8 com a mensagem: `You don't have the required role (viewer) on this resource.` Permissão mínima necessária: papel **Viewer** no projeto Railway `l4ckos-staging` e acesso de leitura ao ambiente e serviços desse projeto. Não é necessário papel Editor/Admin nem leitura de valores secretos. Não houve tentativa de contornar essa restrição.

Enquanto o Viewer não estiver disponível, SHA implantado, versão e identidade efetiva do banco, variáveis/flags, TLS, estado do webhook/Resend, health checks e rollback remoto permanecem `UNKNOWN`. O alias Vercel de staging observado anteriormente não substitui a verificação do SHA.

## Dependências para integração V6

1. Adotar `transactionalNotificationPolicy.ts` nos workers existentes; não criar tabela, sender ou worker paralelo.
2. Manter ambos os workers desativados por padrão no startup e habilitá-los somente em mudança de configuração aprovada.
3. Ligar `OrderCancelled.jsx` ao renderer/evento e enfileirar o evento na transação correta, usando estado real de cancelamento/estorno.
4. Aplicar classificação de falhas, backoff, limite e sanitização a ambos outboxes. Preservar claim/lease e IDs do provedor já existentes.
5. Tornar `request_received` idempotente por solicitação/transição, sem incrementar a chave por clique duplicado.
6. Não incluir códigos individuais de acesso nos e-mails nem em logs; os templates de acesso V6 observados não os exibem.

## Verificação

Os testes adicionados são unitários e offline. Nenhum teste MySQL foi declarado aprovado por este documento. Rodar a validação e registrar os resultados no relatório de entrega da Sprint 9.
