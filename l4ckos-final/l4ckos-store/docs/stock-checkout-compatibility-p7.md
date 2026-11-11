# STOCK checkout compatibility — Gate P7

Escopo: inspeção local dos commits disponíveis e da candidata STOCK. Nenhuma conexão remota, consulta SQL, migration, rota pública ou chamada ao Asaas foi executada.

## Matriz de compatibilidade de schema

“Remoto comprovado” fica como **desconhecido** em todas as linhas: a inspeção do código e das migrations locais não prova o schema instalado no MySQL de produção.

| Campo/tabela | Necessidade funcional | Presença declarada no commit de produção | Remoto comprovado | Alteração necessária para STOCK | Compatibilidade com rollback |
|---|---|---|---|---|---|
| `products` | Identidade/nome do produto pai | Sim; `id`, `name`, preço base e estoque declarado em `drizzle/schema.ts` | Desconhecido | Confirmar estrutura remota; estoque STOCK deve ser por variante | Nenhuma alteração necessária ao produto pai no contrato sintético |
| `productVariants` | `id`, `productId`, SKU, tamanho, cor, preço, estoque e ativo | Tabela existe; declaração base só tem `id`, `productId`, `name`, `sku`, `price`, `stock` | Desconhecido | Cor/tamanho/ativo são ausentes na declaração base. `0025` de staging adiciona apenas `isActive`; não adiciona `size`, `color`, SKU único, estoque reservado ou contrato de preço | Aditivas e com defaults podem ser compatíveis se comprovadas; sem reescrever/remover dados. Rollback exige manter colunas enquanto código que as usa estiver ativo |
| `orders` | Identidade estável do pedido, estado de pagamento e correlação com tentativa/provedor | Sim; pedidos e alguns campos de estado/confirmação declarados; sem `attemptId`, fingerprint ou identidade STOCK declarada | Desconhecido | Persistência da tentativa/correlação STOCK; avaliar integração com ID numérico e ciclo de estados existentes | A extensão aditiva pode ser compatível; transições não devem substituir estados existentes sem plano de rollback |
| `orderItems` | Snapshot imutável de `variantId`, SKU, tamanho, cor, quantidade e preço | Sim; base declara `productId`, quantidade e preço, sem `variantId` ou snapshots de identidade | Desconhecido | Adicionar persistência de snapshot ou tabela STOCK compatível; não assumir que `0025` resolve | Campos/tabela aditivos preservam leitura antiga. Remoção após rollback só depois de provar ausência de consumidores |
| `payments` | Tentativa/id do provedor, valor, status de criação e resultado de cobrança | Não declarada no schema base de produção | Desconhecido | Definir modelo de pagamento e restrições idempotentes/correlação antes de integrar | Nova tabela é aditiva; não substituir `orders` nem eliminar campos existentes |
| `stockReservations` | Reserva por tentativa e variante, quantidade, expiração e estado | Tabela existe; base declara `orderId`, `userId`, `productId`, quantidade, status e expiração; não declara `variantId`/`attemptId` | Desconhecido | Ligar reserva à tentativa/variante e garantir unicidade/locks coerentes com o inventário remoto | Extensão aditiva é candidata a rollback seguro; conservar registros e campos novos até reconciliação concluída |
| `asaasWebhookEvents` | Deduplicar evento, detectar replay conflitante e persistir antes de reconhecer | Sim; base declara `eventId` único, tipo, payment/checkout/order IDs, hash e status | Desconhecido | Comparar semântica/índices e estados atuais; o adapter sintético usa tabela própria e não prova compatibilidade | Reutilizar só após prova de semântica e escrita idempotente; preservar registros durante rollback |
| `asaasWebhookInbox` | Recepção durável, tentativas e recuperação de webhook | Não declarada no commit de produção; migration `0023` está no staging local | Desconhecido | Opcional para STOCK se `asaasWebhookEvents` suportar recuperação; se adotada, comprovar migração/worker e estados | Tabela aditiva, mas deve manter payload/hash e estados durante rollback e drenagem |
| `notificationOutbox` | Entrega repetível de notificações sem bloquear transação de estoque | Não declarada no schema base inspecionado | Desconhecido | Não é necessária para reserva/pagamento STOCK mínimo; se notificação for integrada, exigir outbox durável separada | Desnecessária para esta candidata; aditiva se escolhida depois |
| `auditLogs` | Trilha operacional/auditoria | Sim, declarada no schema base | Desconhecido | Não é dependência do fluxo mínimo; definir eventos sem dados sensíveis se futuramente usada | Não alterar para esta candidata |
| `stockCheckoutAttempts`, `stockCheckoutItems`, `stockWebhookEvents` | Tentativa idempotente, snapshots e deduplicação no adapter P5/P6 | Não declaradas no schema base; existem apenas no fixture sintético da candidata | Desconhecido | Mapear para schema final ou aprovar tabelas novas após attestation; não executar DDL agora | Preferir novas tabelas aditivas; rollback com leitura/paralisação e retenção dos registros, sem apagamento imediato |

