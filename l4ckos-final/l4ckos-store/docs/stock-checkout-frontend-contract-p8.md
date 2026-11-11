# STOCK checkout frontend contract — Gate P8

Escopo local. Nenhuma rota foi montada, nenhuma chamada financeira real foi feita e o gate continua fechado.

## Contratos encontrados

- `ProductDetail` chama `products.getById`; o backend devolve `variants` via `getProductByIdWithDetails`. O formato declarado em `drizzle/schema.ts` garante ID, produto, nome, SKU, preço e estoque, mas não garante `size`, `color` nem `isActive`.
- A tela de produto coleta tamanho/cor e o `CartContext` persistia `selectedOptions` genérico no `localStorage`. Não havia `variantId` no tipo do carrinho.
- `Pagamento` chama `orders.createAsaasCharge` com `productId` e `quantity`, endereço, frete, cliente e cupom. Esse endpoint legado cria pedido/cobrança e retorna campos de PIX/boleto/cartão. Seu gate existente permanece no backend.
- O checkout STOCK P6 requer `attemptId`, `productId`, `variantId` e quantidade; o domínio calcula preço/estoque e devolve correlação de pagamento. Não possui endpoint HTTP de leitura/retomada nem estados de tela.
- A tela existente observa `orders.detail.status` (`paid`, `processing`, `shipped`, `delivered`), limpa o carrinho depois de confirmar e não salva chave de tentativa.

## Contrato STOCK V1 proposto

`shared/stockCheckoutV1.ts` define schemas estritos Zod:

```ts
type StockCheckoutRequestV1 = {
  attemptId: string; // 16–120 caracteres opacos, persistidos antes do transporte
  items: Array<{ productId: number; variantId: number; quantity: number }>;
};
```

Campos adicionais por item — especialmente `price`, `unitPrice`, disponibilidade, SKU, tamanho e cor — são rejeitados pelo contrato HTTP. `server/stock/stockCheckoutHttpContract.ts` valida o request e adapta a resposta atual do domínio para `status: "pending"`, `attemptId`, `orderId`, `paymentId`, `checkoutUrl`, `amountCents` e `replayed`. A resposta de pagamento pendente é um sucesso de criação, não confirmação financeira.

O schema de retomada define `pending`, `paid`, `failed`, `expired`, `abandoned` e `reconciliation_required`, junto ao `attemptId`, pedido e dados de cobrança disponíveis. A leitura HTTP de retomada ainda não existe.

## Variantes e carrinho

- `ProductDetail` usa linhas recebidas de `products.getById`. Só associa tamanho/cor a um ID real e único quando a linha retornada inclui `id`, `productId`, `size`, `color` e `isActive` verdadeiro. Combinação ausente, inativa, ambígua ou sem atributos reais não pode ser adicionada como STOCK.
- O carrinho armazena `variantId` e as linhas de catálogo junto à seleção. A leitura do armazenamento preserva linhas antigas, mas não infere IDs a partir de nomes/opções. `stockLinesFromCart` converte carrinho para a forma esperada pelo adaptador; ausência ou inconsistência do ID é recusada localmente.
- O servidor continua sendo fonte de verdade: reconfirma vínculo, atividade, preço e estoque atuais; os snapshots vêm da variante carregada sob transação. O adaptador frontend nunca inclui preço/disponibilidade.

## Política de tentativa

- Antes da primeira requisição, o cliente cria um ID aleatório criptográfico (`crypto.randomUUID`) e o persiste no `localStorage`, associado ao fingerprint canônico de `productId/variantId/quantity`.
- O mesmo carrinho mantém o mesmo ID em retry e refresh; estado `pending` e `reconciliation_required` não expira localmente nem gera ID novo automaticamente. Falha de transporte também preserva o ID, pois o resultado financeiro pode ser ambíguo.
- Só um estado definitivo `failed`, `expired` ou `abandoned` retornado por retomada autoriza `startNewAfterTerminal`. `paid` fica bloqueado para evitar duplicar compra; `reconciliation_required` exige conciliação. Registros terminais antigos podem ser limpos após 30 dias.
- Apagar o armazenamento local perde a chave; backend deverá oferecer recuperação autenticada por usuário/pedido ou outra correlação idempotente antes de produção. O ID não autentica o usuário.

## Estados apresentados

`stockAttemptStatusLabel` mapeia pendente para “Aguardando confirmação do pagamento”, confirmado, falha definitiva, expiração e reconciliação. Tentativa pendente mantém a opção de retomar; falha de transporte não deve ser apresentada como falha definitiva. Checkout expirado não deve gerar nova cobrança até consultar estado definitivo. A tela `Pagamento` existente ainda não consome esse mapa.

## Testes locais

`server/stock/stockCheckoutClient.test.ts` cobre seleção real/inativa/cruzada, recuperação do carrinho, retry e refresh com ID estável, rejeição de variante ausente/inventada, preço no payload, resposta pendente, expiração definitiva e gate fechado sem storage/transporte. `server/stock/stockCheckout.test.ts` também valida payload V1 sem tamanho/cor: o snapshot continua vindo do servidor.

## Incompatibilidades pendentes

1. O frontend não tem hoje campos tipados de variante nem endpoint público que entregue o conjunto STOCK com dimensão/atividade comprovadas. A declaração de produção também não garante esses campos; schema remoto não foi atestado.
2. `orders.createAsaasCharge` não é compatível com o payload/resposta STOCK. A rota existente não foi alterada; o adaptador não tem transporte HTTP e não foi conectado à UI.
3. A retomada de tentativa por `attemptId` e usuário requer uma consulta backend autenticada e estados persistidos mapeados ao contrato V1.
4. O frontend legado exige envio/frete/endereço/cupom e resposta de pagamento por método, enquanto STOCK V1 só cobre variante, quantidade, preço server-side e checkout pendente. Não se portou logística, PREORDER ou cobranças reais.

Portanto este gate deixa os modelos, conversores e testes locais preparados, mas não comprova compatibilidade ponta a ponta com endpoints reais nem habilita checkout.
