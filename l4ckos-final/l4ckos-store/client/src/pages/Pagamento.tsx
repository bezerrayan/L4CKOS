/**
 * Pagina do checkout - envio e pagamento
 * 
 */

import { Link } from "react-router-dom";
import { useCart } from "../contexts/CartContext";
import { formatPrice } from "../lib/utils";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useCreateAsaasCharge } from "../hooks/useOrders";
import { useUser } from "../contexts/UserContext";
import { trpc } from "../lib/trpc";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import camisaFallback from "../images/camisa.png";
import { getApiErrorDisplay } from "../utils/apiError";

type CheckoutMethod = "PIX" | "BOLETO" | "CARD";

type ChargeResult = {
  method: CheckoutMethod;
  orderId: number;
  paymentId: string;
  invoiceUrl: string | null;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  bankSlipUrl: string | null;
  digitableLine: string | null;
};

type ShippingOption = {
  id: string;
  label: string;
  description: string;
  price: number;
  minDays: number;
  maxDays: number;
};

const checkoutHighlights = [
  "Revise frete, prazo e dados antes de gerar a cobrança.",
  "O pedido segue para separação após confirmação do pagamento.",
  "Se precisar ajustar algo, o suporte atende pelos canais oficiais da loja.",
];

function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string) {
  const digits = sanitizeCep(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function addBusinessDays(startDate: Date, daysToAdd: number) {
  const date = new Date(startDate);
  let addedDays = 0;

  while (addedDays < daysToAdd) {
    date.setDate(date.getDate() + 1);
    const weekDay = date.getDay();
    if (weekDay !== 0 && weekDay !== 6) {
      addedDays += 1;
    }
  }

  return date;
}

function buildShippingOptions(_cep: string, _subtotal: number, _itemCount: number): ShippingOption[] {
  return [
    {
      id: "local-plano-piloto",
      label: "Entrega local - Plano Piloto",
      description: "Agendamento local no Plano Piloto (Brasilia - DF)",
      price: 0,
      minDays: 1,
      maxDays: 2,
    },
  ];
}

function getOrderStatusLabel(status?: string | null) {
  switch (status) {
    case "paid":
      return "Pagamento confirmado";
    case "processing":
      return "Pedido em separação";
    case "shipped":
      return "Pedido enviado";
    case "delivered":
      return "Pedido entregue";
    case "canceled":
      return "Pedido cancelado";
    default:
      return "Aguardando pagamento";
  }
}

export default function Pagamento() {
  const isMobile = useIsMobile();
  const { cart, removeFromCart, updateQuantity, clearCart } = useCart();
  const { user, isAuthenticated } = useUser();
  const createAsaasCharge = useCreateAsaasCharge();
  const clearedOrdersRef = useRef<Set<number>>(new Set());
  const [checkoutMethod, setCheckoutMethod] = useState<CheckoutMethod>("PIX");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressNeighborhood, setAddressNeighborhood] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [cep, setCep] = useState("");
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [selectedShippingId, setSelectedShippingId] = useState<ShippingOption["id"] | null>(null);
  const [shippingError, setShippingError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentData, setPaymentData] = useState<ChargeResult | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const canShowTechnicalShippingError = import.meta.env.DEV || user?.role === "admin";

  const validateCoupon = trpc.orders.validateCoupon.useMutation();
  const paymentOrderQuery = trpc.orders.detail.useQuery(paymentData?.orderId ?? 0, {
    enabled: Boolean(paymentData?.orderId),
    refetchInterval: data => {
      const status = (data as any)?.status;
      if (!status) return 10000;
      return status === "paid" || status === "processing" || status === "shipped" || status === "delivered" ? false : 10000;
    },
  });

  const selectedShipping = useMemo(
    () => shippingOptions.find(option => option.id === selectedShippingId) ?? null,
    [shippingOptions, selectedShippingId],
  );
  const paymentStatus = (paymentOrderQuery.data as any)?.status as string | undefined;
  const isPaymentConfirmed =
    paymentStatus === "paid" || paymentStatus === "processing" || paymentStatus === "shipped" || paymentStatus === "delivered";
  const paymentOrderTotalCents = Number((paymentOrderQuery.data as any)?.totalPrice ?? 0);

  const estimatedDateRange = useMemo(() => {
    if (!selectedShipping) return "";

    const minDate = addBusinessDays(new Date(), selectedShipping.minDays);
    const maxDate = addBusinessDays(new Date(), selectedShipping.maxDays);
    const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

    return `${formatter.format(minDate)} a ${formatter.format(maxDate)}`;
  }, [selectedShipping]);

  const orderBaseTotal = cart.total + (selectedShipping?.price ?? 0);
  const orderTotal = Math.max(0, Number((orderBaseTotal - couponDiscount).toFixed(2)));

  useEffect(() => {
    if (!user) return;
    setCustomerName(user.name || "");
    setCustomerEmail(user.email || "");
  }, [user]);

  useEffect(() => {
    if (!paymentData?.orderId || !isPaymentConfirmed || clearedOrdersRef.current.has(paymentData.orderId)) {
      return;
    }

    clearCart();
    clearedOrdersRef.current.add(paymentData.orderId);
  }, [clearCart, isPaymentConfirmed, paymentData?.orderId]);

  useEffect(() => {
    if (couponDiscount <= 0) return;
    const normalizedCode = couponCode.trim().toUpperCase();
    if (!normalizedCode || normalizedCode !== appliedCouponCode) {
      setCouponDiscount(0);
      setAppliedCouponCode(null);
    }
  }, [cart.total, selectedShipping?.price]);

  useEffect(() => {
    const normalizedCep = sanitizeCep(cep);
    if (normalizedCep.length !== 8 || shippingOptions.length === 0) return;
    void handleCalculateShipping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.total, cart.itemCount]);

  const getItemKey = (productId: number, selectedOptions?: Record<string, string>) => {
    if (!selectedOptions) return `${productId}`;
    const optionString = Object.entries(selectedOptions)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
    return `${productId}-${optionString}`;
  };

  const formatSelectedOptions = (selectedOptions?: Record<string, string>) => {
    if (!selectedOptions) return "";

    const labelMap: Record<string, string> = {
      cor: "Cor",
      tamanho: "Tamanho",
      size: "Tamanho",
      color: "Cor",
    };

    return Object.entries(selectedOptions)
      .map(([key, value]) => `${labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`)
      .join(" - ");
  };

  const getPixQrCodeSource = (pixQrCode: string) => {
    if (pixQrCode.startsWith("data:image")) {
      return pixQrCode;
    }
    return `data:image/png;base64,${pixQrCode}`;
  };

  const handleCopyText = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  const handleCalculateShipping = async () => {
    setShippingError("");
    const normalizedCep = sanitizeCep(cep);

    if (normalizedCep.length !== 8) {
      setShippingOptions([]);
      setSelectedShippingId(null);
      setShippingError("Informe um CEP válido com 8 dígitos.");
      return;
    }

    try {
      const response = await csrfFetch(apiUrl("/api/shipping/quote"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cep: normalizedCep,
          itemCount: cart.itemCount,
          subtotal: Number((cart.total / 100).toFixed(2)),
        }),
      });

      if (!response.ok) {
        throw new Error("Falha ao calcular frete");
      }

      const data = (await response.json()) as {
        options?: ShippingOption[];
        warning?: string;
        providerError?: string;
        source?: "melhor-envio" | "fallback-local" | "mixed";
      };
      const options = data.options?.length ? data.options : buildShippingOptions(normalizedCep, cart.total, cart.itemCount);
      setShippingOptions(options);
      setSelectedShippingId(options[0]?.id ?? null);
      const sanitizedProviderError = (data.providerError || "")
        .replace(/\s*\|\s*/g, "; ")
        .replace(/\s+/g, " ")
        .trim();
      const publicWarning =
        data.warning && data.warning.includes("Melhor Envio nao retornou cotacoes")
          ? "No momento, há apenas entrega local disponível para este CEP."
          : data.warning || "";
      const detailedWarning = data.warning
        ? sanitizedProviderError && canShowTechnicalShippingError
          ? `${data.warning} (${sanitizedProviderError})`
          : publicWarning
        : "";
      setShippingError(detailedWarning);
    } catch {
      const fallbackOptions = buildShippingOptions(normalizedCep, cart.total, cart.itemCount);
      setShippingOptions(fallbackOptions);
      setSelectedShippingId(fallbackOptions[0]?.id ?? null);
      setShippingError("Não foi possível consultar o frete externo. Estamos exibindo a opção de entrega local.");
    }
  };

  const handleLookupCep = async () => {
    setShippingError("");
    const normalizedCep = sanitizeCep(cep);
    if (normalizedCep.length !== 8) {
      setShippingError("Informe um CEP válido com 8 dígitos.");
      return;
    }

    setAddressLoading(true);
    try {
      const response = await fetch(apiUrl(`/api/cep/${normalizedCep}`), {
        credentials: "include",
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Falha ao consultar CEP.");
      }

      const data = (await response.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };

      if (data.erro) {
        setShippingError("CEP não encontrado.");
        return;
      }

      setAddressStreet(data.logradouro || "");
      setAddressNeighborhood(data.bairro || "");
      setAddressCity(data.localidade || "");
      setAddressState(data.uf || "");
      await handleCalculateShipping();
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível consultar o CEP.");
      const message = parsed.message;
      setShippingError(message.includes("Load failed") ? "Não foi possível consultar o CEP agora." : message);
      await handleCalculateShipping();
    } finally {
      setAddressLoading(false);
    }
  };

  const handleApplyCoupon = async () => {
    setCouponError("");
    const normalized = couponCode.trim().toUpperCase();
    if (!normalized) {
      setCouponDiscount(0);
      setAppliedCouponCode(null);
      return;
    }

    try {
      const result = await validateCoupon.mutateAsync({
        code: normalized,
        items: cart.items.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
        shipping: {
          cep: sanitizeCep(cep),
          optionId: selectedShippingId || "",
        },
      });
      setCouponDiscount(Number(result.discountAmount.toFixed(2)));
      setAppliedCouponCode(result.code);
    } catch (error) {
      setCouponDiscount(0);
      setAppliedCouponCode(null);
      const parsed = getApiErrorDisplay(error, "Cupom inválido ou expirado.");
      setCouponError(parsed.message);
    }
  };

  const handleCheckout = async () => {
    setPaymentError("");

    if (!isAuthenticated) {
      setPaymentError("Faça login para finalizar a compra.");
      return;
    }

    if (!customerName.trim() || !customerEmail.trim() || !cpfCnpj.trim()) {
      setPaymentError("Preencha nome, e-mail e CPF/CNPJ para gerar a cobrança.");
      return;
    }

    if (!sanitizeCep(cep) || !addressStreet.trim() || !addressNumber.trim() || !addressNeighborhood.trim() || !addressCity.trim() || !addressState.trim()) {
      setPaymentError("Preencha o CEP e o endereço para continuar.");
      return;
    }

    if (!selectedShipping) {
      setPaymentError("Calcule e selecione o frete antes de finalizar a compra.");
      return;
    }

    try {
      const result = await createAsaasCharge.mutateAsync({
        method: checkoutMethod,
        items: cart.items.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
        shipping: {
          cep: sanitizeCep(cep),
          optionId: selectedShipping.id,
        },
        shippingAddress: {
          recipient: customerName.trim(),
          zipCode: sanitizeCep(cep),
          street: addressStreet.trim(),
          number: addressNumber.trim(),
          complement: addressComplement.trim() || undefined,
          neighborhood: addressNeighborhood.trim(),
          city: addressCity.trim(),
          state: addressState.trim(),
        },
        customer: {
          name: customerName.trim(),
          email: customerEmail.trim(),
          cpfCnpj: cpfCnpj.trim(),
        },
        couponCode: appliedCouponCode || undefined,
      });

      setPaymentData(result);
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível gerar a cobrança.");
      setPaymentError(parsed.message);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ ...styles.header, marginBottom: isMobile ? 28 : styles.header.marginBottom, paddingBottom: isMobile ? 20 : styles.header.paddingBottom }}>
        <h1 style={{ ...styles.title, fontSize: isMobile ? 30 : styles.title.fontSize }}>
          <span style={{display: "inline-flex", alignItems: "center", gap: 10}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{color: "#1a1a1a"}}>
              <path d="M6 6h15l-1.5 9h-13z"></path>
              <circle cx="9" cy="20" r="1"></circle>
              <circle cx="19" cy="20" r="1"></circle>
            </svg>
            Pagamento
          </span>
        </h1>
        <p style={styles.subtitle}>
          {paymentData
            ? `Pedido #${paymentData.orderId} em acompanhamento`
            : cart.items.length === 0
            ? "Sua sacola está vazia."
            : `${cart.items.length} item${cart.items.length !== 1 ? "s" : ""} para finalizar`}
        </p>
      </div>

      {cart.items.length > 0 ? (
        <div
          style={{
            ...styles.container,
            gridTemplateColumns: isMobile ? "1fr" : styles.container.gridTemplateColumns,
            gap: isMobile ? 20 : styles.container.gap,
          }}
        >
          {/* Tabela de Itens - Mobile responsivo */}
          <div style={styles.itemsSection}>
            <h2 style={styles.sectionTitle}>Seu Pedido</h2>

            <div style={styles.itemsList}>
              {cart.items.map((item) =>
                isMobile ? (
                  <div key={getItemKey(item.product.id, item.selectedOptions)} style={styles.mobileCard}>
                    <div style={styles.mobileTopRow}>
                      <div style={styles.mobileImageWrap}>
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          style={styles.mobileImage}
                          onError={(event) => {
                            event.currentTarget.src = camisaFallback;
                          }}
                        />
                      </div>

                      <div style={styles.mobileInfoCol}>
                        <h3 style={styles.mobileItemName}>{item.product.name}</h3>
                        <p style={styles.mobileItemSub}>Produtos L4CKOS</p>
                        {item.selectedOptions && (
                          <p style={styles.mobileItemSub}>{formatSelectedOptions(item.selectedOptions)}</p>
                        )}
                      </div>

                      <div style={styles.mobilePriceCol}>
                        <p style={styles.mobilePriceLabel}>Subtotal</p>
                        <p style={styles.mobilePriceValue}>{formatPrice(item.product.price * item.quantity)}</p>
                      </div>
                    </div>

                    <div style={styles.mobileBottomRow}>
                      <div style={styles.mobileQtyWrap}>
                        <button
                          style={styles.mobileQtyBtn}
                          onClick={() =>
                            updateQuantity(
                              item.product.id,
                              Math.max(1, item.quantity - 1),
                              item.selectedOptions
                            )
                          }
                        >
                          -
                        </button>
                        <span style={styles.mobileQtyValue}>{item.quantity}</span>
                        <button
                          style={styles.mobileQtyBtn}
                          onClick={() =>
                            updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions)
                          }
                        >
                          +
                        </button>
                      </div>

                      <button
                        style={styles.mobileRemoveBtn}
                        onClick={() => removeFromCart(item.product.id, item.selectedOptions)}
                        title="Remover item"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{color: "#9b9b9b"}}>
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={getItemKey(item.product.id, item.selectedOptions)} style={styles.cartItemScroller}>
                    <div
                      style={{
                        ...styles.cartItem,
                        gridTemplateColumns: styles.cartItem.gridTemplateColumns,
                        gap: styles.cartItem.gap,
                      }}
                    >
                      <div style={styles.itemImageContainer}>
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          style={styles.itemImage}
                          onError={(event) => {
                            event.currentTarget.src = camisaFallback;
                          }}
                        />
                      </div>

                      <div style={styles.itemDetails}>
                        <h3 style={styles.itemName}>{item.product.name}</h3>
                        <p style={styles.itemCategory}>Produtos L4CKOS</p>
                        {item.selectedOptions && (
                          <p style={styles.itemOptions}>{formatSelectedOptions(item.selectedOptions)}</p>
                        )}
                        <p style={styles.itemPrice}>
                          {formatPrice(item.product.price)}/unidade
                        </p>
                      </div>

                      <div style={styles.itemQuantity}>
                        <label style={styles.quantityLabel}>Qtd.</label>
                        <div style={styles.quantityControl}>
                          <button
                            style={styles.quantityBtn}
                            onClick={() =>
                              updateQuantity(
                                item.product.id,
                                Math.max(1, item.quantity - 1),
                                item.selectedOptions
                              )
                            }
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) =>
                              updateQuantity(
                                item.product.id,
                                parseInt(e.target.value) || 1,
                                item.selectedOptions
                              )
                            }
                            style={styles.quantityInput}
                          />
                          <button
                            style={styles.quantityBtn}
                            onClick={() =>
                              updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions)
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div style={styles.itemTotal}>
                        <p style={styles.itemTotalLabel}>Subtotal</p>
                        <p style={styles.totalPrice}>
                          {formatPrice(item.product.price * item.quantity)}
                        </p>
                      </div>

                      <button
                        style={styles.removeBtn}
                        onClick={() => removeFromCart(item.product.id, item.selectedOptions)}
                        title="Remover item"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{color: "#9b9b9b"}}>
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Resumo do Pedido */}
          <div
            style={{
              ...styles.summarySection,
              position: isMobile ? "static" : styles.summarySection.position,
              top: isMobile ? undefined : styles.summarySection.top,
            }}
          >
            <h2 style={styles.sectionTitle}>Envio e Pagamento</h2>

            <div style={styles.summaryCard}>
              {/* Detalhes */}
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Subtotal:</span>
                <span style={styles.summaryValue}>
                  {formatPrice(cart.total)}
                </span>
              </div>

              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Frete:</span>
                <span style={{ ...styles.summaryValue, color: "#555555" }}>
                  {selectedShipping ? formatPrice(selectedShipping.price) : "Calcular"}
                </span>
              </div>

              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Desconto:</span>
                <span style={{ ...styles.summaryValue, color: "#555555" }}>
                  -{formatPrice(couponDiscount)}
                </span>
              </div>

              <div style={styles.divider}></div>

              {/* Total */}
              <div style={styles.totalRow}>
                <span style={styles.totalLabel}>Total:</span>
                <span style={styles.totalAmount}>{formatPrice(orderTotal)}</span>
              </div>

              <div style={styles.shippingBox}>
                <p style={styles.shippingTitle}>Calcular frete</p>
                <div style={styles.shippingInputRow}>
                  <input
                    style={styles.checkoutInput}
                    placeholder="CEP (somente números)"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={formatCep(cep)}
                    onChange={event => setCep(sanitizeCep(event.target.value))}
                  />
                  <button type="button" style={styles.shippingCalcButton} onClick={handleLookupCep} disabled={addressLoading}>
                    {addressLoading ? "Calculando..." : "Buscar e calcular"}
                  </button>
                </div>

                {shippingError ? <p style={styles.checkoutError}>{shippingError}</p> : null}

                {shippingOptions.length > 0 ? (
                  <div style={styles.shippingOptionsList}>
                    {shippingOptions.map(option => (
                      <button
                        key={option.id}
                        style={{
                          ...styles.shippingOption,
                          ...(selectedShippingId === option.id ? styles.shippingOptionActive : {}),
                        }}
                        onClick={() => setSelectedShippingId(option.id)}
                      >
                        <div style={styles.shippingOptionTop}>
                          <strong>{option.label}</strong>
                          <strong>{formatPrice(option.price)}</strong>
                        </div>
                        <p style={styles.shippingOptionText}>{option.description}</p>
                        <p style={styles.shippingOptionText}>
                          Prazo estimado: {option.minDays} a {option.maxDays} dias úteis
                        </p>
                      </button>
                    ))}
                  </div>
                ) : null}

                {selectedShipping ? (
                  <p style={styles.shippingEstimate}>
                    Previsão estimada de entrega: <strong>{estimatedDateRange}</strong>, contada após a aprovação do pagamento.
                  </p>
                ) : null}
              </div>

              <div style={styles.shippingBox}>
                <p style={styles.shippingTitle}>Cupom de desconto</p>
                <div style={styles.shippingInputRow}>
                  <input
                    style={styles.checkoutInput}
                    placeholder="Digite o cupom"
                    value={couponCode}
                    onChange={event => setCouponCode(event.target.value.toUpperCase())}
                  />
                  <div style={styles.shippingButtonGroup}>
                    <button
                      style={styles.shippingCalcButton}
                      onClick={() => {
                        void handleApplyCoupon();
                      }}
                      disabled={validateCoupon.isPending}
                    >
                      {validateCoupon.isPending ? "Validando..." : "Aplicar"}
                    </button>
                  </div>
                </div>
                {appliedCouponCode ? (
                  <p style={styles.shippingEstimate}>
                    Cupom aplicado: <strong>{appliedCouponCode}</strong>
                  </p>
                ) : null}
                {couponError ? <p style={styles.checkoutError}>{couponError}</p> : null}
              </div>

              <div style={styles.shippingBox}>
                <p style={styles.shippingTitle}>Antes de finalizar</p>
                <ul style={styles.checkoutChecklist}>
                  {checkoutHighlights.map(item => (
                    <li key={item} style={styles.checkoutChecklistItem}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Botoes */}
              <div style={styles.methodSelector}>
                <button
                  style={{
                    ...styles.methodButton,
                    ...(checkoutMethod === "PIX" ? styles.methodButtonActive : {}),
                  }}
                  onClick={() => setCheckoutMethod("PIX")}
                >
                  PIX
                </button>
                <button
                  style={{
                    ...styles.methodButton,
                    ...(checkoutMethod === "BOLETO" ? styles.methodButtonActive : {}),
                  }}
                  onClick={() => setCheckoutMethod("BOLETO")}
                >
                  Boleto
                </button>
                <button
                  style={{
                    ...styles.methodButton,
                    ...(checkoutMethod === "CARD" ? styles.methodButtonActive : {}),
                  }}
                  onClick={() => setCheckoutMethod("CARD")}
                >
                  Cartão
                </button>
              </div>

              <div style={styles.checkoutFields}>
                <input
                  style={styles.checkoutInput}
                  placeholder="Nome completo"
                  value={customerName}
                  onChange={event => setCustomerName(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                    placeholder="E-mail"
                  type="email"
                  value={customerEmail}
                  onChange={event => setCustomerEmail(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="CPF ou CNPJ"
                  value={cpfCnpj}
                  onChange={event => setCpfCnpj(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="Rua"
                  value={addressStreet}
                  onChange={event => setAddressStreet(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                    placeholder="Número"
                  value={addressNumber}
                  onChange={event => setAddressNumber(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="Complemento (opcional)"
                  value={addressComplement}
                  onChange={event => setAddressComplement(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="Bairro"
                  value={addressNeighborhood}
                  onChange={event => setAddressNeighborhood(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="Cidade"
                  value={addressCity}
                  onChange={event => setAddressCity(event.target.value)}
                />
                <input
                  style={styles.checkoutInput}
                  placeholder="UF"
                  value={addressState}
                  onChange={event => setAddressState(event.target.value.toUpperCase().slice(0, 2))}
                />
              </div>

              <button
                style={styles.checkoutBtn}
                onClick={() => {
                  void handleCheckout();
                }}
                disabled={createAsaasCharge.isPending}
              >
                {createAsaasCharge.isPending ? "Gerando cobrança..." : "Finalizar compra"}
              </button>

              <p style={styles.checkoutSupportText}>
                Ao gerar a cobrança, você poderá concluir o pagamento com mais calma pela página do Asaas ou pelo código PIX.
              </p>

              {paymentError ? <p style={styles.checkoutError}>{paymentError}</p> : null}

              {paymentData ? (
                <div style={styles.pixBox}>
                  <p style={styles.pixTitle}>
                    Cobrança {paymentData.method} gerada para o pedido #{paymentData.orderId}
                  </p>
                  <p style={styles.shippingOptionText}>
                    Status atual do pedido: <strong>{getOrderStatusLabel(paymentStatus)}</strong>
                  </p>

                  {isPaymentConfirmed ? (
                    <div style={styles.paymentConfirmedBox}>
                      <div style={styles.paymentConfirmedIcon} aria-hidden="true">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5"></path>
                        </svg>
                      </div>
                      <div style={styles.paymentConfirmedContent}>
                        <p style={styles.paymentConfirmedTitle}>Pagamento confirmado com sucesso</p>
                        <p style={styles.paymentConfirmedText}>
                          Seu pedido já entrou no fluxo da loja. Você pode acompanhar os próximos passos em Meus pedidos ou consultar este pedido diretamente pela página de acompanhamento.
                        </p>
                      </div>
                      <div style={styles.paymentConfirmedActions}>
                        <Link to="/meus-pedidos" style={styles.primaryActionLink}>
                          Ver meus pedidos
                        </Link>
                        <Link to={`/acompanhar-pedido?pedido=${paymentData.orderId}`} style={styles.secondaryActionLink}>
                          Acompanhar pedido #{paymentData.orderId}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <>
                      {paymentData.method === "PIX" && paymentData.pixQrCode ? (
                        <img
                          src={getPixQrCodeSource(paymentData.pixQrCode)}
                          alt="QR Code PIX"
                          style={styles.pixQrImage}
                        />
                      ) : null}

                      {paymentData.method === "PIX" && paymentData.pixCopyPaste ? (
                        <>
                          <textarea
                            style={styles.pixCopyTextarea}
                            readOnly
                            value={paymentData.pixCopyPaste}
                          />
                          <button
                            style={styles.pixCopyButton}
                            onClick={() => {
                              void handleCopyText(paymentData.pixCopyPaste);
                            }}
                          >
                            Copiar código PIX
                          </button>
                        </>
                      ) : null}

                      {paymentData.method === "BOLETO" && paymentData.digitableLine ? (
                        <>
                          <textarea
                            style={styles.pixCopyTextarea}
                            readOnly
                            value={paymentData.digitableLine}
                          />
                          <button
                            style={styles.pixCopyButton}
                            onClick={() => {
                              void handleCopyText(paymentData.digitableLine);
                            }}
                          >
                            Copiar linha digitável
                          </button>
                        </>
                      ) : null}

                      {paymentData.method === "CARD" ? (
                        <p style={styles.pixTitle}>
                          Para pagar no cartão, abra o link da fatura e escolha cartão na tela do Asaas.
                        </p>
                      ) : null}

                      {paymentData.invoiceUrl ? (
                        <a href={paymentData.invoiceUrl} target="_blank" rel="noreferrer" style={styles.pixInvoiceLink}>
                          Abrir fatura no Asaas
                        </a>
                      ) : null}

                      {paymentData.method === "BOLETO" && paymentData.bankSlipUrl ? (
                        <a href={paymentData.bankSlipUrl} target="_blank" rel="noreferrer" style={styles.pixInvoiceLink}>
                          Abrir boleto
                        </a>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              <Link to="/carrinho" style={styles.continueShopping}>
                Voltar à sacola
              </Link>
            </div>

            {/* Info extra */}
            <div style={styles.infoBox}>
              <p style={styles.infoTitle}>Informações importantes:</p>
              <ul style={styles.infoBenefits}>
                <li>- Frete calculado conforme o CEP informado</li>
                <li>- Prazo exibido antes da finalização e sujeito à aprovação do pagamento</li>
                <li>- Trocas e devoluções conforme nossa política publicada no site</li>
              </ul>
            </div>
          </div>
        </div>
      ) : paymentData ? (
        <div style={styles.orderStateShell}>
          <div style={styles.orderStateCard}>
            <p style={styles.orderStateEyebrow}>Pedido #{paymentData.orderId}</p>
            <h2 style={styles.orderStateTitle}>
              {isPaymentConfirmed ? "Pagamento confirmado" : "Cobrança gerada com sucesso"}
            </h2>
            <p style={styles.orderStateText}>
              {isPaymentConfirmed
                ? "Recebemos a confirmação do pagamento e seu pedido já entrou no fluxo da loja. Você pode acompanhar tudo na área de pedidos."
                : "Sua cobrança foi criada. Finalize o pagamento para liberar a separação do pedido."}
            </p>

            <div style={styles.orderStateMetaGrid}>
              <div style={styles.orderStateMetaCard}>
                <span style={styles.orderStateMetaLabel}>Status</span>
                <strong style={styles.orderStateMetaValue}>{getOrderStatusLabel(paymentStatus)}</strong>
              </div>
              <div style={styles.orderStateMetaCard}>
                <span style={styles.orderStateMetaLabel}>Total</span>
                <strong style={styles.orderStateMetaValue}>
                  {paymentOrderTotalCents > 0 ? formatPrice(paymentOrderTotalCents / 100) : "Aguardando atualização"}
                </strong>
              </div>
              <div style={styles.orderStateMetaCard}>
                <span style={styles.orderStateMetaLabel}>Método</span>
                <strong style={styles.orderStateMetaValue}>{paymentData.method}</strong>
              </div>
            </div>

            <div style={styles.orderStateActions}>
              <Link to="/meus-pedidos" style={styles.primaryActionLink}>
                Ver meus pedidos
              </Link>
              <Link to={`/acompanhar-pedido?pedido=${paymentData.orderId}`} style={styles.secondaryActionLink}>
                Acompanhar pedido
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...styles.emptyState, padding: isMobile ? "44px 16px" : styles.emptyState.padding }}>
          <div style={styles.emptyIcon}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{color: "#555555"}}>
              <path d="M6 6h15l-1.5 9h-13z"></path>
              <circle cx="9" cy="20" r="1"></circle>
              <circle cx="19" cy="20" r="1"></circle>
            </svg>
          </div>
          <h2 style={styles.emptyTitle}>Sua sacola está vazia</h2>
          <p style={styles.emptyText}>
            Adicione alguns produtos para começar suas compras.
          </p>
          <Link to="/produtos" style={styles.emptyButton}>
            Explorar Produtos
          </Link>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    marginBottom: 48,
    paddingBottom: 32,
    borderBottom: "1px solid #262626",
  },
  title: {
    fontSize: 40,
    fontWeight: 900,
    color: "#f0ede8",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    margin: 0,
  },
  container: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 0,
    maxWidth: 780,
    margin: "0 auto",
    marginBottom: 0,
  },
  itemsSection: {
    display: "none",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#f0ede8",
    marginBottom: 24,
  },
  itemsList: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  cartItemScroller: {
    display: "block",
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorX: "contain",
    WebkitOverflowScrolling: "touch",
  },
  mobileCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 10,
  },
  mobileTopRow: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  mobileImageWrap: {
    width: 78,
    height: 78,
    borderRadius: 8,
    overflow: "hidden",
    flexShrink: 0,
    background: "#f8fafc",
  },
  mobileImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "center",
    background: "#080808",
  },
  mobileInfoCol: {
    flex: 1,
    minWidth: 0,
  },
  mobileItemName: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1a1a1a",
    margin: 0,
    lineHeight: 1.2,
    textTransform: "uppercase",
  },
  mobileItemSub: {
    fontSize: 12,
    color: "#666666",
    margin: "2px 0 0 0",
    lineHeight: 1.25,
  },
  mobilePriceCol: {
    minWidth: 96,
    textAlign: "right",
  },
  mobilePriceLabel: {
    fontSize: 11,
    color: "#6b7280",
    margin: 0,
  },
  mobilePriceValue: {
    fontSize: 26,
    fontWeight: 800,
    color: "#1a1a1a",
    margin: "2px 0 0 0",
    lineHeight: 1,
  },
  mobileBottomRow: {
    marginTop: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mobileQtyWrap: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  mobileQtyBtn: {
    width: 24,
    height: 24,
    border: "none",
    background: "transparent",
    color: "#1a1a1a",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    padding: 0,
  },
  mobileQtyValue: {
    minWidth: 16,
    textAlign: "center",
    color: "#1a1a1a",
    fontSize: 15,
    fontWeight: 600,
  },
  mobileRemoveBtn: {
    border: "none",
    background: "transparent",
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  },
  cartItem: {
    display: "grid",
    gridTemplateColumns: "100px 1fr 1fr 100px 80px 40px",
    gap: 16,
    alignItems: "center",
    padding: 16,
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    transition: "all 0.3s ease",
  },
  itemImageContainer: {
    borderRadius: 8,
    overflow: "hidden",
    background: "#f8fafc",
  },
  itemImage: {
    width: "100%",
    height: 100,
    objectFit: "contain",
    objectPosition: "center",
    background: "#080808",
  },
  itemDetails: {
    paddingLeft: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: 700,
    color: "#1a1a1a",
    margin: "0 0 4px 0",
  },
  itemCategory: {
    fontSize: 12,
    color: "#6b7280",
    margin: "0 0 4px 0",
  },
  itemOptions: {
    fontSize: 12,
    color: "#374151",
    margin: "0 0 4px 0",
    fontWeight: 600,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: 700,
    color: "#555555",
    margin: 0,
  },
  itemQuantity: {
    textAlign: "center",
  },
  quantityLabel: {
    fontSize: 12,
    color: "#6b7280",
    display: "block",
    marginBottom: 8,
    fontWeight: 600,
  },
  quantityControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    overflow: "hidden",
  },
  quantityBtn: {
    background: "#f8fafc",
    border: "none",
    width: 32,
    height: 32,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
    transition: "background 0.2s ease",
  },
  quantityInput: {
    border: "none",
    width: 40,
    height: 32,
    boxSizing: "border-box",
    padding: 0,
    appearance: "textfield",
    textAlign: "center",
    fontSize: 14,
    fontWeight: 700,
  },
  itemTotal: {
    textAlign: "center",
  },
  itemTotalLabel: {
    fontSize: 12,
    color: "#6b7280",
    margin: "0 0 4px 0",
    fontWeight: 600,
  },
  totalPrice: {
    fontSize: 16,
    fontWeight: 700,
    color: "#1a1a1a",
    margin: 0,
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    fontSize: 20,
    cursor: "pointer",
    padding: 0,
    width: 32,
    height: 32,
    transition: "transform 0.2s ease",
  },
  summarySection: {
    position: "sticky",
    top: 100,
    height: "fit-content",
  },
  summaryCard: {
    background: "#101010",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    padding: 24,
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    fontSize: 14,
  },
  summaryLabel: {
    color: "#6b7280",
    fontWeight: 500,
  },
  summaryValue: {
    fontWeight: 600,
    color: "#f0ede8",
  },
  divider: {
    height: 1,
    background: "#2a2a2a",
    margin: "16px 0",
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  totalLabel: {
    fontSize: 20,
    fontWeight: 700,
    color: "#f0ede8",
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: 900,
    color: "#f0ede8",
  },
  methodSelector: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },
  methodButton: {
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    padding: "10px 8px",
    background: "#121212",
    color: "#c6c6c6",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  methodButtonActive: {
    background: "#1a1a1a",
    color: "#ffffff",
    border: "1px solid #1a1a1a",
  },
  checkoutFields: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 12,
  },
  checkoutInput: {
    width: "100%",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    color: "#f0ede8",
    background: "#0f0f0f",
    outline: "none",
  },
  shippingBox: {
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    background: "#151515",
  },
  shippingTitle: {
    margin: "0 0 10px 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#f0ede8",
  },
  shippingInputRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
    marginBottom: 10,
  },
  shippingButtonGroup: {
    display: "grid",
    gap: 6,
  },
  shippingCalcButton: {
    border: "none",
    borderRadius: 8,
    background: "#1f2937",
    color: "white",
    fontWeight: 700,
    fontSize: 13,
    padding: "0 14px",
    cursor: "pointer",
  },
  shippingOptionsList: {
    display: "grid",
    gap: 8,
  },
  shippingOption: {
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    padding: 10,
    background: "#0f0f0f",
    textAlign: "left",
    cursor: "pointer",
  },
  shippingOptionActive: {
    border: "1px solid #3d3d3d",
    background: "#1b1b1b",
  },
  shippingOptionTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 13,
    color: "#f0ede8",
    marginBottom: 4,
  },
  shippingOptionText: {
    margin: 0,
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.4,
  },
  shippingEstimate: {
    margin: "10px 0 0 0",
    fontSize: 12,
    color: "#0f766e",
    fontWeight: 600,
  },
  checkoutChecklist: {
    margin: 0,
    paddingLeft: 18,
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 1.6,
  },
  checkoutChecklistItem: {
    marginBottom: 4,
  },
  checkoutBtn: {
    width: "100%",
    padding: "18px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
    color: "white",
    border: "none",
    borderRadius: 10,
    fontWeight: 800,
    cursor: "pointer",
    transition: "all 0.3s ease",
    marginBottom: 12,
    fontSize: 18,
  },
  checkoutSupportText: {
    margin: "0 0 12px 0",
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.6,
  },
  checkoutError: {
    color: "#b91c1c",
    fontSize: 13,
    margin: "0 0 12px 0",
    fontWeight: 600,
  },
  pixBox: {
    border: "1px solid #d1fae5",
    background: "#ecfdf5",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  pixTitle: {
    margin: "0 0 10px 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#065f46",
  },
  pixQrImage: {
    width: "100%",
    maxWidth: 220,
    display: "block",
    margin: "0 auto 10px auto",
    borderRadius: 8,
    border: "1px solid #a7f3d0",
  },
  pixCopyTextarea: {
    width: "100%",
    minHeight: 96,
    resize: "vertical",
    border: "1px solid #a7f3d0",
    borderRadius: 8,
    padding: 8,
    boxSizing: "border-box",
    fontSize: 12,
    color: "#1a1a1a",
    marginBottom: 8,
  },
  pixCopyButton: {
    width: "100%",
    border: "none",
    borderRadius: 8,
    padding: "10px 12px",
    fontWeight: 700,
    color: "#ffffff",
    background: "#047857",
    cursor: "pointer",
    marginBottom: 8,
  },
  pixInvoiceLink: {
    display: "inline-block",
    fontSize: 13,
    color: "#065f46",
    fontWeight: 700,
    textDecoration: "underline",
  },
  paymentConfirmedBox: {
    display: "grid",
    gap: 14,
    marginTop: 14,
    padding: 18,
    borderRadius: 12,
    border: "1px solid #86efac",
    background: "#f0fdf4",
  },
  paymentConfirmedIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "#166534",
    color: "#ffffff",
  },
  paymentConfirmedContent: {
    display: "grid",
    gap: 8,
  },
  paymentConfirmedTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: "#14532d",
  },
  paymentConfirmedText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#166534",
  },
  paymentConfirmedActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryActionLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 10,
    background: "#166534",
    color: "#ffffff",
    fontWeight: 700,
    textDecoration: "none",
  },
  secondaryActionLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 10,
    border: "1px solid #86efac",
    background: "#ffffff",
    color: "#166534",
    fontWeight: 700,
    textDecoration: "none",
  },
  orderStateShell: {
    display: "flex",
    justifyContent: "center",
  },
  orderStateCard: {
    width: "100%",
    maxWidth: 980,
    display: "grid",
    gap: 20,
    padding: "32px 28px",
    borderRadius: 18,
    border: "1px solid #2b2b2b",
    background: "linear-gradient(180deg, #111111 0%, #171717 100%)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.32)",
  },
  orderStateEyebrow: {
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#888888",
  },
  orderStateTitle: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.1,
    color: "#f5f1e8",
  },
  orderStateText: {
    margin: 0,
    maxWidth: 720,
    fontSize: 16,
    lineHeight: 1.7,
    color: "#b7b7b7",
  },
  orderStateMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },
  orderStateMetaCard: {
    display: "grid",
    gap: 8,
    padding: "16px 18px",
    borderRadius: 14,
    border: "1px solid #262626",
    background: "#0d0d0d",
  },
  orderStateMetaLabel: {
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#7a7a7a",
  },
  orderStateMetaValue: {
    fontSize: 18,
    color: "#f5f1e8",
  },
  orderStateActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
  },
  continueShopping: {
    display: "block",
    textAlign: "center",
    width: "100%",
    padding: "14px 12px",
    color: "#f0ede8",
    border: "none",
    borderRadius: 10,
    fontWeight: 700,
    margin: "0 auto 12px auto",
    fontSize: 16,
    transition: "all 0.3s ease",
    background: "#1f1f1f",
    cursor: "pointer",
  },
  infoBox: {
    marginTop: 24,
    padding: 16,
    background: "#151515",
    borderRadius: 8,
    border: "1px solid #2a2a2a",
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#f0ede8",
    margin: "0 0 8px 0",
  },
  infoBenefits: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    fontSize: 13,
    color: "#6b7280",
  },
  emptyState: {
    textAlign: "center",
    padding: "80px 40px",
    background: "linear-gradient(180deg, #111111 0%, #191919 100%)",
    borderRadius: 16,
    border: "1px solid #2b2b2b",
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "#f5f1e8",
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#9a9a9a",
    marginBottom: 32,
  },
  emptyButton: {
    display: "inline-block",
    padding: "14px 32px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
    color: "white",
    borderRadius: 8,
    fontWeight: 700,
    transition: "all 0.3s ease",
    fontSize: 16,
  },
};





