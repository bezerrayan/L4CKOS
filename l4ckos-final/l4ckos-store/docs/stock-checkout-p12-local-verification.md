# STOCK RC3 Gate P12 — verificação local

## Escopo executado

- O HTTP STOCK V1 agora exige `delivery` com opção `local-plano-piloto` e snapshot completo do endereço. O cliente não envia preço nem frete arbitrário.
- A modalidade de entrega e os campos de endereço são gravados no mesmo INSERT transacional do pedido. Endereço incompleto e CEP fora da área do fluxo local (70000000–73999999) são rejeitados antes da reserva e do provider.
- A impressão digital da tentativa inclui itens e entrega. Reutilizar `attemptId` com endereço/modalidade diferente é conflito, não atualização silenciosa do pedido.
- O administrativo conserva o snapshot do pedido mesmo que o perfil tenha seu endereço alterado. Expedição exige pagamento confirmado pelo fluxo confiável e endereço persistido completo.
- O teste de `admin.ordersList` usa o próprio router/procedure e `getOrdersByFilters` Drizzle contra MySQL descartável. `getOrderById` e o filtro por proprietário `getOrderByIdAndUser` também são exercitados contra esse banco.
- `setStockLocalHarnessDb` aceita somente o flag explícito `STOCK_LOCAL_HARNESS=true`, host loopback e database `l4ckos_stock_test`. `getDb()` e `createMysqlConnectionOptions()` mantêm o guard TLS intacto.
- A sessão do harness é JWT sintético assinado/verificado pelo SDK normal; autenticação busca o usuário no fixture e confere `sessionVersion`. O contexto STOCK é injetado somente no servidor de teste.

## Contrato de entrega STOCK V1

```ts
{
  optionId: "local-plano-piloto",
  address: {
    recipient, zipCode, street, number,
    complement?, neighborhood, city, state
  }
}
```

Somente a modalidade local atualmente renderizada no checkout é aceita. A opção custa zero nesta versão e a área segue a regra do serviço de entrega existente (`/^7[0-3]\d{6}$/`). Frete por transportadora e retirada não estão habilitados para STOCK por não fazerem parte deste contrato mínimo.

## Delta do fixture descartável

Além das tabelas STOCK já descritas em `server/stock/fixtures/mysql8-stock-schema.sql`, o fixture usa as colunas legadas necessárias à listagem: usuário autenticável (`openId`, email, papel e versão da sessão), `userAddresses` e snapshot de entrega em `orders`, incluindo `shippingOptionId`. `orders` e reservas também incluem as projeções STOCK definidas no domínio. Este DDL é apenas fixture de teste; não é migration e não comprova que o MySQL remoto tenha essas colunas/índices/constraints.

## Evidências e limites

- MySQL 8.4 descartável testa adapter, concorrência, webhooks, retry/recovery e a rota tRPC com JWT local; sem chamadas ao Asaas.
- `admin.ordersList` consulta autorização administrativa real. Sessão de cliente comum recebe `FORBIDDEN`; consulta de detalhe de cliente usa `userId` no próprio filtro.
- O teste de expedição tenta marcar como enviado antes do webhook pago e espera `BAD_REQUEST`; não dispara notificações.
- Browser E2E não foi executado: o host de automação CUA informou que não há navegador disponível nesta sessão. tRPC HTTP/MySQL não é contado como Browser E2E.
- Antes de qualquer rollout seguem bloqueadores: attestation do schema de produção, revisão de DDL compatível e rollback, backup externo restaurável, homologação Asaas sandbox e revisão frontend. Checkout público continua fechado por padrão.
