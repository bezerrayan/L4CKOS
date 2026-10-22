import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { contactChannels, siteMode } from "../../../config/site";

type SettingsShortcutTarget =
  | "customers"
  | "products"
  | "promos"
  | "orders"
  | "coupons"
  | "reports"
  | "audit"
  | "backup";

type RuntimeIntegrationStatus = {
  status: "configured" | "partial" | "missing" | "environment";
  configuredCount: number;
  expectedCount: number;
};

type AdminSettingsRuntimeStatus = {
  mode: "read-only";
  generatedAt: string;
  environment: {
    nodeEnv: string;
    frontendUrlConfigured: boolean;
    databaseConfigured: boolean;
  };
  integrations: {
    asaas: RuntimeIntegrationStatus;
    melhorEnvio: RuntimeIntegrationStatus;
    resend: RuntimeIntegrationStatus;
    googleOAuth: RuntimeIntegrationStatus;
    database: RuntimeIntegrationStatus;
    frontend: RuntimeIntegrationStatus;
  };
  security: {
    secretsExposed: boolean;
    editable: boolean;
    source: string;
  };
};

type SettingsTab = "overview" | "integrations" | "environment" | "outside";

type AdminSettingsUIProps = {
  onSelectSection: (section: SettingsShortcutTarget) => void;
  initialTab?: SettingsTab;
  runtimeStatus?: AdminSettingsRuntimeStatus;
  runtimeStatusLoading?: boolean;
  runtimeStatusError?: boolean;
  onRetryRuntimeStatus?: () => void;
};

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "integrations", label: "Integrações" },
  { id: "environment", label: "Ambiente e segurança" },
  { id: "outside", label: "Fora do painel" },
];

const publicRows = [
  { label: "Nome da loja", value: "L4CKOS", source: "Identificação pública do frontend" },
  { label: "E-mail público", value: contactChannels.email || "Não configurado", source: "Configuração pública do site" },
  { label: "Instagram", value: contactChannels.instagramUrl || "Não configurado", source: "Configuração pública do site" },
  { label: "WhatsApp", value: contactChannels.whatsappNumber || "Não configurado", source: "Configuração pública do site" },
  { label: "Tempo de resposta", value: contactChannels.responseTime || "Não informado", source: "Conteúdo público do site" },
  {
    label: "Modo visual do frontend",
    value: siteMode === "coming-soon" ? "Coming soon" : "Loja aberta",
    source: "Definido no ambiente/build do frontend; não confirma a proteção comercial do servidor",
  },
];

const integrationRows: Array<{
  key: keyof AdminSettingsRuntimeStatus["integrations"];
  title: string;
  purpose: string;
}> = [
  { key: "asaas", title: "Asaas", purpose: "Pagamentos e notificações do provedor" },
  { key: "melhorEnvio", title: "Melhor Envio", purpose: "Cotação e serviços de frete" },
  { key: "resend", title: "Resend", purpose: "Envio de e-mails" },
  { key: "googleOAuth", title: "Google OAuth", purpose: "Autenticação social" },
  { key: "database", title: "Banco de dados", purpose: "Persistência da aplicação" },
  { key: "frontend", title: "URL do frontend", purpose: "Endereço público configurado para a aplicação" },
];

const outsidePanel = [
  "Contatos públicos, links sociais e textos institucionais são mantidos na configuração do frontend.",
  "Textos editoriais da página inicial, rodapé e políticas não são editáveis por esta área.",
  "Coming soon é definido pelo ambiente/build do frontend. Esta tela não o ativa nem o desativa.",
  "Integrações, banco e credenciais são mantidos no ambiente do servidor; esta tela não altera infraestrutura.",
];

function runtimeLabel(status: RuntimeIntegrationStatus["status"]) {
  switch (status) {
    case "configured": return "Configurado no ambiente";
    case "partial": return "Configuração parcial";
    case "missing": return "Configuração ausente";
    case "environment": return "Definido por ambiente/build";
  }
}

