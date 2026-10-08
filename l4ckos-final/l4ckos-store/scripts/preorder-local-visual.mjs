// Local-only browser verification. Install Playwright separately; no provider calls.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = 'http://127.0.0.1:3413';
const output = new URL('../docs/preorder/visual/', import.meta.url);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  // Fonts, analytics, shipping/payment providers and every remote host are blocked.
  return u.origin === origin ? route.continue() : route.abort();
});
await page.addInitScript(() => localStorage.setItem('l4ckos:cookie-preferences', JSON.stringify({version:'2026-06-24',decidedAt:new Date().toISOString(),status:'essential-only',categories:{necessary:true}})));
await page.goto(`${origin}/produtos`);
const visualEmail = process.env.PREORDER_VISUAL_EMAIL;
const visualPassword = process.env.PREORDER_VISUAL_PASSWORD;
assert.ok(
  visualEmail && visualPassword,
  'PREORDER_VISUAL_EMAIL e PREORDER_VISUAL_PASSWORD são obrigatórias'
);
const login = await page.evaluate(async ({ email, password }) => {
  const { csrfToken } = await fetch('/api/csrf').then(r => r.json());
  const r = await fetch('/api/trpc/auth.localLogin', { method:'POST', headers:{'content-type':'application/json','x-csrf-token':csrfToken}, body:JSON.stringify({json:{email,password}}) });
  return { status:r.status, body:await r.json() };
}, { email: visualEmail, password: visualPassword });
assert.equal(login.status,200); assert.equal(login.body.result.data.json.success,true);
const cartItems = [1,3].map(id => ({product:{id,name:id===1?'Sideways Dreams — Camiseta Oversized':'Logo Essential — Pronta entrega',price:id===1?129.9:79.9,image:'/images/camisa.png',salesMode:id===1?'PREORDER':'STOCK',stock:id===1?0:10},quantity:1,selectedOptions:{Cor:'Preto',Tamanho:'M'},addedAt:new Date().toISOString()}));
const cart = async mixed => {
  await page.evaluate(items => localStorage.setItem('loja-escoteira:cart',JSON.stringify(items)),mixed?cartItems:[cartItems[0]]);
};
const check = async (name, width) => {
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const semantic = [...document.querySelectorAll('.l4-preorder, .l4-preorder *, .l4-batches, .l4-batches *')];
    const green = semantic.flatMap(e => {
      const s=getComputedStyle(e);
      return [s.color,s.backgroundColor,s.borderColor,s.accentColor].filter(v => {
        const rgb=v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if(!rgb)return false;
        const [r,g,b]=rgb.slice(1).map(Number); return g>r+10 && g>b+10;
      });
    });
    const bounds = [...document.querySelectorAll('.l4-tracking-actions > *, .l4-tracking-summary p, .l4-tracking-itemValues, .l4-tracking-step p')].map(e=>e.getBoundingClientRect()).every(r=>r.left>=-1 && r.right<=innerWidth+1);
    const progressBeige = [...document.querySelectorAll(".l4-batches progress")].every(e=>getComputedStyle(e).accentColor === "rgb(230, 214, 194)" && getComputedStyle(e).appearance === "none");
    const beige = [...document.querySelectorAll('.l4-preorder strong, .l4-batches-kicker')].every(e=>getComputedStyle(e).color==='rgb(230, 214, 194)');
    return { overflow:document.documentElement.scrollWidth>innerWidth, actionsAndValuesInBounds:bounds, greenSemantic:green, beige, progressBeige };
  });
  checks.push({name,width,...result});
  assert.equal(result.overflow,false,`${name} ${width}: overflow`);
  assert.equal(result.actionsAndValuesInBounds,true,`${name} ${width}: clipped actions/values`);
  assert.deepEqual(result.greenSemantic,[],`${name} ${width}: green semantic`);
  assert.equal(result.progressBeige,true,`${name} ${width}: native green progress`);
  assert.equal(result.beige,true,`${name} ${width}: beige title`);
};
const capture = async (name,width) => {
  await check(name,width);
  if(width===1440||width===390) await page.screenshot({path:new URL(`${name}-${width===390?'mobile':'desktop'}.png`,output).pathname,fullPage:true});
};
try {
 for (const width of [1440,320,360,390,430]) {
  await page.setViewportSize({width,height:width===1440?1000:844});
  await page.goto(`${origin}/produtos`);
  await page.getByText('PRÉ-VENDA',{exact:true}).first().waitFor();
  await capture('products',width);
  await page.goto(`${origin}/produto/1`);
  await page.getByText('PRÉ-VENDA — DROP 01',{exact:true}).filter({visible:true}).first().waitFor();
  assert.match(await page.locator('body').innerText(),/Pedidos até 31\/10\/2026/);
  assert.match(await page.locator('body').innerText(),/Envio estimado 05\/11–12\/11/);
  assert.doesNotMatch(await page.locator('body').innerText(),/\d+ (peças|unidades) (em estoque|disponíveis)/i);
  await capture('product',width);
  await cart(false); await page.goto(`${origin}/carrinho`);
  await page.getByText('PRÉ-VENDA — DROP 01',{exact:true}).filter({visible:true}).first().waitFor();
  assert.equal(await page.getByText('Envio conjunto',{exact:true}).filter({visible:true}).count(),0);
  await capture('cart-preorder',width);
  await cart(true); await page.goto(`${origin}/carrinho`);
  await page.getByText('Envio conjunto',{exact:true}).filter({visible:true}).waitFor();
  await capture('cart',width);
  await page.goto(`${origin}/checkout`);
  await page.getByRole('heading',{name:'IMPORTANTE SOBRE ESTE PEDIDO'}).waitFor();
  assert.equal(await page.getByText('Envio conjunto',{exact:true}).filter({visible:true}).count(),1);
  await page.getByText('O valor é cobrado integralmente no checkout.',{exact:false}).waitFor();
  await capture('checkout',width);
  await page.goto(`${origin}/acompanhar-pedido?pedido=1`);
  await page.getByText('Acompanhando produção',{exact:true}).first().waitFor();
  await page.getByText('Envio conjunto',{exact:true}).filter({visible:true}).waitFor();
  await capture('tracking',width);
  if(width<600) assert.equal(await page.locator('.l4-tracking-timeline').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
  await page.goto(`${origin}/meus-pedidos/1`);
  await page.getByText('Envio conjunto',{exact:true}).filter({visible:true}).waitFor();
  await capture('order',width);
  await page.goto(`${origin}/gestao`);
  await page.getByRole('button',{name:'Lotes / Pré-venda',exact:true}).click();
  await page.getByRole('button',{name:/DROP 01/}).waitFor();
  await capture('admin-list',width);
  await page.getByRole('button',{name:/DROP 01/}).click();
  await page.getByText('Peças confirmadas',{exact:true}).waitFor();
  assert.equal(await page.locator('.l4-batches-new').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.l4-batches-stats strong').nth(1).innerText(),'5');
  await capture('admin-details',width);
  if(width<900) {
    const position=await page.locator('.l4-batches-layout').evaluate(e=>({article:e.querySelector('article').getBoundingClientRect().top,aside:e.querySelector('aside').getBoundingClientRect().top}));
    assert.ok(position.article<position.aside,'selected batch must precede creation on mobile');
  }
 }
 assert.deepEqual(errors,[]);
 await writeFile(new URL('responsive-checks.json',output),JSON.stringify({origin,widths:[320,360,390,430],desktop:1440,checks,pageErrors:errors,externalRequests:'blocked',paymentSubmitted:false},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,pageErrors:errors,greenSemantic:'ZERO',widths:[320,360,390,430],screenshots:18}));
} finally { await browser.close(); }
