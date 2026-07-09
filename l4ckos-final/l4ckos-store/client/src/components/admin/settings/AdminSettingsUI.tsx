import type { CSSProperties } from "react";
import { contactChannels, siteMode } from "../../../config/site";
import { AdminStatusBadge, AdminSummaryPill, AdminSurface } from "../AdminUI";
import { AdminCriticalAlert } from "../system/AdminSystemUI";

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

type AdminSettingsUIProps = {
  onSelectSection: (section: SettingsShortcutTarget) => void;
  runtimeStatus?: AdminSettingsRuntimeStatus;
  runtimeStatusLoading?: boolean;
};

const publicRows = [
  { label: "Nome da loja", value: "L4CKOS", meta: "Definido no código" },
  { label: "E-mail público", value: contactChannels.email || "Não configurado no painel", meta: "Fonte: site.ts" },
  { label: "Instagram", value: contactChannels.instagramUrl || "Não configurado no painel", meta: "Fonte: site.ts" },
  {
    label: "WhatsApp",
    value: contactChannels.whatsappNumber || "Não configurado no painel",
    meta: contactChannels.whatsappNumber ? "Fonte: site.ts" : "Oculto enquanto vazio",
  },
  { label: "Tempo de resposta", value: contactChannels.responseTime || "Definido no código", meta: "Fonte: site.ts" },
  {
    label: "Modo do site",
    value: siteMode === "coming-soon" ? "Coming soon" : "Loja aberta",
    meta: "Definido por ambiente/build do frontend",
  },
];

const operationalShortcuts: Array<{
  title: string;
  description: string;
  section: SettingsShortcutTarget;
  status: string;
}> = [
  {
    title: "Produtos",
    description: "Controla catálogo, estoque, imagens, variantes e publicação dos itens.",
    section: "products",
    status: "Editavel hoje",
  },
  {
    title: "Promoções/Banners",
    description: "Controla campanhas visuais exibidas na loja e ordem dos banners.",
    section: "promos",
    status: "Editavel hoje",
  },
  {
    title: "Cupons",
    description: "Controla descontos, limites de uso e validade das campanhas comerciais.",
    section: "coupons",
    status: "Editavel hoje",
  },
  {
    title: "Pedidos",
    description: "Centraliza status, rastreio e acompanhamento operacional dos pedidos.",
    section: "orders",
    status: "Operacional",
  },
  {
    title: "Clientes",
    description: "Controla roles, VIP, bloqueios e sinais administrativos dos usuários.",
    section: "customers",
    status: "Operacional",
  },
  {
    title: "Relatórios",
    description: "Exporta dados de vendas já disponíveis para análise interna.",
    section: "reports",
    status: "Operacional",
  },
  {
    title: "Auditoria",
    description: "Exibe registros administrativos para rastreabilidade e conferência.",
    section: "audit",
    status: "Leitura",
  },
  {
    title: "Backup",
    description: "Permite backup manual e restauração usando o fluxo existente.",
    section: "backup",
    status: "Critico",
  },
];

const integrations = [
  {
    key: "asaas" as const,
    title: "Asaas",
    description: "Pagamentos e webhooks são gerenciados por variáveis de ambiente no backend.",
    status: "Status não verificável no frontend",
  },
  {
    key: "melhorEnvio" as const,
    title: "Melhor Envio",
    description: "Frete depende de token, URL de API e CEP de origem configurados no ambiente.",
    status: "Gerenciado por ambiente",
  },
  {
    key: "resend" as const,
    title: "Resend",
    description: "Envio de e-mails usa provider e remetentes definidos no ambiente do servidor.",
    status: "Gerenciado por ambiente",
  },
  {
    key: "googleOAuth" as const,
    title: "Google OAuth",
    description: "Login social depende de client ID, secret e redirect URI no ambiente.",
    status: "Gerenciado por ambiente",
  },
  {
    key: "database" as const,
    title: "Banco de dados",
    description: "Conexão e credenciais ficam no ambiente do servidor.",
    status: "Não editável pelo admin",
  },
  {
    key: "frontend" as const,
    title: "Domínio e URLs",
    description: "Frontend/backend usam configurações de ambiente e deploy.",
    status: "Não editável pelo admin",
  },
];

const hardcodedAreas = [
  "Contatos públicos centralizados em site.ts",
  "Footer e links institucionais",
  "Textos institucionais e políticas",
  "Textos da home e chamadas comerciais",
  "Favicon e theme-color",
  "Logo e assets principais da marca",
];

const roadmap = [
  "Criar tabela store_settings",
  "Criar endpoints admin.settings.get/update",
  "Criar endpoint público public.settings.get",
  "Adicionar fallback local para a loja pública",
  "Registrar alterações no audit log",
  "Validar URLs, e-mails, telefones e textos",
  "Migrar primeiro contatos, redes e textos curtos",
];

function getRuntimeStatusLabel(status: RuntimeIntegrationStatus["status"]) {
  switch (status) {
    case "configured":
      return "Configurado via ambiente";
    case "partial":
      return "Configuração parcial";
    case "missing":
      return "Pendente no ambiente";
    default:
      return "Gerenciado por ambiente";
  }
}