### Migrations e diferenças observadas

- No commit base, migrations locais existentes chegam a `0017`; não há `0021–0025` nessa árvore.
- No commit de staging `26152c3…`, `0025_product_variant_identity.sql` somente adiciona `productVariants.isActive` (`DEFAULT 0` e `CHECK`). Ela não cria preço/identidade completa de variante, snapshot em `orderItems`, reserva por variante/tentativa ou tentativa de pagamento idempotente.
- A migration de staging `0023_asaas_webhook_inbox.sql` cria inbox de eventos, mas isso não comprova que foi aplicada em produção nem que o fluxo STOCK está compatível com seus estados.
- O fixture P5/P6 é deliberadamente mínimo e sintético: `products`, `productVariants`, `stockCheckoutAttempts`, `stockCheckoutItems`, `stockReservations` e `stockWebhookEvents`. Ele não modela todas as colunas/tabelas de produção e não deve ser convertido em migration definitiva.
- Nenhuma cadeia `0021–0025` foi aplicada ou copiada para esta candidata.

## Attestation de produção

Não foi encontrada evidência local de uma conta MySQL read-only autorizada ou de attestation do schema instalado. Não houve SQL, acesso ao banco, root, provisionamento, túnel ou leitura de segredos.

Consultas mínimas para uma futura sessão explicitamente autorizada, em conta read-only, sem coletar linhas de clientes:

1. `SELECT DATABASE(), VERSION()`.
2. Consultar `information_schema.tables` para as tabelas listadas na matriz.
3. Consultar `information_schema.columns` para colunas, tipos, nulabilidade e defaults dessas tabelas.
4. Consultar `information_schema.statistics` e `key_column_usage` para índices, unicidade e FKs relevantes.
5. Ler somente a tabela/histórico de migrations já usado pela aplicação para identificar versões aplicadas.

Não incluir dados de pedidos, pagamentos, clientes ou tokens. A autorização e o mecanismo seguro de conexão precisam ser definidos antes dessas consultas; não enviar credenciais em texto aberto.

## Fronteira Asaas local

`server/stock/asaasStockWebhookBoundary.ts` adapta o verificador usado pelo controller atual (`validateAsaasWebhookSignature`, comparando `asaas-access-token` com `ASAAS_WEBHOOK_TOKEN` em tempo constante). Como o verificador legado aceita token ausente fora de produção, a fronteira STOCK recusa configuração ausente antes de chamá-lo, inclusive em desenvolvimento.

Após autenticar, o decoder exige evento/eventId explícito, `payment.externalReference`, `payment.id`, valor inteiro em centavos e moeda BRL (ou moeda omitida, assumida BRL pelo contrato local). Eventos pagos, falhos e pendentes usam allowlists e status consistentes; conteúdo desconhecido ou conflitante é rejeitado. A camada de domínio confere pedido, pagamento e total; grava hash/evento e alteração financeira na transação antes de retornar reconhecimento. Replay com mesmo ID/hash é duplicado; mesmo ID com payload diferente é conflito. Eventos tardios não reabrem tentativa liberada nem revertem pagamento confirmado.

