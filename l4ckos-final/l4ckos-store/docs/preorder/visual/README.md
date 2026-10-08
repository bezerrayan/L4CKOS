# Visual local — PREORDER/BATCH

Preview: http://127.0.0.1:3413. Dados exclusivamente sintéticos; nenhum pagamento real foi submetido. Capturas: desktop 1440×1000; mobile 390×844.

| Tela | Desktop | Mobile |
| --- | --- | --- |
| Cards | [Abrir](products-desktop.png) | [Abrir](products-mobile.png) |
| Produto PREORDER | [Abrir](product-desktop.png) | [Abrir](product-mobile.png) |
| Carrinho apenas em pré-venda | [Abrir](cart-preorder-desktop.png) | [Abrir](cart-preorder-mobile.png) |
| Carrinho misto | [Abrir](cart-desktop.png) | [Abrir](cart-mobile.png) |
| Checkout misto | [Abrir](checkout-desktop.png) | [Abrir](checkout-mobile.png) |
| Detalhes do pedido pago | [Abrir](order-desktop.png) | [Abrir](order-mobile.png) |
| Acompanhamento por número | [Abrir](tracking-desktop.png) | [Abrir](tracking-mobile.png) |
| Lista/criação de lotes | [Abrir](admin-list-desktop.png) | [Abrir](admin-list-mobile.png) |
| Lote/resumo de produção | [Abrir](admin-details-desktop.png) | [Abrir](admin-details-mobile.png) |

Fluxo observado: produto PREORDER com estoque zero permite escolher cor/tamanho e adicionar; produto STOCK mantém disponibilidade física. Carrinho com ambos apresenta aviso de envio conjunto. Checkout mobile mantém lote/prazo/100% visíveis mesmo com resumo recolhido. Pedido pago mostra contexto histórico e “aguardando produção”. Admin mostra dois produtos, cinco peças confirmadas, R$ 679,50 de itens confirmados, mínimo 10/faltam 5. A tabela de produção usa rolagem interna em telas pequenas.

Asserções do navegador: checkout mobile `mixed=true`, `payment=true`, `batch=true`, `overflow=false`; tracking desktop `preorder=true`, `production=true`, `overflow=false`. A revisão de imagens confirmou os avisos legíveis e a identidade existente. Não houve redesign global.


## Situação das evidências

As capturas existentes registram uma execução anterior do preview local.
O arquivo `responsive-checks.json` contém 35 verificações históricas.

O script atual prevê 45 verificações em cinco resoluções e 18 capturas.
Essa execução atualizada ainda está pendente e não deve ser considerada
homologada com base nas capturas anteriores.

Nenhum pagamento real foi submetido durante o preview documentado.
