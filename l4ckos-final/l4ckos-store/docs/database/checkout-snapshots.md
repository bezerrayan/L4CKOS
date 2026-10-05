# Checkout: snapshots e tentativas

O fluxo anterior de `orders.createAsaasCharge` criava `orders`, abria outra
transação apenas para `stockReservations` e chamava o Asaas. Nenhum item de
pedido era inserido. As reservas e o reader baseado em `products.price` não
substituem o histórico da compra. O Order 8 de staging permanece evidência;
esta correção não faz backfill nem acessa staging.

## Persistência local

`server/database/checkout.ts` usa uma conexão dedicada. A cotação de frete ocorre
antes da transação. Produtos e variantes são novamente lidos com locks, em ordem
determinística. Mudança de preço ou metadata durante a cotação aborta a tentativa.
Em READ COMMITTED, a mesma transação valida estoque disponível (estoque menos
reservas ativas), valida cupom, cria o pedido pending/unconfirmed, todos os
orderItems, reservas ligadas a orderItemId e a evidência `checkout.created`.
Falha local faz rollback de todo esse conjunto.

Os campos já existentes no contrato canônico são usados: productId, variantId,
productName, variantName, sku, size, color, imageUrl, quantity, unitPrice,
totalPrice. Sem migration. O preço vem do produto no servidor, ou do preço
não nulo da variante selecionada; preço nulo da variante usa o produto. Variantes
devem pertencer ao produto; seleção por cor/tamanho deve identificar no máximo
uma variante. Opções de produto base são validadas contra o catálogo ou os
fallbacks já usados pela vitrine, agora compartilhados em catalogOptions.ts.
Não há coluna de produto ativo/inativo no contrato atual; inexistência e falta
de estoque bloqueiam compra, sem inventar um estado novo.

`lineTotal = unitPrice * quantity`, limitado a INT MySQL positivo/zero para preço
e total, quantity inteira entre 1 e 99. Soma também limitada a INT.
`orderTotal = soma(lineTotal) + frete - desconto`, com desconto limitado ao bruto.
Regra existente: percentual aplica-se a itens + frete; cupom fixo é em reais.
O arredondamento percentual usa inteiros/BigInt. Frete e provider recebem/convertem
unidades decimais somente nas fronteiras de suas APIs, sem aritmética monetária
intermediária em float. Preview de cupom usa os mesmos preços e equação.

Readers de reservas ligadas usam snapshots de orderItems. Reservas históricas
sem vínculo mantêm seu fallback antigo, sem fabricar snapshots. Confirmação de
pagamento consome também estoque da variante quando vinculada, na transação
existente, com proteção contra repetição.

## Rede, idempotência e recuperação

O frontend envia checkoutAttemptId UUID. Session storage guarda somente UUID e
digest da requisição, sem endereço, documento ou e-mail. Repetição da mesma
requisição reutiliza o UUID, inclusive após reload. A criação de um novo carrinho (addedAt diferente) distingue uma compra nova
mesmo com conteúdo idêntico. Não apague a identificação
para contornar uma resposta incerta.

O servidor deriva a chave por usuário + UUID, protegida pela UNIQUE física
orders.checkoutAttemptId e por GET_LOCK com timeout finito. checkoutFingerprint
vincula o conteúdo; mudar conteúdo com a mesma identificação é recusado.
O advisory lock permanece durante a rede; a transação de dados **não** permanece
aberta. O pedido e itens já estão commitados quando Asaas é chamado.

O contrato antigo não tinha idempotência persistente funcional nem armazenamento
da resposta PIX. O executor agora salva a resposta necessária ao replay em
auditLogs.metadata, action `checkout.charge_created`, actorType system,
actorUserId NULL. Não usa payments/paymentEvents/notificationOutbox como writers
novos e não reinterpreta asaasCheckoutId como paymentId. A resposta não inclui
API key; não é impressa nos logs. Registro de sucesso e incremento de cupom
ocorrem juntos, em uma transação após a resposta do provider. Antes disso a
tentativa reserva quota de cupom; usedCount só aumenta em sucesso, como antes.

Replay retorna a resposta persistida, sem novo pedido/item/reserva/provider ou
novo dispatch dos e-mails do checkout. Timeout, crash entre commit e chamada,
ou falha de persistência depois da chamada deixa um pedido completo pending,
recusa retry externo e retorna CHECKOUT_RECOVERY_REQUIRED. Isso não afirma que
a cobrança falhou nem que o pagamento foi confirmado. Não há compensação
financeira, recuperação automática, cancelamento remoto ou exclusão de evidência.
Quota de cupom de uma tentativa incerta requer revisão antes de ser liberada.

As reservas mantêm o lease existente de 20 minutos. Reutilizar uma cobrança
antiga não renova estoque automaticamente. A recuperação de resultado incerto
e de pagamento após expiração é uma etapa operacional separada.

## Compatibilidade e verificação

O novo campo obrigatório checkoutAttemptId exige publicar frontend e backend
compatíveis na próxima etapa de staging. Clientes antigos sem esse campo são
recusados antes de criar dados ou chamar provider. Nenhum deploy ocorre neste fix.

Testes locais cobrem rollback MySQL real com SIGNAL no segundo item/reserva,
preço/total adulterado, opções/ownership, concorrência, replay, erro externo,
erro ao persistir resposta externa, snapshot após alteração do catálogo,
consumo idempotente da variante e backup/restore dos 26 objetos canônicos.
Asaas/frete são adapters mockados e e-mails não são chamados nos testes de banco.
