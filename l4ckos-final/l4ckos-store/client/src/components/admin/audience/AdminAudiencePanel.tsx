import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Mail, Search, Send, Users } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import {
  AdminEmptyState,
  AdminLoadingState,
  AdminStatCard,
  AdminStatsGrid,
  AdminSurface,
  AdminTableWrapper,
} from "../AdminUI";
import "./AdminAudiencePanel.css";

type AudienceSource = "waitlist" | "customers";
type MarketingAudience = AudienceSource | "both" | "selected";
type Campaign = "drop" | "newProducts" | "promotion" | "crossSell" | "loyaltyCoupon";
type RecipientRef = { source: AudienceSource; id: number };

const PAGE_SIZE = 25;
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const campaignOptions: Array<{ value: Campaign; label: string; needsProducts: boolean; needsCoupon: boolean }> = [
  { value: "promotion", label: "Promoção", needsProducts: false, needsCoupon: false },
  { value: "drop", label: "Lançamento de drop", needsProducts: true, needsCoupon: false },
  { value: "newProducts", label: "Novos produtos", needsProducts: true, needsCoupon: false },
  { value: "crossSell", label: "Produtos relacionados", needsProducts: true, needsCoupon: false },
  { value: "loyaltyCoupon", label: "Cupom de fidelidade", needsProducts: false, needsCoupon: true },
];