function getRuntimeStatusTone(status: RuntimeIntegrationStatus["status"]) {
  if (status === "configured") return badgeTones.success;
  if (status === "partial" || status === "environment") return badgeTones.warning;
  return badgeTones.danger;
}

function formatRuntimeMeta(item: RuntimeIntegrationStatus, description: string) {
  return `${description} Sinais seguros configurados: ${item.configuredCount}/${item.expectedCount}. Nenhum valor sensível é exibido.`;
}

export function AdminSettingsUI({ onSelectSection, runtimeStatus, runtimeStatusLoading = false }: AdminSettingsUIProps) {
  return (
    <AdminSurface
      title="Configurações"
      description="Central informativa da loja. Esta fase organiza o que já existe, mostra limites seguros e prepara uma futura área editável sem salvar nenhuma configuração agora."
      aside={
        <>
          <AdminSummaryPill>Modo read-only</AdminSummaryPill>
          <AdminSummaryPill>{runtimeStatusLoading ? "Lendo backend..." : runtimeStatus ? "Status backend ativo" : "Status frontend"}</AdminSummaryPill>
        </>
      }
    >
      <div style={styles.alertGrid}>
        <AdminCriticalAlert
          tone="info"
          title="Esta aba não salva configurações"
          description="Os cards abaixo usam apenas informações públicas seguras, sinais mascarados do backend e atalhos para áreas já existentes do admin."
        />
        <AdminCriticalAlert
          tone="warning"
          title="Secrets continuam fora do painel"
          description="Tokens, chaves de API, credenciais e webhooks críticos devem permanecer no ambiente/infraestrutura."
        />
      </div>

      <section style={styles.sectionBlock}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.sectionTitle}>Visão geral da loja</h3>
            <p style={styles.sectionDescription}>Dados públicos seguros identificados no frontend atual.</p>
          </div>
          <AdminStatusBadge style={badgeTones.neutral}>Fonte pública</AdminStatusBadge>
        </div>
        <div style={styles.infoGrid}>
          {publicRows.map(row => (
            <div key={row.label} style={styles.infoCard}>
              <span style={styles.cardLabel}>{row.label}</span>
              <strong style={styles.cardValue}>{row.value}</strong>
              <span style={styles.cardMeta}>{row.meta}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.sectionBlock}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.sectionTitle}>Configurações operacionais existentes</h3>
            <p style={styles.sectionDescription}>Atalhos para áreas que já controlam partes reais da operação.</p>
          </div>
          <AdminStatusBadge style={badgeTones.success}>Fluxos existentes</AdminStatusBadge>
        </div>
        <div style={styles.shortcutGrid}>
          {operationalShortcuts.map(item => (
            <button key={item.section} type="button" style={styles.shortcutCard} onClick={() => onSelectSection(item.section)}>
              <span style={styles.shortcutTop}>
                <strong style={styles.shortcutTitle}>{item.title}</strong>
                <AdminStatusBadge style={item.status === "Critico" ? badgeTones.warning : badgeTones.success}>{item.status}</AdminStatusBadge>
              </span>
              <span style={styles.shortcutDescription}>{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.sectionBlock}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.sectionTitle}>Integracoes</h3>
            <p style={styles.sectionDescription}>Status seguro sem expor variáveis, tokens ou URLs sensíveis.</p>
          </div>
          <AdminStatusBadge style={badgeTones.warning}>Não editável</AdminStatusBadge>
        </div>
        <div style={styles.infoGrid}>
          {integrations.map(item => (
            (() => {
              const runtime = runtimeStatus?.integrations[item.key];
              return (
                <div key={item.title} style={styles.integrationCard}>
                  <span style={styles.cardLabel}>{item.title}</span>
                  <strong style={styles.integrationStatus}>
                    {runtimeStatusLoading ? "Verificando status seguro..." : runtime ? getRuntimeStatusLabel(runtime.status) : item.status}
                  </strong>
                  <span style={styles.cardMeta}>{runtime ? formatRuntimeMeta(runtime, item.description) : item.description}</span>
                  {runtime ? <AdminStatusBadge style={getRuntimeStatusTone(runtime.status)}>{runtime.status}</AdminStatusBadge> : null}
                </div>
              );
            })()
          ))}
        </div>
      </section>

      {runtimeStatus ? (
        <section style={styles.sectionBlock}>
          <div style={styles.sectionHeader}>
            <div>
              <h3 style={styles.sectionTitle}>Leitura segura do backend</h3>
              <p style={styles.sectionDescription}>Resumo operacional calculado no servidor sem retornar valores de variáveis de ambiente.</p>
            </div>
            <AdminStatusBadge style={runtimeStatus.security.secretsExposed ? badgeTones.danger : badgeTones.success}>
              Secrets expostos: {runtimeStatus.security.secretsExposed ? "sim" : "não"}
            </AdminStatusBadge>
          </div>
          <div style={styles.infoGrid}>
            <div style={styles.infoCard}>
              <span style={styles.cardLabel}>Ambiente</span>
              <strong style={styles.cardValue}>{runtimeStatus.environment.nodeEnv}</strong>
              <span style={styles.cardMeta}>Valor classificado, sem detalhes de infraestrutura.</span>
            </div>
            <div style={styles.infoCard}>
              <span style={styles.cardLabel}>Banco</span>
              <strong style={styles.cardValue}>{runtimeStatus.environment.databaseConfigured ? "Configurado" : "Pendente"}</strong>
              <span style={styles.cardMeta}>Apenas presença de configuração, sem connection string.</span>
            </div>
            <div style={styles.infoCard}>
              <span style={styles.cardLabel}>Frontend URL</span>
              <strong style={styles.cardValue}>{runtimeStatus.environment.frontendUrlConfigured ? "Configurado" : "Fallback do sistema"}</strong>
              <span style={styles.cardMeta}>Nenhuma URL sensível é exibida.</span>
            </div>
          </div>
        </section>
      ) : null}

      <div style={styles.twoColumnGrid}>
        <section style={styles.sectionBlock}>
          <div style={styles.sectionHeader}>
            <div>
              <h3 style={styles.sectionTitle}>Conteúdos ainda no código</h3>
              <p style={styles.sectionDescription}>Áreas que ainda não são editáveis pelo admin.</p>
            </div>
          </div>
          <ul style={styles.list}>
            {hardcodedAreas.map(item => (
              <li key={item} style={styles.listItem}>{item}</li>
            ))}
          </ul>
        </section>

        <section style={styles.sectionBlock}>
          <div style={styles.sectionHeader}>
            <div>
              <h3 style={styles.sectionTitle}>Futura versão editável</h3>
              <p style={styles.sectionDescription}>Próximos passos técnicos recomendados.</p>
            </div>
          </div>
          <ol style={styles.list}>
            {roadmap.map(item => (
              <li key={item} style={styles.listItem}>{item}</li>
            ))}
          </ol>
        </section>
      </div>

      <section style={styles.sectionBlock}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.sectionTitle}>Alertas de segurança</h3>
            <p style={styles.sectionDescription}>Cuidados obrigatórios antes de transformar esta tela em configuração persistente.</p>
          </div>
        </div>
        <div style={styles.alertGrid}>
          <AdminCriticalAlert
            tone="danger"
            title="Credenciais não devem ser editáveis"
            description="Chaves de pagamento, e-mail, OAuth, banco e webhook precisam continuar em ambiente seguro."
          />
          <AdminCriticalAlert
            tone="warning"
            title="Configurações públicas precisam de fallback"
            description="A loja pública não pode quebrar se a API de settings falhar ou se uma configuração estiver incompleta."
          />
          <AdminCriticalAlert
            tone="warning"
            title="Modo manutenção exige cuidado"
            description="Coming soon/manutenção deve preservar acesso administrativo e passar por validação antes de produção."
          />
        </div>
      </section>
    </AdminSurface>
  );
}

const badgeTones: Record<string, CSSProperties> = {
  neutral: {
    background: "rgba(148,163,184,0.09)",
    border: "1px solid rgba(148,163,184,0.18)",
    color: "#cbd5e1",
  },
  success: {
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#86efac",
  },
  warning: {
    background: "rgba(245,158,11,0.13)",
    border: "1px solid rgba(245,158,11,0.30)",
    color: "#fbbf24",
  },
  danger: {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.32)",
    color: "#fca5a5",
  },
};

