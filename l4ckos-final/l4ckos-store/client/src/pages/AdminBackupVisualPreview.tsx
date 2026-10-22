import { useEffect, useRef, useState } from "react";
import { Menu, ShieldAlert, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminBackupPanel } from "../components/admin/system/AdminBackupPanel";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminBackupVisualPreview.css";

const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

export default function AdminBackupVisualPreview() {
  const mobile = useIsMobile(900);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("button:not(.orders-menu-close)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = [...menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')].filter(item => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  const closeMenu = () => { setMenuOpen(false); menuTriggerRef.current?.focus(); };

  return <div className="l4-orders-preview l4-backup-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={closeMenu} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="backup-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
      <button type="button" className="orders-menu-close" onClick={closeMenu}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <section className="orders-nav-group" key={group.group} aria-label={group.group}><h2>{group.group}</h2>{group.items.map(item => <button key={item} type="button" aria-current={item === "Backup" ? "page" : undefined} className={item === "Backup" ? "" : "orders-nav-inactive"} onClick={() => { if (item === "Backup" && mobile) closeMenu(); }}>{item}</button>)}</section>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>

    <main className="orders-main-column">
      <div className="orders-preview-banner"><span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Fixtures fictícias</span><span className="orders-preview-fake-label">Nenhuma operação será executada</span></div>
      {mobile ? <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="backup-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
      <header className="orders-preview-heading backup-heading"><div><p className="orders-preview-eyebrow">SISTEMA · PROTEÇÃO DE DADOS</p><h1>Backup</h1><p>Consulte os recursos existentes e seus limites operacionais.</p></div></header>

      <section className="backup-overview" aria-labelledby="backup-overview-title">
        <div className="backup-section-title"><div><h2 id="backup-overview-title">Capacidades identificadas no código</h2><p>A existência da rotina não comprova execução operacional nem armazenamento durável.</p></div></div>
        <div className="backup-routines">
          <article className="backup-routine">
            <div className="backup-routine-heading"><div><span className="backup-kicker">AUTOMÁTICO</span><h3>Rotina diária</h3></div><span className="backup-state">Agendamento no servidor</span></div>
            <p>O servidor tenta executar ao iniciar e depois a cada 24 horas. A prévia não consulta o runtime nem confirma execuções.</p>
            <dl><div><dt>Arquivo</dt><dd>Snapshot lógico das tabelas mapeadas, em JSON</dd></div><div><dt>Destino configurado</dt><dd><code>BACKUP_DIR</code> ou <code>backups</code></dd></div></dl>
          </article>
          <article className="backup-routine">
            <div className="backup-routine-heading"><div><span className="backup-kicker">MANUAL</span><h3>Gerar backup</h3></div><span className="backup-state">Disponível na gestão real</span></div>
            <p>O endpoint administrativo grava um snapshot no diretório configurado, em JSON sem criptografia e com permissões restritas.</p>
            <button type="button" className="backup-action-button" disabled aria-describedby="backup-preview-disabled">Gerar backup <span>Desativado nesta prévia</span></button>
          </article>
        </div>
        <p className="backup-preview-disabled" id="backup-preview-disabled">A prévia não acessa banco de dados, diretórios ou serviços de armazenamento.</p>
      </section>

      <AdminBackupPanel
        files={["backup-2026-10-20T12-30-00-000Z.json", "auto-backup-2026-10-20T00-00-00-000Z.json"]}
        isLoading={false}
        isError={false}
        isCreating={false}
        onRefresh={() => {}}
      />

      <section className="backup-operations" aria-labelledby="backup-operations-title">
        <div className="backup-section-title"><div><h2 id="backup-operations-title">Restauração e acesso</h2><p>Operações reais permanecem desativadas nesta prévia.</p></div></div>
        <div className="backup-operation-row"><div><h3>Restaurar backup</h3><p>O fluxo existente exige ambiente não produtivo, banco local isolado e vazio. Não há restauração pela prévia.</p></div><button type="button" className="backup-action-button is-danger" disabled>Restaurar <span>Indisponível</span></button></div>
        <div className="backup-operation-row"><div><h3>Baixar arquivo</h3><p>A interface atual não oferece uma ação administrativa de download.</p></div><span className="backup-neutral-label">Não disponível</span></div>
      </section>

      <section className="backup-safety" aria-labelledby="backup-safety-title">
        <div className="backup-safety-icon"><ShieldAlert size={19} aria-hidden="true" /></div>
        <div><h2 id="backup-safety-title">Proteção e limites</h2><p>Os snapshots contêm registros pessoais, financeiros e de autenticação. A rotina do painel grava JSON sem criptografia; diretório e arquivo são criados com permissões restritas. Arquivos enviados fora do banco não fazem parte desse snapshot lógico.</p><ul><li>O artefato cobre as tabelas mapeadas e contém somas de verificação estrutural e de conteúdo.</li><li>Os endpoints administrativos exigem perfil de administrador. A aplicação não apresenta política de retenção nem comprovação periódica de restauração.</li><li>A restauração valida o artefato, mas só aceita um destino local isolado e vazio; isso não equivale a um teste de restauração registrado.</li></ul></div>
      </section>

      <p className="backup-footnote">Prévia somente para avaliação visual. Nenhum backup real foi consultado, criado, baixado ou restaurado.</p>
    </main>
  </div>;
}
