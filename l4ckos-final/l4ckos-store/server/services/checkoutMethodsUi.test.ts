import {describe,it,expect,vi} from "vitest";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import Pagamento from "../../client/src/pages/Pagamento";
const view=vi.hoisted(()=>({mobile:false}));
vi.mock("../../client/src/hooks/useIsMobile",()=>({useIsMobile:()=>view.mobile}));
vi.mock("../../client/src/contexts/CartContext",()=>({useCart:()=>({isCatalogReady:true,cart:{itemCount:1,total:99,items:[{quantity:1,addedAt:1,product:{id:1,name:"Synthetic",price:99,stock:96,salesMode:"STOCK",images:[],imageUrl:"",category:"fixture"}}]},hasUnavailableItems:false,revalidateCart:vi.fn(),removeFromCart:vi.fn(),updateQuantity:vi.fn(),clearCart:vi.fn()})}));
vi.mock("../../client/src/contexts/UserContext",()=>({useUser:()=>({user:null,isAuthenticated:false})}));
vi.mock("../../client/src/hooks/useOrders",()=>({useCreateAsaasCharge:()=>({isPending:false,mutateAsync:vi.fn()})}));
vi.mock("../../client/src/lib/trpc",()=>({trpc:{orders:{validateCoupon:{useMutation:()=>({})},detail:{useQuery:()=>({})}},profile:{get:{useQuery:()=>({})}}}}));
vi.mock("../../client/src/components/PreorderInfo",()=>({PreorderInfo:()=>null,CheckoutPreorderNotice:()=>null}));
describe("actual checkout rendering without remote IO",()=>{
 it.each([false,true])("offers only PIX/card with valid PIX default, mobile=%s",mobile=>{
  view.mobile=mobile;
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(Pagamento)));
  expect(html).toContain("PIX");expect(html).toContain("Cartão");
  expect(html).not.toMatch(/<button[^>]*>[\s\S]*?Boleto[\s\S]*?<\/button>/);
  const options=html.match(/aria-pressed="(?:true|false)"/g)??[];expect(options).toHaveLength(2);
  expect(options).toContain('aria-pressed="true"');
  expect(html).not.toContain("Abrir boleto");expect(html).toContain("Finalizar compra");
 });
});
