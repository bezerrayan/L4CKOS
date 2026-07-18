# Eventos de funil

O cliente emite eventos pelo `window` (`l4ckos:analytics`) e, quando presente, pelo `window.dataLayer`.
Um coletor consentido, como Google Tag Manager, pode ouvir esse `dataLayer` e encaminhar apenas os campos já definidos em `lib/analytics.ts`.

Eventos atuais: visualização e opções de produto, adição/remoção da sacola, início do checkout, cotação de frete, cupom, método de pagamento e criação/falha de cobrança.

Os eventos nunca incluem nome, e-mail, CPF, CEP, endereço, dados do cartão ou valor do pedido.
