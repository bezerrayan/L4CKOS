import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { batchEditSchema } from "./productionBatches";
import { civilDate, brasiliaCalendarDate, manufacturingEstimate, purchasedScheduleMessages } from "../../shared/preorder";
import { PreorderInfo, PurchasedPreorderInfo, CheckoutPreorderNotice } from "../../client/src/components/PreorderInfo";
import { renderEmailTemplate } from "../services/email/emailRenderer.js";
const form = { name:"Fixture", salesOpenAt:null, salesCloseAt:null, estimatedShippingStart:"2026-11-05T03:00:00Z", estimatedShippingEnd:"2026-11-10T03:00:00Z", estimatedManufacturingStart:"2026-10-20", estimatedManufacturingEnd:"2026-11-05", minimumQuantity:0, maximumQuantity:null };
describe("manual manufacturing schedule, no external IO", () => {
  it("accepts valid and same-day manufacturing windows without automatic durations", () => {
    expect(batchEditSchema.safeParse(form).success).toBe(true);
    expect(batchEditSchema.safeParse({...form,estimatedManufacturingStart:form.estimatedManufacturingEnd}).success).toBe(true);
  });
  it.each(["bad", "2026-02-30", "2026-13-01", "2026-11-01T00:00:00Z"])("rejects invalid civil date %s", date => {
    expect(batchEditSchema.safeParse({...form,estimatedManufacturingStart:date}).success).toBe(false);
    expect(civilDate(date)).toBeNull();
  });
  it("rejects incomplete, reversed and client-editable legacy markers", () => {
    expect(batchEditSchema.safeParse({...form,estimatedManufacturingEnd:null}).success).toBe(false);
    expect(batchEditSchema.safeParse({...form,estimatedManufacturingEnd:"2026-10-01"}).success).toBe(false);
    expect(batchEditSchema.safeParse({...form,manufacturingScheduleRequired:0}).success).toBe(false);
    expect(batchEditSchema.safeParse({...form,estimatedManufacturingStart:null,estimatedManufacturingEnd:null}).success).toBe(true);
  });
  it("compares postage in Brasilia and does not reinterpret a civil date as UTC midnight", () => {
    expect(brasiliaCalendarDate("2026-11-05T02:59:59Z")).toBe("2026-11-04");
    expect(batchEditSchema.safeParse({...form,estimatedShippingStart:"2026-11-05T02:59:59Z"}).success).toBe(false);
    expect(batchEditSchema.safeParse({...form,estimatedShippingStart:"2026-11-05T00:00:00-03:00"}).success).toBe(true);
    expect(civilDate(new Date("2026-11-05T00:00:00Z"))).toBe("2026-11-05");
    expect(manufacturingEstimate("2026-11-05","2026-11-05",true)).toContain("05/11/2026");
  });
  it("returns clear date validation issues instead of throwing on invalid postage", () => {
    expect(batchEditSchema.safeParse({...form,estimatedShippingStart:"invalid"}).success).toBe(false);
  });
  it("renders legacy unknown periods without inventing dates or durations", () => {
    expect(manufacturingEstimate(null,null)).toContain("período a confirmar");
    expect(manufacturingEstimate(null,null)).not.toContain("dias");
  });
  it("distinguishes original and updated manufacturing commitments in real purchase component", () => {
    const html=renderToStaticMarkup(createElement(PurchasedPreorderInfo,{status:"paid",item:{salesModeAtPurchase:"PREORDER",estimatedManufacturingStartAtPurchase:"2026-10-20",estimatedManufacturingEndAtPurchase:"2026-11-05",currentEstimatedManufacturingStart:"2026-12-01",currentEstimatedManufacturingEnd:"2026-12-10"}}));
    expect(html).toContain("registrada na compra entre 20/10/2026 e 05/11/2026");
    expect(html).toContain("O cronograma de fabricação mudou");
    expect(html).toContain("01/12/2026");
  });
  it("keeps product and mixed checkout wording separate from freight", () => {
    const product={salesMode:"PREORDER" as const,productionBatch:{id:1,status:"OPEN" as const,...form,salesOpenAt:null,salesCloseAt:null}};
    const html=renderToStaticMarkup(createElement(PreorderInfo,{product}));
    expect(html).toContain("Fabricação estimada entre 20/10/2026 e 05/11/2026");
    expect(html).toContain("Postagem estimada");
    const mixed=renderToStaticMarkup(createElement(CheckoutPreorderNotice,{items:[{product},{product:{salesMode:"STOCK"}}]}));
    expect(mixed).toContain("única remessa"); expect(mixed).toContain("não inclui fabricação");
  });
  it("renders payment confirmation from original purchase snapshots and escapes batch text", () => {
    const messages=purchasedScheduleMessages([{salesModeAtPurchase:"PREORDER",productionBatchNameAtPurchase:"<script>",estimatedManufacturingStartAtPurchase:"2026-10-20",estimatedManufacturingEndAtPurchase:"2026-11-05",estimatedShippingStartAtPurchase:form.estimatedShippingStart,estimatedShippingEndAtPurchase:form.estimatedShippingEnd}]);
    const html=renderToStaticMarkup(renderEmailTemplate("paymentApproved",{salesMode:"PREORDER",scheduleMessages:messages}));
    expect(html).toContain("20/10/2026"); expect(html).toContain("05/11/2026");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(purchasedScheduleMessages([{salesModeAtPurchase:"STOCK"}])).toEqual([]);
  });
});