Foram usados apenas fixtures sintéticos. O módulo não chama o Asaas e não foi ligado ao controller HTTP existente.

## Contrato HTTP e frontend

| Aspecto | Frontend/backend base | Contrato STOCK P6 | Compatibilidade |
|---|---|---|---|
| Carrinho | `CartItem` carrega `product`, `quantity` e `selectedOptions` genérico; não persiste `variantId` tipado | Requer `productId`, `variantId`, tamanho, cor e quantidade | Incompatível: opções visuais não são identidade persistente da variante |
| Pedido | `orders.createAsaasCharge` recebe método, itens, frete, endereço, cliente e cupom | A candidata recebe `attemptId` e itens STOCK; total é recalculado da variante e domínio só cobre produtos | Incompatível: frete, cupom, cliente/endereço e criação de pedido integral não pertencem ao contrato STOCK local |
| Cobrança | Backend atual cria cobrança durante mutation e retorna `orderId` numérico e dados do método Asaas | Contrato STOCK devolve `orderId` string derivado da tentativa, `paymentId`, `checkoutUrl`, `amountCents`, snapshots e `replayed` | Resposta e ID incompatíveis; precisa de adapter/versão de API revisada com frontend |
| Estados | UI observa `orders.detail.status` (`paid`, `processing`, `shipped`, `delivered`) e usa dados específicos de PIX/boleto/cartão | Domínio mantém tentativa (`reserved/paid/released`) e provedor (`not_started/creating/ambiguous/created/definitive_failure`) | Requer tradução explícita e status pendente; UI atual não representa reconciliação ambígua |
| Notificações | A mutation atual envia e-mail de pedido e cobrança pendente inline, com erros ignorados | Candidato não possui outbox de notificação | Não compatível sem contrato/outbox; fora deste incremento |
| Retomada | Frontend não envia `attemptId` estável nem consulta/reabre uma tentativa pendente | P6 idempotente por `attemptId` e payload fingerprint; replay conflituoso é recusado | Incompatível; precisa persistir chave de tentativa por carrinho e reconciliar estado antes de integração |

Nenhum frontend ou endpoint público foi alterado.

## Scheduler de expiração

- Inicialização: invocação controlada do método `expireReservations` do runtime STOCK, apenas por worker interno após schema confirmado; sem timer em memória e sem rota pública nesta candidata.
- Lotes: tamanho padrão 50, máximo 500 validado no domínio.
- Concorrência: transação InnoDB com `FOR UPDATE SKIP LOCKED`, ordenação determinística por expiração/attemptId e atualização condicional. Instâncias concorrentes podem trabalhar em lotes distintos sem processar a mesma tentativa.
- Elegibilidade: só `providerState='not_started'` é liberado automaticamente. `creating`, `ambiguous` e `created` ficam retidos e exigem reconciliação; estado `paid` não é elegível. Isso protege corrida de pagamento e resposta incerta.
- Reinício: `reservationExpiresAt`, `expiryReviewedAt` e estado ficam persistidos no banco; o próximo ciclo retoma sem memória local.
- Logs: emitir apenas contagens de liberadas/encaminhadas para reconciliação e duração/tamanho do lote; não registrar token, payload, URL de cobrança, dados de cliente ou identificador de pagamento. O executor periódico ainda não está instalado no processo da aplicação.

## Resultado local

A fronteira Asaas é o único código novo neste gate. O adapter permanece desacoplado das rotas; runtime continua sem mount e `PUBLIC_CHECKOUT_DISABLED` permanece a primeira barreira antes de IO. Não existe compatibilidade de produção atestada até haver inspeção remota read-only autorizada e revisão do schema efetivamente instalado.
