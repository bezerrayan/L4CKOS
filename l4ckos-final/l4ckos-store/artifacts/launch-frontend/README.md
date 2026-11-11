# Frontend launch consolidation — visual evidence

Release bundle (`VITE_DEPLOY_TARGET=production`, same-origin) served locally over HTTPS with a **synthetic read-only mock API**
(no database, no Railway/Vercel, no providers). Chromium, viewports: desktop 1440×1000, 430, 375, 320.
All data is fictitious (XIV Bis batch: 4 paid, 1 pending, 1 cancelled order; sizes PP/P/M/G/GG).

Pages: login, cadastro, recuperar-senha, dashboard, produtos, pedidos, drops, logistica, lotes, pre-venda-xiv-bis, home, carrinho.
File pattern: `<page>-<viewport>.png`.
