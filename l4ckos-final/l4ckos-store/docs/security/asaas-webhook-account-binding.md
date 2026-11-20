# Configuração financeira de webhooks Asaas

Este documento descreve os pré-requisitos para receber eventos de pagamento quando o payload não informa a moeda. Ele não habilita checkout nem configura serviços remotos.

## Variáveis

- `ASAAS_WEBHOOK_ACCOUNT_ID`: identidade exata da conta Asaas esperada. O valor precisa ser fixado pelo operador após conferir a conta do ambiente. Para eventos que trazem `account.id`, o código exige correspondência exata. Uma referência de pagamento ou um `customerId` não substitui essa identidade.
- `ASAAS_WEBHOOK_ACCOUNT_CURRENCY`: declaração explícita da moeda da conta. Só usar `BRL` depois que a moeda da conta tiver sido confirmada por fonte externa confiável. A variável, sozinha, não prova a moeda.

Não preencher esses valores por inferência nem copiar valores entre Sandbox e produção. Não armazenar tokens ou chaves neste documento.

## Evidência da moeda da conta

A moeda deve ser confirmada fora do webhook, por uma fonte controlada pelo proprietário financeiro, como as configurações ou a documentação contratual da conta Asaas correspondente ao ambiente. Registrar para revisão a identidade da conta, a moeda, a fonte e a data da confirmação. A confirmação da conta Sandbox não comprova a configuração de uma conta de produção.

Se a identidade ou moeda não puder ser comprovada, deixar a configuração ausente. O processamento deve falhar fechado para confirmação financeira: persistir a observação e a divergência para reconciliação, sem marcar o pedido como pago nem consumir ou liberar estoque.

## Identidade autoritativa da cobrança

Para um evento pago sem moeda, a confirmação exige, no mínimo:

1. Webhook autenticado e `account.id` igual ao `ASAAS_WEBHOOK_ACCOUNT_ID` fixado.
2. Reconsulta pelo ID exato da cobrança, antes de abrir a transação com locks de negócio.
3. `payment.id` atual igual ao ID do evento, cobrança não removida e status atual do provedor em estado pago.
4. Referência externa igual à referência do evento e correlacionada ao pedido/tentativa local, sem associação por aproximação.
5. Valor atual do provedor igual ao valor do evento e ao valor local, em centavos.
6. `customerId` do provedor igual à identidade local persistida do comprador.
7. Moeda BRL explicitamente retornada pelo estado atual do provedor; quando ausente, a única contingência configurada pelo código é `ASAAS_WEBHOOK_ACCOUNT_CURRENCY=BRL` para `PAYMENT_RECEIVED`, com a identidade da conta também conferida.

A ausência do campo `currency` não significa BRL. A contingência de moeda da conta não se aplica a `PAYMENT_CONFIRMED` ou aos demais eventos. Se faltar qualquer vínculo ou houver divergência, registrar reconciliação durável e não alterar pagamento ou estoque.

## Operação

Antes de qualquer habilitação de checkout, confirmar separadamente no Sandbox o formato real dos campos `account.id`, `payment.id`, `customer`, `externalReference`, `value`, `currency` e `status` em eventos e na resposta de consulta. Esta confirmação não deve usar a API de produção. O código permanece fechado quando as variáveis ou evidências necessárias faltarem.