function statusTone(status: RuntimeIntegrationStatus["status"]) {
  return `admin-settings-state--${status}`;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Horário indisponível" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AdminSettingsUI({
  onSelectSection,
  initialTab = "overview",
  runtimeStatus,
  runtimeStatusLoading = false,
  runtimeStatusError = false,
  onRetryRuntimeStatus,
}: AdminSettingsUIProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = tabs.findIndex(tab => tab.id === activeTab);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextIndex = selectedIndex;
    if (event.key === "ArrowRight") nextIndex = (selectedIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (selectedIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const runtimeStateText = runtimeStatusLoading
    ? "Consultando status seguro"
    : runtimeStatusError
      ? "Status indisponível"
      : runtimeStatus
        ? "Dados seguros do backend"
        : "Status não verificado";
  const visibleRuntimeStatus = runtimeStatusError ? undefined : runtimeStatus;

  return (
    <section className="admin-settings" aria-labelledby="admin-settings-title">
      <header className="admin-settings__header">
        <div>
          <span className="admin-settings__eyebrow">SISTEMA · LEITURA</span>
          <h1 id="admin-settings-title">Configurações</h1>
          <p>Consulte informações públicas e sinais seguros do ambiente. Esta área não altera configurações.</p>
        </div>
        <div className="admin-settings__header-state">
          <span className="admin-settings__readonly">Somente leitura</span>
          <span className="admin-settings__query-state" role="status">{runtimeStateText}</span>
        </div>
      </header>

      <div className="admin-settings__notice" role="note">
        <strong>Nenhum controle de edição está disponível nesta área.</strong>
        <span>Configurações de infraestrutura permanecem no ambiente do servidor.</span>
      </div>

      <div className="admin-settings__tabs" role="tablist" aria-label="Seções de configurações" onKeyDown={handleTabKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={node => { tabRefs.current[index] = node; }}
            id={`admin-settings-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="admin-settings-panel"
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="admin-settings__panel"
        id="admin-settings-panel"
        role="tabpanel"
        aria-labelledby={`admin-settings-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "overview" ? (
          <section aria-labelledby="admin-settings-overview-title">
            <div className="admin-settings__section-heading">
              <div><h2 id="admin-settings-overview-title">Informações públicas da loja</h2><p>Valores definidos no frontend e apresentados publicamente.</p></div>
              <span className="admin-settings__source">Configuração do site</span>
            </div>
            <dl className="admin-settings__public-list">
              {publicRows.map(row => (
                <div className="admin-settings__public-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd><strong>{row.value}</strong><span>{row.source}</span></dd>
                </div>
              ))}
            </dl>
            <p className="admin-settings__backend-gate-note" role="note">
              <strong>Proteção comercial do backend</strong>
              <span>Não verificada por esta consulta. O modo visual do frontend não confirma se o servidor está bloqueando novas operações comerciais.</span>
            </p>
          </section>
        ) : null}

        {activeTab === "integrations" ? (
          <section aria-labelledby="admin-settings-integrations-title">
            <div className="admin-settings__section-heading">
              <div><h2 id="admin-settings-integrations-title">Integrações e serviços</h2><p>O backend retorna somente situação e contagem de presença, nunca os valores configurados.</p></div>
              <span className="admin-settings__source">Consulta administrativa segura</span>
            </div>
            {runtimeStatusLoading ? <p className="admin-settings__state-message" role="status">Consultando o status do backend...</p> : null}
            {runtimeStatusError ? (
              <div className="admin-settings__state-message" role="status">
                <span>Não foi possível consultar o status. Nenhuma situação de integração foi presumida.</span>
                {onRetryRuntimeStatus ? <button type="button" onClick={onRetryRuntimeStatus}>Tentar novamente</button> : null}
              </div>
            ) : null}
            {!runtimeStatusLoading && !runtimeStatusError && !visibleRuntimeStatus ? (
              <p className="admin-settings__state-message" role="status">Status não verificado.</p>
            ) : null}
            <div className="admin-settings__integration-list">
              {integrationRows.map((row, index) => {
                const status = visibleRuntimeStatus?.integrations[row.key];
                const countLabel = status ? `${status.configuredCount} de ${status.expectedCount} sinais configurados` : null;
                return (
                  <article className="admin-settings__integration-row" key={row.key}>
                    <span className="admin-settings__index">{String(index + 1).padStart(2, "0")}</span>
                    <div><h3>{row.title}</h3><p>{row.purpose}</p></div>
                    <div className="admin-settings__integration-result">
                      <strong>{runtimeStatusLoading ? "Consultando…" : status ? runtimeLabel(status.status) : "Não verificado"}</strong>
                      {countLabel ? <span>{countLabel}</span> : null}
                      {status ? <span className={`admin-settings__state ${statusTone(status.status)}`}>{status.status}</span> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeTab === "environment" ? (
          <section aria-labelledby="admin-settings-environment-title">
            <div className="admin-settings__section-heading">
              <div><h2 id="admin-settings-environment-title">Ambiente e segurança</h2><p>Resumo do que o endpoint administrativo disponibiliza sem expor configuração sensível.</p></div>
              <span className="admin-settings__source">Somente metadados</span>
            </div>
            {runtimeStatusLoading ? <p className="admin-settings__state-message" role="status">Consultando metadados do ambiente...</p> : null}
            {runtimeStatusError ? <p className="admin-settings__state-message" role="status">Metadados indisponíveis; o estado do ambiente não foi verificado.</p> : null}
            {visibleRuntimeStatus ? (
              <dl className="admin-settings__environment-list">
                <div><dt>Ambiente do servidor</dt><dd>{visibleRuntimeStatus.environment.nodeEnv === "production" ? "Produção" : "Não produção"}</dd></div>
                <div><dt>Banco configurado</dt><dd>{visibleRuntimeStatus.environment.databaseConfigured ? "Sim" : "Não"}</dd></div>
                <div><dt>URL do frontend</dt><dd>{visibleRuntimeStatus.environment.frontendUrlConfigured ? "Configurada" : "Fallback do sistema"}</dd></div>
                <div><dt>Segredos na resposta</dt><dd>{visibleRuntimeStatus.security.secretsExposed ? "Marcados como expostos" : "Não incluídos"}</dd></div>
                <div><dt>Configurações editáveis aqui</dt><dd>{visibleRuntimeStatus.security.editable ? "Indicadas pelo backend" : "Não"}</dd></div>
                <div><dt>Consulta realizada</dt><dd>{formatGeneratedAt(visibleRuntimeStatus.generatedAt)}</dd></div>
              </dl>
            ) : null}
            {visibleRuntimeStatus?.security.secretsExposed ? <p className="admin-settings__security-warning">A resposta do backend informa exposição de segredos. Não exiba nem copie valores por esta interface.</p> : null}
          </section>
        ) : null}

        {activeTab === "outside" ? (
          <section aria-labelledby="admin-settings-outside-title">
            <div className="admin-settings__section-heading">
              <div><h2 id="admin-settings-outside-title">Fora do painel</h2><p>Itens que não são editáveis nem controlados por esta área.</p></div>
              <span className="admin-settings__source">Sem mutações de configuração</span>
            </div>
            <ul className="admin-settings__outside-list">
              {outsidePanel.map(item => <li key={item}>{item}</li>)}
            </ul>
            <div className="admin-settings__outside-note">
              <strong>Áreas operacionais existentes</strong>
              <div>
                <button type="button" onClick={() => onSelectSection("products")}>Produtos</button>
                <button type="button" onClick={() => onSelectSection("promos")}>Destaques da Home</button>
                <button type="button" onClick={() => onSelectSection("orders")}>Pedidos</button>
                <button type="button" onClick={() => onSelectSection("coupons")}>Cupons</button>
              </div>
              <span>Esses atalhos abrem suas áreas próprias; não alteram configurações globais.</span>
            </div>
            <p className="admin-settings__launch-note">A data de lançamento não está definida nesta área. Não existe aqui uma ação para abrir a loja pública.</p>
          </section>
        ) : null}
      </div>
    </section>
  );
}
