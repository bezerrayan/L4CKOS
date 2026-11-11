# Limites de drops exclusivos no carrinho (UX)

Data: 2026-11-11 · Branch `integration/v6-frontend-launch` · Base `4dfca44`. Backend, cota e checkout não foram alterados.

## Contrato usado

Só `exclusiveDrops.forProduct({ productId })` (já existente, por produto, com a visão do usuário autenticado):
`drop.id`, `drop.requiresAuthorization`, `drop.purchaseWindow.open`, `viewer.status`, `viewer.unitsRemaining`, `viewer.unitLimit`.

- `unitsRemaining` é derivado no servidor a partir das tentativas STOCK (reservadas + pagas) e é **uma cota por drop**,
  compartilhada por todos os produtos, tamanhos e variantes do drop. A sacola não reserva nada; logo o que o cliente
  ainda pode enviar ao checkout é exatamente `unitsRemaining`.
- Não existe endpoint de cota por drop nem em lote: o frontend consulta um produto por vez (os produtos da sacola) e agrupa
  por `drop.id`. Limitação aceita; um `exclusiveDrops.quota({ dropIds })` evitaria N chamadas.
- Sem visão do servidor (falha, ainda carregando, produto não exclusivo) **nenhum limite é inventado**: nada é bloqueado e o
  checkout continua sendo o portão definitivo.

## Comportamento

| Situação | Carrinho / gaveta / checkout / PDP |
| --- | --- |
| Desbloqueado, dentro do limite | aviso "até N unidades (somando todos os produtos e tamanhos do drop)"; "+" ativo até o limite |
| No limite | "Limite atingido"; "+" desabilitado ("Limite do drop atingido"); Finalizar compra segue disponível |
| Acima do limite (cota reduzida/dados antigos) | alerta "Remova N unidade(s) para continuar"; checkout bloqueado ("Revise o limite do drop"); reduzir quantidade continua permitido |
| Sem acesso / pendente / rejeitado / expirado | alerta com link para o produto; checkout bloqueado |
| Janela de compra fechada | alerta; checkout bloqueado |
| Sessão expirada (viewer `login_required`) | "Entre na sua conta para validar o seu limite" + link; não mostra número |
| Cota alterada | revalida ao focar a janela, a cada 30 s, ao trocar de conta e em `revalidateCart` |
| PDP | desconta as unidades **de todo o drop** na sacola (antes só do mesmo produto) e informa que o limite é compartilhado |

Textos nunca prometem estoque ou capacidade: todos terminam em "O limite e a disponibilidade são confirmados ao finalizar o
pedido". `addToCart`/`updateQuantity` também recusam incrementos acima do limite conhecido. O servidor segue impondo a cota
no checkout (verificado em `docs/drop-quota-checkout-verification-2026-11-11.md`).

## Arquivos

`client/src/utils/dropQuota.ts` (cálculo puro), `client/src/contexts/CartContext.tsx` (estado, clamp), `client/src/components/DropQuotaNotice.tsx|css`,
`Carrinho.tsx`, `CartDrawer.tsx`, `Pagamento.tsx`, `ProductDetail.tsx`, `ExclusiveAccessPanel.tsx`.

## Validação

- Testes: `dropQuota.test.ts` (9) e `Carrinho.dropQuota.test.tsx` (7); suíte cliente 247 passam. Typecheck e build OK.
- Navegador real (backend local + MySQL 9.7.2 descartável, sem mocks), 1440, 375 e 320 px: PDP soma o drop; carrinho no limite;
  cota reduzida pelo servidor (alerta + bloqueio); cota aumentada (aviso limpa, "+" volta); sessão expirada; sem overflow
  horizontal; sem erros de página. Prints em `artifacts/launch-frontend/drop-quota/`.

## Limitações

- A cota exibida é um retrato: outro dispositivo pode consumi-la entre as atualizações; por isso o checkout continua decidindo.
- Itens do drop em sacola de visitante anônimo mostram o pedido de login; o limite só é conhecido depois do login.
- A lacuna de backend registrada antes (pagamento recusado não libera a cota) continua; a UI mostrará a cota reduzida.
- Janela de compra fechada usa `purchaseWindow.open` do servidor; não há tentativa de relógio no cliente.
