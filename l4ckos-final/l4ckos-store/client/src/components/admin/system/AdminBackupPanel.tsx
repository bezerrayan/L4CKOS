import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { describeBackupFile } from "../../../../../shared/backupFilePresentation";
import "./AdminBackupPanel.css";

type Props = {
  files: string[];
  isLoading: boolean;
  isError: boolean;
  isCreating: boolean;
  onRefresh: () => void;
  onCreateBackup?: () => void;
};

export function AdminBackupPanel({ files, isLoading, isError, isCreating, onRefresh, onCreateBackup }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canCreate = Boolean(onCreateBackup);

  useEffect(() => {
    if (!confirmOpen) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = document.querySelector<HTMLButtonElement>(".admin-backup-dialog-confirm");
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener("keydown", handleKeyDown); };
  }, [confirmOpen]);

  const create = () => {
    setConfirmOpen(false);
    triggerRef.current?.focus();
    onCreateBackup?.();
  };

  return <div className="admin-backup-panel">
    <section className="admin-backup-section" aria-labelledby="admin-backup-storage-title">
      <div className="admin-backup-section-heading">
        <div><h3 id="admin-backup-storage-title">Armazenamento e rotina</h3><p>O painel lista somente nomes JSON retornados pelo servidor. Tamanho e execução não são informados pela API.</p></div>
      </div>
      <div className="admin-backup-facts">
        <div><span>Destino</span><strong>Diretório local configurado no servidor</strong></div>
        <div><span>Durabilidade externa</span><strong>Não verificada</strong></div>
        <div><span>Integridade do arquivo</span><strong>Não verificada pela listagem</strong></div>
        <div><span>Restauração no painel hospedado</span><strong>Indisponível</strong></div>
      </div>
      <p className="admin-backup-note">O código agenda uma tentativa ao iniciar o processo e depois a cada 24 horas. Isso não confirma execução neste ambiente nem retenção de arquivos.</p>
    </section>

    <section className="admin-backup-section" aria-labelledby="admin-backup-files-title">
      <div className="admin-backup-section-heading admin-backup-files-heading">
        <div><h3 id="admin-backup-files-title">Arquivos disponíveis</h3><p>Arquivos listados no diretório configurado. Não é possível baixar ou restaurar por esta tela.</p></div>
        <button type="button" className="admin-backup-secondary-button" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw size={15} aria-hidden="true" />{isLoading ? "Atualizando…" : "Atualizar lista"}
        </button>
      </div>
      {isLoading ? <div className="admin-backup-state" role="status">Carregando arquivos…</div> : null}
      {!isLoading && isError ? <div className="admin-backup-state is-error" role="alert"><p>Não foi possível consultar a lista de backups.</p><button type="button" className="admin-backup-secondary-button" onClick={onRefresh}>Tentar novamente</button></div> : null}
      {!isLoading && !isError && files.length === 0 ? <div className="admin-backup-state"><strong>Nenhum arquivo listado</strong><p>Isso indica apenas que a consulta não encontrou arquivos no diretório configurado.</p></div> : null}
      {!isLoading && !isError && files.length > 0 ? <div className="admin-backup-file-list">
        {files.map(file => {
          const entry = describeBackupFile(file);
          const typeLabel = entry.type === "manual" ? "Manual" : entry.type === "automatic" ? "Automático · origem pelo nome" : "Tipo não identificado";
          return <article className="admin-backup-file-row" key={file}>
            <div className="admin-backup-file-main"><strong title={entry.fileName}>{entry.fileName}</strong><span>{typeLabel} · JSON</span></div>
            <div className="admin-backup-file-meta"><span><small>Criação</small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "Não identificada"}</span><span><small>Tamanho</small>Não informado</span><span className="admin-backup-integrity"><small>Integridade</small>Não verificada</span></div>
          </article>;
        })}
      </div> : null}
    </section>

    <section className="admin-backup-actions" aria-labelledby="admin-backup-actions-title">
      <div className="admin-backup-action-block">
        <div><h3 id="admin-backup-actions-title">Criar cópia manual</h3><p>Gera um snapshot lógico JSON no diretório configurado. O arquivo contém dados sensíveis e é gravado sem criptografia, com permissões restritas no servidor.</p></div>
        <button ref={triggerRef} type="button" className="admin-backup-primary-button" onClick={() => setConfirmOpen(true)} disabled={!canCreate || isCreating} aria-describedby="admin-backup-create-hint">
          {!canCreate ? "Ação desativada" : isCreating ? "Criando cópia…" : "Criar cópia manual"}
        </button>
      </div>
      <p className="admin-backup-note" id="admin-backup-create-hint">Sucesso significa que o servidor concluiu a gravação local. Não comprova cópia externa, durabilidade após substituição do container ou restauração testada.</p>
      <div className="admin-backup-action-block is-disabled">
        <div><h3>Restauração</h3><p>A restauração não está disponível nesta gestão hospedada. O servidor mantém o destino restrito a um banco local de teste, não produtivo e vazio.</p></div>
        <span className="admin-backup-disabled-label">Indisponível aqui</span>
      </div>
    </section>

    <section className="admin-backup-safety" aria-label="Limitações de segurança">
      <ShieldAlert size={18} aria-hidden="true" />
      <p>Os snapshots podem conter dados pessoais, financeiros e hashes de autenticação. A listagem não lê o conteúdo dos arquivos. Armazenamento durável, criptografia em repouso, retenção e recuperação comprovada permanecem não verificados.</p>
    </section>

    {confirmOpen ? <div className="admin-backup-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setConfirmOpen(false); triggerRef.current?.focus(); } }}>
      <section className="admin-backup-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-backup-dialog-title" aria-describedby="admin-backup-dialog-description">
        <AlertTriangle size={21} aria-hidden="true" />
        <h3 id="admin-backup-dialog-title">Criar cópia local?</h3>
        <p id="admin-backup-dialog-description">O servidor gravará um snapshot JSON com dados sensíveis, sem criptografia, no diretório configurado. A operação não comprova armazenamento durável nem restauração.</p>
        <div><button ref={cancelRef} type="button" className="admin-backup-secondary-button" onClick={() => { setConfirmOpen(false); triggerRef.current?.focus(); }}>Cancelar</button><button type="button" className="admin-backup-primary-button admin-backup-dialog-confirm" onClick={create}>Confirmar criação</button></div>
      </section>
    </div> : null}
  </div>;
}
