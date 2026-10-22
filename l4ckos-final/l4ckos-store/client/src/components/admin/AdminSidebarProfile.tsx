type AdminSidebarProfileProps = {
  name?: string;
  email?: string;
  roleLabel?: string;
  onProfile?: () => void;
  onLogout?: () => void;
  preview?: boolean;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : parts[0]?.slice(0, 2) ?? "AD").toLocaleUpperCase("pt-BR");
}

export function AdminSidebarProfile({ name, email, roleLabel = "Administrador", onProfile, onLogout, preview = false }: AdminSidebarProfileProps) {
  const displayName = name?.trim() || "Conta administrativa";
  return <section className="l4-admin-profile" aria-label="Perfil do administrador">
    <div className="l4-admin-profile-identity">
      <span className="l4-admin-profile-avatar" aria-hidden="true">{getInitials(displayName)}</span>
      <div className="l4-admin-profile-copy">
        <strong title={displayName}>{displayName}</strong>
        <span>{roleLabel}</span>
        <small title={email || "Conta administrativa"}>{email || "Conta administrativa"}</small>
      </div>
    </div>
    <div className="l4-admin-profile-actions" role="group" aria-label="Ações da conta">
      <button type="button" onClick={onProfile} disabled={!onProfile} title={preview ? "Somente visualização nesta prévia" : undefined}>Minha conta</button>
      <button type="button" onClick={onLogout} disabled={!onLogout} title={preview ? "Somente visualização nesta prévia" : undefined}>Sair</button>
    </div>
    {preview ? <small className="l4-admin-profile-preview-note">Perfil fictício · prévia local</small> : null}
  </section>;
}
