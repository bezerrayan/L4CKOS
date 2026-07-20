import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, MapPin, Package, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useToast } from "../contexts/ToastContext";
import { trpc } from "../lib/trpc";
import { getApiErrorDisplay } from "../utils/apiError";
import { useOrders } from "../hooks/useOrders";
import { ReviewPurchaseArea } from "../components/reviews/ReviewPurchaseArea";
import "./Perfil.css";

type SavedAddress = { id: string; label: string; recipient: string; zipCode: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string; isDefault: boolean };
type ProfileSection = "overview" | "addresses" | "personal" | "preferences";

const defaultAddressDraft: Omit<SavedAddress, "id"> = { label: "Casa", recipient: "", zipCode: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", isDefault: false };
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
const friendlyError = (error: unknown, fallback: string) => getApiErrorDisplay(error, fallback).message;

export default function Perfil() {
  const navigate = useNavigate();
  const { user, logout, setUser, isAuthenticated } = useUser();
  const { showToast } = useToast();
  const profileQuery = trpc.profile.get.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: false });
  const saveProfileMutation = trpc.profile.save.useMutation();
  const ordersQuery = useOrders();
  const [activeSection, setActiveSection] = useState<ProfileSection>("overview");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<Omit<SavedAddress, "id">>(defaultAddressDraft);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [preferences, setPreferences] = useState({ promotions: true, orders: true, products: false });

  useEffect(() => { if (user && isAuthenticated) { setProfileName(user.name || ""); setProfileEmail(user.email || ""); } }, [isAuthenticated, user]);
  useEffect(() => {
    if (!profileQuery.data) return;
    setPhone(profileQuery.data.phone ?? "");
    setAddresses((profileQuery.data.addresses ?? []).map(address => ({ id: String(address.id), label: address.label, recipient: address.recipient, zipCode: address.zipCode, street: address.street, number: address.number, complement: address.complement ?? "", neighborhood: address.neighborhood, city: address.city, state: address.state, isDefault: address.isDefault })));
  }, [profileQuery.data]);

  const persistProfileData = async (nextName: string, nextEmail: string, nextPhone: string, nextAddresses: SavedAddress[], persistIdentity = false) => {
    await saveProfileMutation.mutateAsync({
      ...(persistIdentity ? { name: nextName, email: nextEmail } : {}), phone: nextPhone,
      addresses: nextAddresses.map(address => ({ label: address.label, recipient: address.recipient, zipCode: address.zipCode, street: address.street, number: address.number, complement: address.complement || null, neighborhood: address.neighborhood, city: address.city, state: address.state, isDefault: address.isDefault })),
      payments: [],
    });
  };
  const saveWithFeedback = async (work: () => Promise<void>, success: string, fallback: string) => { try { await work(); showToast({ message: success, duration: 2400 }); } catch (error) { showToast({ message: friendlyError(error, fallback), duration: 3000 }); } };
  const handleSaveProfile = async () => {
    const email = profileEmail.trim().toLowerCase();
    if (!profileName.trim() || !email) return void showToast({ message: "Nome e email são obrigatórios", duration: 2800 });
    if (!isValidEmail(email)) return void showToast({ message: "Informe um email válido", duration: 2800 });
    await saveWithFeedback(async () => { await persistProfileData(profileName.trim(), email, phone, addresses, true); setUser({ ...user!, name: profileName.trim(), email }); setIsEditingProfile(false); }, "Perfil atualizado com sucesso", "Não foi possível salvar seu perfil agora.");
  };
  const cancelProfileEdit = () => { setProfileName(user?.name || ""); setProfileEmail(user?.email || ""); setPhone(profileQuery.data?.phone ?? ""); setIsEditingProfile(false); };
  const openAddAddressForm = () => { setEditingAddressId(null); setAddressDraft({ ...defaultAddressDraft, isDefault: addresses.length === 0 }); setIsAddressFormOpen(true); };
  const openEditAddressForm = (address: SavedAddress) => { setEditingAddressId(address.id); setAddressDraft({ label: address.label, recipient: address.recipient, zipCode: address.zipCode, street: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood, city: address.city, state: address.state, isDefault: address.isDefault }); setIsAddressFormOpen(true); };
  const closeAddressForm = () => { setIsAddressFormOpen(false); setEditingAddressId(null); setAddressDraft(defaultAddressDraft); };
  const handleSaveAddress = async () => {
    if (!addressDraft.recipient.trim() || !addressDraft.street.trim() || !addressDraft.number.trim() || !addressDraft.city.trim() || !addressDraft.state.trim() || !addressDraft.zipCode.trim()) return void showToast({ message: "Preencha os campos obrigatórios do endereço", duration: 2800 });
    const next = { ...addressDraft, id: editingAddressId ?? `addr_${Date.now()}` }; const updated = editingAddressId ? addresses.map(item => item.id === editingAddressId ? next : item) : [...addresses, next]; const normalized = next.isDefault ? updated.map(item => ({ ...item, isDefault: item.id === next.id })) : !updated.some(item => item.isDefault) ? updated.map((item, index) => ({ ...item, isDefault: index === 0 })) : updated;
    await saveWithFeedback(async () => { await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized); setAddresses(normalized); closeAddressForm(); }, "Endereço salvo", "Não foi possível salvar o endereço agora.");
  };
  const handleRemoveAddress = (id: string) => void saveWithFeedback(async () => { const filtered = addresses.filter(item => item.id !== id); const normalized = filtered.length && !filtered.some(item => item.isDefault) ? filtered.map((item, index) => ({ ...item, isDefault: index === 0 })) : filtered; await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized); setAddresses(normalized); }, "Endereço removido", "Não foi possível remover o endereço agora.");
  const setDefaultAddress = (id: string) => void saveWithFeedback(async () => { const normalized = addresses.map(item => ({ ...item, isDefault: item.id === id })); await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized); setAddresses(normalized); }, "Endereço principal atualizado", "Não foi possível definir o endereço padrão.");
  const handleLogout = () => { if (window.confirm("Tem certeza que deseja fazer logout?")) { logout(); navigate("/"); } };
  const selectSection = (section: ProfileSection) => { setActiveSection(section); setIsEditingProfile(false); setIsAddressFormOpen(false); };

  if (!user || !isAuthenticated) return <main className="l4-profile-page"><section className="l4-profile-empty"><h1>Acesso negado</h1><p>Você precisa estar logado para acessar esta página.</p><button onClick={() => navigate("/login")}>Ir para login</button></section></main>;
  const primaryAddress = addresses.find(address => address.isDefault) ?? addresses[0];
  const recentOrders = (ordersQuery.data ?? []).filter((order): order is NonNullable<typeof order> => Boolean(order)).slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 2);
  const memberSince = new Date(user.createdAt || Date.now()).toLocaleDateString("pt-BR");

  return <main className="l4-profile-page">
    <header className="l4-profile-header">
      <div className="l4-profile-avatar">{user.avatar ? <img src={user.avatar} alt="" /> : <span>{user.name.charAt(0).toUpperCase()}</span>}</div>
      <div className="l4-profile-identity"><p>Minha conta</p><h1>{user.name}</h1><span>{user.email}</span><small>Membro desde {memberSince}</small></div>
      <button className="l4-profile-primary-action" onClick={() => { selectSection("personal"); setIsEditingProfile(true); }}><Pencil size={15} aria-hidden="true" />Editar perfil</button>
    </header>
    <nav className="l4-profile-nav" aria-label="Navegação da conta">
      <button className={activeSection === "overview" ? "is-active" : ""} onClick={() => selectSection("overview")}>Visão geral</button>
      <Link to="/meus-pedidos">Meus pedidos</Link>
      <button className={activeSection === "addresses" ? "is-active" : ""} onClick={() => selectSection("addresses")}>Endereços</button>
      <button className={activeSection === "personal" ? "is-active" : ""} onClick={() => selectSection("personal")}>Dados pessoais</button>
      <button className={activeSection === "preferences" ? "is-active" : ""} onClick={() => selectSection("preferences")}>Preferências e segurança</button>
    </nav>

    {activeSection === "overview" ? <section className="l4-profile-content" aria-label="Visão geral da conta">
      <div className="l4-profile-section-heading"><div><p>Visão geral</p><h2>O essencial da sua conta</h2></div><Link to="/meus-pedidos" className="l4-profile-text-action">Ver pedidos</Link></div>
      <div className="l4-profile-overview-grid">
        <article className="l4-profile-summary"><Package size={18} aria-hidden="true" /><div><h3>Meus pedidos</h3><p>Acompanhe compras, pagamentos e entregas.</p></div><Link to="/meus-pedidos">Acessar</Link></article>
        <article className="l4-profile-summary"><MapPin size={18} aria-hidden="true" /><div><h3>Endereço principal</h3><p>{primaryAddress ? `${primaryAddress.street}, ${primaryAddress.number} · ${primaryAddress.city}/${primaryAddress.state}` : "Nenhum endereço salvo."}</p></div><button onClick={() => selectSection("addresses")}>{primaryAddress ? "Editar" : "Adicionar"}</button></article>
        <article className="l4-profile-summary"><Package size={18} aria-hidden="true" /><div><h3>Pedidos recentes</h3><p>{recentOrders.length ? `${recentOrders.length} pedido${recentOrders.length > 1 ? "s" : ""} recente${recentOrders.length > 1 ? "s" : ""}.` : "Você ainda não tem pedidos."}</p></div><Link to="/meus-pedidos">Ver histórico</Link></article>
        <article className="l4-profile-summary"><ShieldCheck size={18} aria-hidden="true" /><div><h3>Precisa de ajuda?</h3><p>Fale com o suporte pelos canais oficiais.</p></div><button onClick={() => navigate("/contato")}>Falar com suporte</button></article>
      </div>
      <ReviewPurchaseArea />
      <section className="l4-profile-subsection"><div className="l4-profile-section-heading"><div><h2>Meus pedidos</h2><p>Compras recentes da sua conta.</p></div><Link to="/meus-pedidos" className="l4-profile-text-action">Histórico completo</Link></div>
        {ordersQuery.isLoading ? <p className="l4-profile-empty-line">Carregando pedidos...</p> : recentOrders.length ? <div className="l4-profile-list">{recentOrders.map(order => <article className="l4-profile-list-item" key={order.id}><div><strong>Pedido #{order.id}</strong><p>Status: {String(order.status)} · Total: R$ {(Number(order.totalPrice || 0) / 100).toFixed(2).replace(".", ",")}</p></div><Link className="l4-profile-text-action" to={`/meus-pedidos/${order.id}`}>Ver pedido</Link></article>)}</div> : <div className="l4-profile-empty-line"><p>Quando realizar uma compra, seus pedidos aparecerão aqui.</p><Link className="l4-profile-secondary-action" to="/meus-pedidos">Ver histórico</Link></div>}
      </section>
    </section> : null}

    {activeSection === "personal" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Dados pessoais</p><h2>Seus dados de contato</h2><span>Revise suas informações antes de editar.</span></div>{!isEditingProfile ? <button className="l4-profile-primary-action" onClick={() => setIsEditingProfile(true)}>Editar perfil</button> : null}</div>
      {!isEditingProfile ? <dl className="l4-profile-read-data"><div><dt>Nome</dt><dd>{profileName || "Não informado"}</dd></div><div><dt>E-mail</dt><dd>{profileEmail || "Não informado"}</dd></div><div><dt>Telefone</dt><dd>{phone || "Não informado"}</dd></div></dl> : <div className="l4-profile-form"><label>Nome completo<input value={profileName} onChange={event => setProfileName(event.target.value)} autoComplete="name" /></label><label>E-mail<input type="email" value={profileEmail} onChange={event => setProfileEmail(event.target.value)} autoComplete="email" /></label><label>Telefone <small>opcional</small><input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><div className="l4-profile-form-actions"><button className="l4-profile-primary-action" onClick={() => void handleSaveProfile()} disabled={saveProfileMutation.isPending}>{saveProfileMutation.isPending ? "Salvando..." : "Salvar alterações"}</button><button className="l4-profile-secondary-action" onClick={cancelProfileEdit}>Cancelar</button></div></div>}
    </section> : null}

    {activeSection === "addresses" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Endereços</p><h2>Onde você recebe seus pedidos</h2></div><button className="l4-profile-primary-action" onClick={openAddAddressForm}>Adicionar endereço</button></div>
      {addresses.length ? <div className="l4-profile-list">{addresses.map(address => <article key={address.id} className="l4-profile-list-item"><div><strong>{address.label} {address.isDefault ? <em>Principal</em> : null}</strong><p>{address.recipient} · {address.street}, {address.number}{address.complement ? ` · ${address.complement}` : ""}</p><p>{address.neighborhood} · {address.city}/{address.state} · CEP {address.zipCode}</p></div><div className="l4-profile-inline-actions"><button onClick={() => openEditAddressForm(address)}>Editar</button>{!address.isDefault ? <button onClick={() => setDefaultAddress(address.id)}>Principal</button> : null}<button className="is-danger" onClick={() => handleRemoveAddress(address.id)} aria-label={`Remover endereço ${address.label}`}><Trash2 size={16} /></button></div></article>)}</div> : <div className="l4-profile-empty-line"><p>Você ainda não tem endereços salvos.</p><button className="l4-profile-secondary-action" onClick={openAddAddressForm}>Adicionar endereço</button></div>}
      {isAddressFormOpen ? <AddressForm draft={addressDraft} setDraft={setAddressDraft} editing={Boolean(editingAddressId)} onSave={handleSaveAddress} onCancel={closeAddressForm} saving={saveProfileMutation.isPending} /> : null}
    </section> : null}

    {activeSection === "preferences" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Preferências e segurança</p><h2>Comunicações e acesso</h2></div></div>
      <div className="l4-profile-preferences" aria-live="polite">{([ ["promotions", "E-mails de promoções"], ["orders", "Notificações de pedidos"], ["products", "Notificações de produtos"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={event => { setPreferences(current => ({ ...current, [key]: event.target.checked })); showToast({ message: "Preferência atualizada nesta sessão", duration: 1800 }); }} /></label>)}</div>
      <div className="l4-profile-security"><div><h3>Suporte e segurança</h3><p>Para senha e dados sensíveis, fale pelos canais oficiais.</p></div><button className="l4-profile-secondary-action" onClick={() => navigate("/contato")}>Falar com suporte</button><button className="l4-profile-secondary-action" onClick={handleLogout}>Fazer logout</button></div>
      <div className="l4-profile-close-account"><button type="button" onClick={() => setConfirmCloseOpen(open => !open)} aria-expanded={confirmCloseOpen}>Encerrar conta <ChevronDown size={16} className={confirmCloseOpen ? "is-open" : ""} aria-hidden="true" /></button>{confirmCloseOpen ? <div><p>Esta solicitação será enviada ao suporte para confirmação.</p><button className="l4-profile-danger-action" onClick={() => navigate("/contato")}>Solicitar encerramento da conta</button></div> : null}</div>
    </section> : null}
  </main>;
}

function AddressForm({ draft, setDraft, editing, onSave, onCancel, saving }: { draft: Omit<SavedAddress, "id">; setDraft: React.Dispatch<React.SetStateAction<Omit<SavedAddress, "id">>>; editing: boolean; onSave: () => void; onCancel: () => void; saving: boolean }) {
  return <section className="l4-profile-form l4-profile-inline-form"><h3>{editing ? "Editar endereço" : "Novo endereço"}</h3><label>Apelido<input value={draft.label} onChange={event => setDraft(current => ({ ...current, label: event.target.value }))} /></label><label>Quem recebe<input value={draft.recipient} onChange={event => setDraft(current => ({ ...current, recipient: event.target.value }))} /></label><div className="l4-profile-two-cols"><label>CEP<input inputMode="numeric" value={draft.zipCode} onChange={event => setDraft(current => ({ ...current, zipCode: event.target.value }))} /></label><label>UF<input value={draft.state} onChange={event => setDraft(current => ({ ...current, state: event.target.value }))} /></label></div><div className="l4-profile-two-cols"><label>Rua<input value={draft.street} onChange={event => setDraft(current => ({ ...current, street: event.target.value }))} /></label><label>Número<input value={draft.number} onChange={event => setDraft(current => ({ ...current, number: event.target.value }))} /></label></div><div className="l4-profile-two-cols"><label>Bairro<input value={draft.neighborhood} onChange={event => setDraft(current => ({ ...current, neighborhood: event.target.value }))} /></label><label>Cidade<input value={draft.city} onChange={event => setDraft(current => ({ ...current, city: event.target.value }))} /></label></div><label>Complemento <small>opcional</small><input value={draft.complement} onChange={event => setDraft(current => ({ ...current, complement: event.target.value }))} /></label><label className="l4-profile-check-row"><input type="checkbox" checked={draft.isDefault} onChange={event => setDraft(current => ({ ...current, isDefault: event.target.checked }))} />Definir como endereço principal</label><div className="l4-profile-form-actions"><button className="l4-profile-primary-action" onClick={onSave} disabled={saving}>{saving ? "Salvando..." : "Salvar endereço"}</button><button className="l4-profile-secondary-action" onClick={onCancel}>Cancelar</button></div></section>;
}