export function AdminAudiencePanel({
  onMessage,
  onConfirm,
}: {
  onMessage: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
}) {
  const [source, setSource] = useState<AudienceSource>("waitlist");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedRecipients, setSelectedRecipients] = useState<RecipientRef[]>([]);
  const [audience, setAudience] = useState<MarketingAudience>("waitlist");
  const [campaign, setCampaign] = useState<Campaign>("promotion");
  const [campaignUrl, setCampaignUrl] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponDescription, setCouponDescription] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);

  const summaryQuery = trpc.admin.publicAudienceSummary.useQuery(undefined, { refetchOnWindowFocus: false });
  const pageQuery = trpc.admin.publicAudienceList.useQuery({ source, search, page, pageSize: PAGE_SIZE }, { refetchOnWindowFocus: false });
  const campaignMeta = campaignOptions.find(option => option.value === campaign)!;
  const productsQuery = trpc.admin.productsList.useQuery(undefined, {
    enabled: campaignMeta.needsProducts,
    refetchOnWindowFocus: false,
  });
  const previewQuery = trpc.admin.marketingAudiencePreview.useQuery({
    audience,
    selectedRecipients: audience === "selected" ? selectedRecipients : [],
  }, {
    enabled: audience !== "selected" || selectedRecipients.length > 0,
    refetchOnWindowFocus: false,
  });

  const csvMutation = trpc.admin.publicAudienceCsv.useMutation({
    onSuccess: data => {
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      onMessage(`CSV exportado (${data.rows} registros).`);
    },
    onError: error => onMessage(error.message),
  });
  const sendMutation = trpc.admin.marketingCampaignSend.useMutation({
    onSuccess: data => {
      onMessage(data.message);
      void previewQuery.refetch();
    },
    onError: error => onMessage(error.message),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  useEffect(() => {
    setPage(1);
  }, [source]);

  const totalPages = Math.max(1, Math.ceil((pageQuery.data?.total ?? 0) / PAGE_SIZE));
  const currentRows = pageQuery.data?.rows ?? [];
  const canSend = !sendMutation.isPending && !previewQuery.isLoading && (previewQuery.data?.count ?? 0) > 0;

  function isSelected(row: { id: number }) {
    return selectedRecipients.some(item => item.source === source && item.id === row.id);
  }

  function toggleRecipient(id: number) {
    if (!isSelected({ id }) && selectedRecipients.length >= 500) {
      onMessage("O limite é de 500 destinatários selecionados por disparo.");
      return;
    }
    setSelectedRecipients(current => {
      const exists = current.some(item => item.source === source && item.id === id);
      return exists
        ? current.filter(item => !(item.source === source && item.id === id))
        : [...current, { source, id }];
    });
  }

  function toggleProduct(id: number) {
    setSelectedProductIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function sendCampaign() {
    const count = previewQuery.data?.count ?? 0;
    if (!count) {
      onMessage("Não há destinatários com consentimento ativo para este público.");
      return;
    }
    if (campaignMeta.needsProducts && selectedProductIds.length === 0) {
      onMessage("Selecione pelo menos um produto para esta campanha.");
      return;
    }
    if (campaignMeta.needsCoupon && !couponCode.trim()) {
      onMessage("Informe o cupom da campanha.");
      return;
    }
    if (!(await onConfirm(`O disparo será preparado para ${count} destinatário(s) com consentimento ativo. Confirma?`))) return;

    sendMutation.mutate({
      campaign,
      audience,
      selectedRecipients: audience === "selected" ? selectedRecipients : [],
      productIds: selectedProductIds,
      ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}),
      ...(couponDescription.trim() ? { couponDescription: couponDescription.trim() } : {}),
      ...(campaignUrl.trim() ? { url: campaignUrl.trim() } : {}),
      batchSize: 25,
      delayMs: 500,
    });
  }

  return (
    <div className="admin-audience">
      <AdminStatsGrid>
        <AdminStatCard label="Inscritos no Coming Soon" value={String(summaryQuery.data?.waitlistTotal ?? "—")} icon={<Mail size={18} />} tone="info" />
        <AdminStatCard label="Clientes cadastrados" value={String(summaryQuery.data?.customersTotal ?? "—")} icon={<Users size={18} />} />
        <AdminStatCard label="Novos cadastros hoje" value={String(summaryQuery.data?.newToday ?? "—")} icon={<CalendarDays size={18} />} tone="success" />
        <AdminStatCard label="Novos cadastros · 7 dias" value={String(summaryQuery.data?.newLast7Days ?? "—")} icon={<CalendarDays size={18} />} tone="neutral" />
      </AdminStatsGrid>

      <AdminSurface title="Público" description="Consulte os cadastros e exporte os registros existentes da loja.">
        <div className="admin-audience__tabs" role="tablist" aria-label="Listas de público">
          <button type="button" role="tab" id="admin-audience-tab-waitlist" aria-controls="admin-audience-list" aria-selected={source === "waitlist"} onClick={() => setSource("waitlist")}>
            Coming Soon <span>{summaryQuery.data?.waitlistTotal ?? 0}</span>
          </button>
          <button type="button" role="tab" id="admin-audience-tab-customers" aria-controls="admin-audience-list" aria-selected={source === "customers"} onClick={() => setSource("customers")}>
            Clientes <span>{summaryQuery.data?.customersTotal ?? 0}</span>
          </button>
        </div>

        <div id="admin-audience-list" role="tabpanel" aria-labelledby={source === "waitlist" ? "admin-audience-tab-waitlist" : "admin-audience-tab-customers"}>
        <div className="admin-audience__toolbar">
          <label className="admin-audience__search">
            <Search size={17} aria-hidden="true" />
            <span className="admin-audience__sr-only">Pesquisar por e-mail ou nome</span>
            <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Pesquisar por e-mail ou nome" />
          </label>
          <button className="admin-audience__button admin-audience__button--secondary" type="button" disabled={csvMutation.isPending} onClick={() => csvMutation.mutate({ source, search })}>
            <Download size={16} aria-hidden="true" /> {csvMutation.isPending ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>

        {pageQuery.isLoading ? <AdminLoadingState>Carregando cadastros…</AdminLoadingState> : pageQuery.isError ? (
          <AdminEmptyState title="Não foi possível carregar" description="Atualize a seção e tente novamente." />
        ) : currentRows.length === 0 ? (
          <AdminEmptyState title={search ? "Nenhum resultado" : "Nenhum cadastro nesta lista"} description={search ? "Revise a pesquisa e tente novamente." : "Os cadastros aparecerão aqui quando forem registrados."} />
        ) : (
          <AdminTableWrapper className="admin-audience__table-wrap">
            <table className="admin-audience__table">
              <thead>
                <tr>
                  <th scope="col" className="admin-audience__select-col">Selecionar</th>
                  {source === "customers" ? <th scope="col">Nome</th> : null}
                  <th scope="col">E-mail</th>
                  <th scope="col">Data de cadastro</th>
                  <th scope="col">Marketing</th>
                </tr>
              </thead>
              <tbody>
                {currentRows.map(row => (
                  <tr key={`${source}-${row.id}`}>
                    <td className="admin-audience__select-col">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${row.email || row.name || `cadastro ${row.id}`}`}
                        checked={isSelected(row)}
                        disabled={!row.email || !row.eligibleForMarketing}
                        onChange={() => toggleRecipient(row.id)}
                      />
                    </td>
                    {source === "customers" ? <td>{row.name || <span className="admin-audience__muted">Nome não informado</span>}</td> : null}
                    <td className="admin-audience__email">{row.email || <span className="admin-audience__muted">E-mail não informado</span>}</td>
                    <td>{row.createdAt ? dateTime.format(new Date(row.createdAt)) : "—"}</td>
                    <td><span className={`admin-audience__eligibility${row.eligibleForMarketing ? " is-eligible" : ""}`}>
                      {row.eligibleForMarketing ? "Opt-in ativo" : "Sem opt-in ou descadastrado"}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableWrapper>
        )}

        <div className="admin-audience__pagination">
          <span>{pageQuery.data?.total ?? 0} registros · página {page} de {totalPages}</span>
          <div>
            <button type="button" aria-label="Página anterior" disabled={page <= 1 || pageQuery.isFetching} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={17} /></button>
            <button type="button" aria-label="Próxima página" disabled={page >= totalPages || pageQuery.isFetching} onClick={() => setPage(value => Math.min(totalPages, value + 1))}><ChevronRight size={17} /></button>
          </div>
        </div>
        </div>
      </AdminSurface>

      <AdminSurface title="Disparo de e-mail" description="Use os modelos existentes do Resend. O público é revalidado no servidor antes de cada envio.">
        <div className="admin-audience__campaign-grid">
          <label>Campanha
            <select value={campaign} onChange={event => { setCampaign(event.target.value as Campaign); setSelectedProductIds([]); }}>
              {campaignOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>Público destinatário
            <select value={audience} onChange={event => setAudience(event.target.value as MarketingAudience)}>
              <option value="waitlist">Inscritos no Coming Soon</option>
              <option value="customers">Clientes com opt-in</option>
              <option value="both">Ambos os públicos</option>
              <option value="selected">Destinatários selecionados</option>
            </select>
          </label>
          <label className="admin-audience__wide">URL da campanha
            <input type="url" value={campaignUrl} onChange={event => setCampaignUrl(event.target.value)} placeholder="https://l4ckos.com.br/..." />
          </label>
          {campaign === "promotion" || campaign === "loyaltyCoupon" ? <>
            <label>Código do cupom
              <input value={couponCode} onChange={event => setCouponCode(event.target.value)} placeholder="Ex.: L4CKOS10" />
            </label>
            <label>Descrição do cupom
              <input value={couponDescription} onChange={event => setCouponDescription(event.target.value)} placeholder="Opcional" />
            </label>
          </> : null}
        </div>

        {campaignMeta.needsProducts ? (
          <div className="admin-audience__products">
            <strong>Produtos da campanha</strong>
            {productsQuery.isLoading ? <span>Carregando produtos…</span> : (productsQuery.data ?? []).length === 0 ? <span>Nenhum produto disponível.</span> : (
              <div>{(productsQuery.data ?? []).map(product => <label key={product.id}>
                <input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                <span>{product.name}</span>
              </label>)}</div>
            )}
          </div>
        ) : null}

        <div className="admin-audience__consent-note">
          Somente endereços presentes na lista de inscrição e não descadastrados podem receber marketing. Clientes sem opt-in ficam fora do disparo.
        </div>
        <div className="admin-audience__send-row">
          <div className="admin-audience__recipient-count" aria-live="polite">
            <span>Destinatários com consentimento ativo</span>
            <strong>{previewQuery.isLoading ? "…" : previewQuery.data?.count ?? 0}</strong>
          </div>
          <button className="admin-audience__button admin-audience__button--primary" type="button" disabled={!canSend} onClick={() => void sendCampaign()}>
            <Send size={16} aria-hidden="true" /> {sendMutation.isPending ? "Enviando…" : "Revisar e disparar"}
          </button>
        </div>
      </AdminSurface>
    </div>
  );
}
