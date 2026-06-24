import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../contexts/UserContext";
import { useToast } from "../contexts/ToastContext";
import type { CSSProperties } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { trpc } from "../lib/trpc";
import { getApiErrorDisplay } from "../utils/apiError";

type SavedAddress = {
  id: string;
  label: string;
  recipient: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
};

type PaymentMethod = {
  id: string;
  label: string;
  holderName: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
};

const defaultAddressDraft: Omit<SavedAddress, "id"> = {
  label: "Casa",
  recipient: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  isDefault: false,
};

const defaultPaymentDraft: Omit<PaymentMethod, "id"> = {
  label: "Cartão principal",
  holderName: "",
  brand: "Visa",
  last4: "",
  expiry: "",
  isDefault: false,
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  return getApiErrorDisplay(error, fallback).message;
}

export default function Perfil() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user, logout, setUser, isAuthenticated } = useUser();
  const { showToast } = useToast();

  const profileQuery = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const saveProfileMutation = trpc.profile.save.useMutation();

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<Omit<SavedAddress, "id">>(defaultAddressDraft);

  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<Omit<PaymentMethod, "id">>(defaultPaymentDraft);

  useEffect(() => {
    if (!user || !isAuthenticated) return;

    setProfileName(user.name || "");
    setProfileEmail(user.email || "");
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!profileQuery.data) return;

    setPhone(profileQuery.data.phone ?? "");
    setAddresses(
      (profileQuery.data.addresses ?? []).map((address) => ({
        id: String(address.id),
        label: address.label,
        recipient: address.recipient,
        zipCode: address.zipCode,
        street: address.street,
        number: address.number,
        complement: address.complement ?? "",
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        isDefault: address.isDefault,
      })),
    );
    setPayments(
      (profileQuery.data.payments ?? []).map((payment) => ({
        id: String(payment.id),
        label: payment.label,
        holderName: payment.holderName,
        brand: payment.brand,
        last4: payment.last4,
        expiry: payment.expiry,
        isDefault: payment.isDefault,
      })),
    );
  }, [profileQuery.data]);

  const persistProfileData = async (
    nextName: string,
    nextEmail: string,
    nextPhone: string,
    nextAddresses: SavedAddress[],
    nextPayments: PaymentMethod[],
    persistIdentity = false,
  ) => {
    const payload: {
      name?: string;
      email?: string;
      phone: string;
      addresses: Array<{
        label: string;
        recipient: string;
        zipCode: string;
        street: string;
        number: string;
        complement: string | null;
        neighborhood: string;
        city: string;
        state: string;
        isDefault: boolean;
      }>;
      payments: Array<{
        label: string;
        holderName: string;
        brand: string;
        last4: string;
        expiry: string;
        isDefault: boolean;
      }>;
    } = {
      phone: nextPhone,
      addresses: nextAddresses.map((address) => ({
        label: address.label,
        recipient: address.recipient,
        zipCode: address.zipCode,
        street: address.street,
        number: address.number,
        complement: address.complement || null,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        isDefault: address.isDefault,
      })),
      payments: nextPayments.map((payment) => ({
        label: payment.label,
        holderName: payment.holderName,
        brand: payment.brand,
        last4: payment.last4,
        expiry: payment.expiry,
        isDefault: payment.isDefault,
      })),
    };

    if (persistIdentity) {
      payload.name = nextName;
      payload.email = nextEmail;
    }

    await saveProfileMutation.mutateAsync(payload);
  };

  if (!user || !isAuthenticated) {
    return (
      <div style={styles.container as CSSProperties}>
        <div style={styles.notLoggedIn as CSSProperties}>
          <h1 style={styles.title as CSSProperties}>Acesso Negado</h1>
          <p style={styles.message as CSSProperties}>
            Você precisa estar logado para acessar esta página
          </p>
          <button
            onClick={() => navigate("/login")}
            style={styles.button as CSSProperties}
          >
            Ir para Login
          </button>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    if (window.confirm("Tem certeza que deseja fazer logout?")) {
      logout();
      navigate("/");
    }
  };

  const handleSaveProfile = async () => {
    const normalizedEmail = profileEmail.trim().toLowerCase();
    if (!profileName.trim() || !normalizedEmail) {
      showToast({ message: "Nome e email são obrigatórios", duration: 2800 });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      showToast({ message: "Informe um email válido", duration: 2800 });
      return;
    }

    try {
      await persistProfileData(profileName.trim(), normalizedEmail, phone, addresses, payments, true);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível salvar seu perfil agora.");
      showToast({ message, duration: 3000 });
      return;
    }

    setUser({
      ...user,
      name: profileName.trim(),
      email: normalizedEmail,
    });

    setIsEditingProfile(false);
    showToast({ message: "Perfil atualizado com sucesso", duration: 2500 });
  };

  const openAddAddressForm = () => {
    setEditingAddressId(null);
    setAddressDraft({ ...defaultAddressDraft, isDefault: addresses.length === 0 });
    setIsAddressFormOpen(true);
  };

  const openEditAddressForm = (address: SavedAddress) => {
    setEditingAddressId(address.id);
    setAddressDraft({
      label: address.label,
      recipient: address.recipient,
      zipCode: address.zipCode,
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      isDefault: address.isDefault,
    });
    setIsAddressFormOpen(true);
  };

  const handleSaveAddress = async () => {
    if (!addressDraft.recipient.trim() || !addressDraft.street.trim() || !addressDraft.number.trim() || !addressDraft.city.trim() || !addressDraft.state.trim() || !addressDraft.zipCode.trim()) {
      showToast({ message: "Preencha os campos obrigatórios do endereço", duration: 2800 });
      return;
    }

    const nextAddress: SavedAddress = {
      ...addressDraft,
      id: editingAddressId ?? `addr_${Date.now()}`,
    };

    const updated = editingAddressId
      ? addresses.map((item) => (item.id === editingAddressId ? nextAddress : item))
      : [...addresses, nextAddress];

    const normalized = nextAddress.isDefault
      ? updated.map((item) => ({ ...item, isDefault: item.id === nextAddress.id }))
      : !updated.some((item) => item.isDefault) && updated.length > 0
        ? updated.map((item, index) => ({ ...item, isDefault: index === 0 }))
        : updated;

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized, payments);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível salvar o endereço agora.");
      showToast({ message, duration: 3000 });
      return;
    }

    setAddresses(normalized);

    setIsAddressFormOpen(false);
    setEditingAddressId(null);
    setAddressDraft(defaultAddressDraft);
    showToast({ message: "Endereço salvo", duration: 2200 });
  };

  const handleRemoveAddress = async (id: string) => {
    const filtered = addresses.filter((item) => item.id !== id);
    const normalized =
      filtered.length > 0 && !filtered.some((item) => item.isDefault)
        ? filtered.map((item, index) => ({ ...item, isDefault: index === 0 }))
        : filtered;

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized, payments);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível remover o endereço agora.");
      showToast({ message, duration: 3000 });
      return;
    }

    setAddresses(normalized);
    showToast({ message: "Endereço removido", duration: 2200 });
  };

  const setDefaultAddress = async (id: string) => {
    const normalized = addresses.map((item) => ({ ...item, isDefault: item.id === id }));

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, normalized, payments);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível definir o endereço padrão.");
      showToast({ message, duration: 3000 });
      return;
    }

    setAddresses(normalized);
  };

  const openAddPaymentForm = () => {
    setEditingPaymentId(null);
    setPaymentDraft({ ...defaultPaymentDraft, isDefault: payments.length === 0 });
    setIsPaymentFormOpen(true);
  };

  const openEditPaymentForm = (payment: PaymentMethod) => {
    setEditingPaymentId(payment.id);
    setPaymentDraft({
      label: payment.label,
      holderName: payment.holderName,
      brand: payment.brand,
      last4: payment.last4,
      expiry: payment.expiry,
      isDefault: payment.isDefault,
    });
    setIsPaymentFormOpen(true);
  };

  const handleSavePayment = async () => {
    if (!paymentDraft.holderName.trim() || !paymentDraft.last4.trim() || !paymentDraft.expiry.trim()) {
      showToast({ message: "Preencha os campos obrigatórios do pagamento", duration: 2800 });
      return;
    }

    if (!/^\d{4}$/.test(paymentDraft.last4.trim())) {
      showToast({ message: "Informe os 4 últimos dígitos do cartão", duration: 2800 });
      return;
    }

    const nextPayment: PaymentMethod = {
      ...paymentDraft,
      last4: paymentDraft.last4.trim(),
      expiry: paymentDraft.expiry.trim(),
      id: editingPaymentId ?? `pay_${Date.now()}`,
    };

    const updated = editingPaymentId
      ? payments.map((item) => (item.id === editingPaymentId ? nextPayment : item))
      : [...payments, nextPayment];

    const normalized = nextPayment.isDefault
      ? updated.map((item) => ({ ...item, isDefault: item.id === nextPayment.id }))
      : !updated.some((item) => item.isDefault) && updated.length > 0
        ? updated.map((item, index) => ({ ...item, isDefault: index === 0 }))
        : updated;

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, addresses, normalized);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível salvar o método de pagamento agora.");
      showToast({ message, duration: 3000 });
      return;
    }

    setPayments(normalized);

    setIsPaymentFormOpen(false);
    setEditingPaymentId(null);
    setPaymentDraft(defaultPaymentDraft);
    showToast({ message: "Método de pagamento salvo", duration: 2200 });
  };

  const handleRemovePayment = async (id: string) => {
    const filtered = payments.filter((item) => item.id !== id);
    const normalized =
      filtered.length > 0 && !filtered.some((item) => item.isDefault)
        ? filtered.map((item, index) => ({ ...item, isDefault: index === 0 }))
        : filtered;

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, addresses, normalized);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível remover o método de pagamento agora.");
      showToast({ message, duration: 3000 });
      return;
    }

    setPayments(normalized);
    showToast({ message: "Método removido", duration: 2200 });
  };

  const setDefaultPayment = async (id: string) => {
    const normalized = payments.map((item) => ({ ...item, isDefault: item.id === id }));

    try {
      await persistProfileData(profileName.trim(), profileEmail.trim(), phone, addresses, normalized);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "Não foi possível definir o método padrão.");
      showToast({ message, duration: 3000 });
      return;
    }

    setPayments(normalized);
  };

  return (
    <div style={{ ...styles.container, padding: isMobile ? "0 4px" : undefined } as CSSProperties}>
      <div
        style={{
          ...styles.profileHeader,
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 16 : styles.profileHeader.gap,
          padding: isMobile ? 18 : styles.profileHeader.padding,
        } as CSSProperties}
      >
        <div style={styles.avatarLarge as CSSProperties}>
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} />
          ) : (
            <span>{user.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div style={styles.profileInfo as CSSProperties}>
          <h1 style={{ ...styles.userName, fontSize: isMobile ? 24 : styles.userName.fontSize } as CSSProperties}>
            Olá, {user.name}!
          </h1>
          <p style={styles.email as CSSProperties}>{user.email}</p>
          <p style={styles.memberDate as CSSProperties}>
            Membro desde {new Date(user.createdAt || Date.now()).toLocaleDateString("pt-BR")}
          </p>
        </div>
      </div>

      <div
        style={{
          ...styles.sectionsGrid,
          gridTemplateColumns: isMobile ? "1fr" : styles.sectionsGrid.gridTemplateColumns,
        } as CSSProperties}
      >
        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Dados Pessoais</h2>
          <div style={styles.inputGroup as CSSProperties}>
            <label style={styles.infoLabel as CSSProperties}>Nome Completo</label>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              disabled={!isEditingProfile}
                style={{
                  ...styles.input,
                  opacity: isEditingProfile ? 1 : 0.85,
                  background: isEditingProfile ? "#0f0f0f" : "#141414",
                } as CSSProperties}
            />
          </div>
          <div style={styles.inputGroup as CSSProperties}>
            <label style={styles.infoLabel as CSSProperties}>Email</label>
            <input
              value={profileEmail}
              onChange={(event) => setProfileEmail(event.target.value)}
              disabled={!isEditingProfile}
                style={{
                  ...styles.input,
                  opacity: isEditingProfile ? 1 : 0.85,
                  background: isEditingProfile ? "#0f0f0f" : "#141414",
                } as CSSProperties}
            />
          </div>
          <div style={styles.inputGroup as CSSProperties}>
            <label style={styles.infoLabel as CSSProperties}>Telefone</label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Opcional"
                style={styles.input as CSSProperties}
              />
          </div>

          {isEditingProfile ? (
            <div style={styles.actionsRow as CSSProperties}>
              <button style={styles.editBtn as CSSProperties} onClick={handleSaveProfile}>
                Salvar
              </button>
              <button
                style={styles.addBtn as CSSProperties}
                onClick={() => {
                  setProfileName(user.name || "");
                  setProfileEmail(user.email || "");
                  setIsEditingProfile(false);
                }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button style={styles.editBtn as CSSProperties} onClick={() => setIsEditingProfile(true)}>
              Editar Perfil
            </button>
          )}
        </div>

        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Endereços salvos</h2>

          {addresses.length === 0 ? (
            <p style={styles.emptyText as CSSProperties}>Você ainda não tem endereços salvos.</p>
          ) : (
            <div style={styles.list as CSSProperties}>
              {addresses.map((address) => (
                <div key={address.id} style={styles.listItem as CSSProperties}>
                  <div style={styles.listItemHeader as CSSProperties}>
                    <strong>{address.label}</strong>
                    {address.isDefault ? <span style={styles.badge as CSSProperties}>Padrão</span> : null}
                  </div>
                  <p style={styles.listItemText as CSSProperties}>
                     {address.recipient} • {address.street}, {address.number}
                  </p>
                  <p style={styles.listItemText as CSSProperties}>
                     {address.neighborhood} - {address.city}/{address.state} • CEP {address.zipCode}
                  </p>
                  {address.complement ? (
                    <p style={styles.listItemText as CSSProperties}>Complemento: {address.complement}</p>
                  ) : null}
                  <div style={styles.inlineActions as CSSProperties}>
                    <button style={styles.inlineBtn as CSSProperties} onClick={() => openEditAddressForm(address)}>
                      Editar
                    </button>
                    {!address.isDefault ? (
                      <button style={styles.inlineBtn as CSSProperties} onClick={() => setDefaultAddress(address.id)}>
                        Tornar padrão
                      </button>
                    ) : null}
                    <button
                      style={styles.inlineBtnDanger as CSSProperties}
                      onClick={() => handleRemoveAddress(address.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button style={styles.addBtn as CSSProperties} onClick={openAddAddressForm}>
            + Adicionar Endereço
          </button>

          {isAddressFormOpen ? (
            <div style={styles.formCard as CSSProperties}>
              <h3 style={styles.formTitle as CSSProperties}>
                {editingAddressId ? "Editar endereço" : "Novo endereço"}
              </h3>
              <input
                placeholder="Apelido do endereço (Casa, Trabalho...)"
                value={addressDraft.label}
                onChange={(event) => setAddressDraft((prev) => ({ ...prev, label: event.target.value }))}
                style={styles.input as CSSProperties}
              />
              <input
                placeholder="Nome completo de quem recebe"
                value={addressDraft.recipient}
                onChange={(event) => setAddressDraft((prev) => ({ ...prev, recipient: event.target.value }))}
                style={styles.input as CSSProperties}
              />
              <div style={styles.twoCols as CSSProperties}>
                <input
                  placeholder="CEP com 8 dígitos"
                  value={addressDraft.zipCode}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, zipCode: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
                <input
                  placeholder="UF"
                  value={addressDraft.state}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, state: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
              </div>
              <div style={styles.twoCols as CSSProperties}>
                <input
                  placeholder="Rua ou avenida"
                  value={addressDraft.street}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, street: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
                <input
                  placeholder="Número"
                  value={addressDraft.number}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, number: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
              </div>
              <div style={styles.twoCols as CSSProperties}>
                <input
                  placeholder="Bairro"
                  value={addressDraft.neighborhood}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, neighborhood: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
                <input
                  placeholder="Cidade"
                  value={addressDraft.city}
                  onChange={(event) => setAddressDraft((prev) => ({ ...prev, city: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
              </div>
                <input
                  placeholder="Complemento (opcional)"
                  value={addressDraft.complement}
                onChange={(event) => setAddressDraft((prev) => ({ ...prev, complement: event.target.value }))}
                style={styles.input as CSSProperties}
              />
              <label style={styles.checkboxRow as CSSProperties}>
                <input
                  type="checkbox"
                  checked={addressDraft.isDefault}
                  onChange={(event) =>
                    setAddressDraft((prev) => ({ ...prev, isDefault: event.target.checked }))
                  }
                />
                Definir como endereço padrão
              </label>
              <div style={styles.actionsRow as CSSProperties}>
                <button style={styles.editBtn as CSSProperties} onClick={handleSaveAddress}>
                  Salvar endereço
                </button>
                <button
                  style={styles.addBtn as CSSProperties}
                  onClick={() => {
                    setIsAddressFormOpen(false);
                    setEditingAddressId(null);
                    setAddressDraft(defaultAddressDraft);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Métodos de pagamento</h2>
          <p style={styles.emptyText as CSSProperties}>
            Para sua segurança, armazenamos apenas dados resumidos de identificação do cartão.
          </p>

          {payments.length === 0 ? (
            <p style={styles.emptyText as CSSProperties}>Você ainda não tem métodos de pagamento salvos.</p>
          ) : (
            <div style={styles.list as CSSProperties}>
              {payments.map((payment) => (
                <div key={payment.id} style={styles.listItem as CSSProperties}>
                  <div style={styles.listItemHeader as CSSProperties}>
                    <strong>{payment.label}</strong>
                    {payment.isDefault ? <span style={styles.badge as CSSProperties}>Padrão</span> : null}
                  </div>
                  <p style={styles.listItemText as CSSProperties}>
                    {payment.brand} •••• {payment.last4}
                  </p>
                  <p style={styles.listItemText as CSSProperties}>
                    {payment.holderName} • Validade {payment.expiry}
                  </p>
                  <div style={styles.inlineActions as CSSProperties}>
                    <button style={styles.inlineBtn as CSSProperties} onClick={() => openEditPaymentForm(payment)}>
                      Editar
                    </button>
                    {!payment.isDefault ? (
                      <button style={styles.inlineBtn as CSSProperties} onClick={() => setDefaultPayment(payment.id)}>
                        Tornar padrão
                      </button>
                    ) : null}
                    <button
                      style={styles.inlineBtnDanger as CSSProperties}
                      onClick={() => handleRemovePayment(payment.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button style={styles.addBtn as CSSProperties} onClick={openAddPaymentForm}>
            + Adicionar cartão
          </button>

          {isPaymentFormOpen ? (
            <div style={styles.formCard as CSSProperties}>
              <h3 style={styles.formTitle as CSSProperties}>
                {editingPaymentId ? "Editar método" : "Novo método"}
              </h3>
              <input
                placeholder="Apelido do cartão (Principal, Reserva...)"
                value={paymentDraft.label}
                onChange={(event) => setPaymentDraft((prev) => ({ ...prev, label: event.target.value }))}
                style={styles.input as CSSProperties}
              />
              <input
                placeholder="Nome impresso no cartão"
                value={paymentDraft.holderName}
                onChange={(event) =>
                  setPaymentDraft((prev) => ({ ...prev, holderName: event.target.value }))
                }
                style={styles.input as CSSProperties}
              />
              <div style={styles.twoCols as CSSProperties}>
                <input
                  placeholder="Bandeira (Visa, Master, Elo...)"
                  value={paymentDraft.brand}
                  onChange={(event) => setPaymentDraft((prev) => ({ ...prev, brand: event.target.value }))}
                  style={styles.input as CSSProperties}
                />
                <input
                  placeholder="Últimos 4 dígitos"
                  maxLength={4}
                  value={paymentDraft.last4}
                  onChange={(event) =>
                    setPaymentDraft((prev) => ({ ...prev, last4: event.target.value.replace(/\D/g, "") }))
                  }
                  style={styles.input as CSSProperties}
                />
              </div>
              <input
                placeholder="Validade (MM/AA)"
                value={paymentDraft.expiry}
                onChange={(event) => setPaymentDraft((prev) => ({ ...prev, expiry: event.target.value }))}
                style={styles.input as CSSProperties}
              />
              <label style={styles.checkboxRow as CSSProperties}>
                <input
                  type="checkbox"
                  checked={paymentDraft.isDefault}
                  onChange={(event) =>
                    setPaymentDraft((prev) => ({ ...prev, isDefault: event.target.checked }))
                  }
                />
                Definir como método padrão
              </label>
              <div style={styles.actionsRow as CSSProperties}>
                <button style={styles.editBtn as CSSProperties} onClick={handleSavePayment}>
                  Salvar método
                </button>
                <button
                  style={styles.addBtn as CSSProperties}
                  onClick={() => {
                    setIsPaymentFormOpen(false);
                    setEditingPaymentId(null);
                    setPaymentDraft(defaultPaymentDraft);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Preferências</h2>
          <div style={styles.preferenceItem as CSSProperties}>
            <input type="checkbox" defaultChecked />
            <label>Receber e-mails de promoções</label>
          </div>
          <div style={styles.preferenceItem as CSSProperties}>
            <input type="checkbox" defaultChecked />
            <label>Notificações de pedidos</label>
          </div>
          <div style={styles.preferenceItem as CSSProperties}>
            <input type="checkbox" />
            <label>Notificações de produtos</label>
          </div>
        </div>

        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Segurança</h2>
          <p style={styles.emptyText as CSSProperties}>
            Para trocar a senha ou atualizar dados sensíveis, fale com o suporte pelos canais oficiais.
          </p>
          <button style={styles.changePasswordBtn as CSSProperties} onClick={() => navigate("/contato")}>
            Falar com o suporte
          </button>
        </div>

        <div style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>Zona de Perigo</h2>
          <button onClick={handleLogout} style={styles.logoutBtnLarge as CSSProperties}>
            Fazer Logout
          </button>
          <button style={styles.deleteBtnLarge as CSSProperties} onClick={() => navigate("/contato")}>
            Solicitar encerramento da conta
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: 1200,
    margin: "0 auto",
    color: "#f0ede8",
  },
  notLoggedIn: {
    textAlign: "center",
    padding: 80,
    background: "#111111",
    borderRadius: 12,
    border: "1px dashed #3a3a3a",
  },
  title: {
    fontSize: 32,
    fontWeight: 900,
    color: "#f0ede8",
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    color: "#a1a1aa",
    marginBottom: 32,
  },
  button: {
    padding: "12px 32px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  profileHeader: {
    display: "flex",
    gap: 40,
    alignItems: "flex-start",
    padding: 40,
    background: "linear-gradient(135deg, #111111 0%, #191919 100%)",
    border: "1px solid #2b2b2b",
    borderRadius: 12,
    marginBottom: 40,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    background: "#222222",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 48,
    fontWeight: 700,
    overflow: "hidden",
    flexShrink: 0,
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 32,
    fontWeight: 900,
    color: "#f0ede8",
    margin: 0,
    marginBottom: 8,
  },
  email: {
    fontSize: 16,
    color: "#a1a1aa",
    margin: 0,
    marginBottom: 4,
  },
  memberDate: {
    fontSize: 14,
    color: "#a1a1aa",
    margin: 0,
  },
  sectionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
    gap: 24,
    marginBottom: 40,
  },
  section: {
    padding: 24,
    background: "#101010",
    border: "1px solid #2b2b2b",
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f0ede8",
    marginBottom: 20,
    margin: 0,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#a1a1aa",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    display: "block",
    marginBottom: 4,
  },
  inputGroup: {
    marginBottom: 12,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    fontSize: 14,
    color: "#f0ede8",
    background: "#0f0f0f",
    outline: "none",
  },
  emptyText: {
    fontSize: 14,
    color: "#a1a1aa",
    margin: 0,
    marginBottom: 16,
  },
  editBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  addBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  actionsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginTop: 12,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 12,
  },
  listItem: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    padding: 12,
    background: "#0f0f0f",
  },
  listItemHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    gap: 8,
  },
  listItemText: {
    margin: "0 0 4px 0",
    color: "#a1a1aa",
    fontSize: 13,
    lineHeight: 1.4,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#86efac",
    background: "#14532d",
    borderRadius: 999,
    padding: "2px 8px",
  },
  inlineActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  inlineBtn: {
    border: "1px solid #2f2f2f",
    background: "#121212",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  inlineBtnDanger: {
    border: "1px solid #7f1d1d",
    background: "#121212",
    color: "#ef4444",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  formCard: {
    marginTop: 12,
    border: "1px dashed #3a3a3a",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  formTitle: {
    margin: 0,
    fontSize: 14,
    color: "#f0ede8",
    fontWeight: 700,
  },
  twoCols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#d4d4d8",
  },
  preferenceItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 12,
    background: "#121212",
    borderRadius: 6,
    marginBottom: 12,
  },
  changePasswordBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 8,
  },
  twoFactorBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  logoutBtnLarge: {
    width: "100%",
    padding: "10px 16px",
    background: "#000000",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 8,
    transition: "all 0.2s ease",
  },
  deleteBtnLarge: {
    width: "100%",
    padding: "10px 16px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
};