const styles: Record<string, CSSProperties> = {
  alertGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  },
  sectionBlock: {
    display: "grid",
    gap: 14,
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.006)), #090909",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1.25,
  },
  sectionDescription: {
    margin: "6px 0 0",
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 720,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 12,
  },
  infoCard: {
    display: "grid",
    gap: 8,
    minHeight: 132,
    padding: "16px 15px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0.008)), #0d0d0d",
  },
  integrationCard: {
    display: "grid",
    gap: 8,
    minHeight: 144,
    padding: "16px 15px",
    borderRadius: 14,
    border: "1px solid rgba(245,158,11,0.18)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.055), rgba(255,255,255,0.008)), #0d0d0d",
  },
  cardLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  cardValue: {
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1.25,
    overflowWrap: "anywhere",
  },
  integrationStatus: {
    color: "#f8f4ec",
    fontSize: 15,
    lineHeight: 1.35,
  },
  cardMeta: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.55,
  },
  shortcutGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: 12,
  },
  shortcutCard: {
    display: "grid",
    gap: 12,
    textAlign: "left",
    minHeight: 132,
    padding: "16px 15px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.085)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008)), #101010",
    color: "#f8f4ec",
    cursor: "pointer",
  },
  shortcutTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  shortcutTitle: {
    fontSize: 16,
    lineHeight: 1.25,
  },
  shortcutDescription: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.55,
  },
  twoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
  },
  list: {
    margin: 0,
    paddingLeft: 20,
    display: "grid",
    gap: 10,
    color: "#d1d5db",
  },
  listItem: {
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 1.55,
  },
};
