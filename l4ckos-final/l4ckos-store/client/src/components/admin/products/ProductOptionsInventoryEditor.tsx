import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

type VariantDraft = {
  name: string;
  sku: string;
  price: string;
  stock: number;
  color: string | null;
  size: string | null;
};

type FormValues = {
  name: string;
  price: string;
  stock: string;
  colorsCsv: string;
  sizesCsv: string;
  sizeType: string;
  variantsCsv: string;
};

const splitCsv = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
const normalize = (value: string | null | undefined) => String(value ?? "").trim().toLocaleLowerCase("pt-BR");

function optionForName(name: string, options: string[]) {
  const normalizedName = normalize(name);
  return options.find(option => {
    const candidate = normalize(option);
    return normalizedName === candidate || normalizedName.endsWith(` ${candidate}`) || normalizedName.includes(` ${candidate} `);
  }) ?? null;
}

function parseVariants(serialized: string, colors: string[], sizes: string[]): VariantDraft[] {
  return serialized
    .split(";")
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const [name = "", sku = "", price = "", rawStock = "0"] = value.split("|").map(part => part.trim());
      return {
        name,
        sku,
        price,
        stock: Math.max(0, Math.trunc(Number(rawStock) || 0)),
        color: optionForName(name, colors),
        size: optionForName(name, sizes),
      };
    });
}

function optionKey(color: string | null, size: string | null) {
  return `${normalize(color)}::${normalize(size)}`;
}

function buildVariants(name: string, price: string, colors: string[], sizes: string[], existing: VariantDraft[]) {
  if (colors.length === 0 && sizes.length === 0) return [];
  const existingByKey = new Map(existing.map(variant => [optionKey(variant.color, variant.size), variant]));
  const combinations = colors.length > 0 && sizes.length > 0
    ? colors.flatMap(color => sizes.map(size => ({ color, size })))
    : (colors.length > 0 ? colors : sizes).map(value => (colors.length > 0 ? { color: value, size: null } : { color: null, size: value }));

  return combinations.map(({ color, size }) => {
    const current = existingByKey.get(optionKey(color, size));
    return {
      name: current?.name || [name.trim() || "Variante", color, size].filter(Boolean).join(" "),
      sku: current?.sku || "",
      price: current?.price || "",
      stock: current?.stock ?? 0,
      color,
      size,
    };
  });
}

function serializeVariants(variants: VariantDraft[]) {
  return variants.map(variant => `${variant.name}|${variant.sku}|${variant.price}|${Math.max(0, Math.trunc(variant.stock))}`).join("; ");
}

export const productOptionsInventory = {
  parseVariants,
  buildVariants,
  serializeVariants,
};

export function ProductOptionsInventoryEditor({
  value,
  onChange,
  colorSuggestions,
  alphaSizeSuggestions,
  numericSizeSuggestions,
}: {
  value: FormValues;
  onChange: (next: Partial<FormValues>) => void;
  colorSuggestions: readonly string[];
  alphaSizeSuggestions: readonly string[];
  numericSizeSuggestions: readonly string[];
}) {
  const [customColor, setCustomColor] = useState("");
  const [customSize, setCustomSize] = useState("");
  const colors = useMemo(() => splitCsv(value.colorsCsv), [value.colorsCsv]);
  const sizes = useMemo(() => splitCsv(value.sizesCsv), [value.sizesCsv]);
  const variants = useMemo(() => buildVariants(value.name, value.price, colors, sizes, parseVariants(value.variantsCsv, colors, sizes)), [colors, sizes, value.name, value.price, value.variantsCsv]);
  const hasVariants = colors.length > 0 || sizes.length > 0;
  const totalStock = variants.reduce((total, variant) => total + variant.stock, 0);
  const availableVariants = variants.filter(variant => variant.stock > 0).length;
  const sizeSuggestions = value.sizeType === "numeric" ? numericSizeSuggestions : alphaSizeSuggestions;

  const setOptions = (nextColors: string[], nextSizes: string[]) => {
    const current = parseVariants(value.variantsCsv, colors, sizes);
    const nextVariants = buildVariants(value.name, value.price, nextColors, nextSizes, current);
    onChange({
      colorsCsv: nextColors.join(", "),
      sizesCsv: nextSizes.join(", "),
      variantsCsv: serializeVariants(nextVariants),
      stock: nextVariants.length > 0 ? String(nextVariants.reduce((total, variant) => total + variant.stock, 0)) : value.stock,
    });
  };

  const addOption = (dimension: "color" | "size", rawValue: string) => {
    const token = rawValue.trim();
    if (!token) return;
    const source = dimension === "color" ? colors : sizes;
    if (source.some(item => normalize(item) === normalize(token))) return;
    setOptions(dimension === "color" ? [...colors, token] : colors, dimension === "size" ? [...sizes, token] : sizes);
  };

  const removeOption = (dimension: "color" | "size", token: string) => {
    const affected = variants.filter(variant => (dimension === "color" ? normalize(variant.color) : normalize(variant.size)) === normalize(token));
    if (affected.some(variant => variant.stock > 0) && !window.confirm(`Remover ${token} descartará variantes com estoque. Continuar?`)) return;
    setOptions(dimension === "color" ? colors.filter(item => normalize(item) !== normalize(token)) : colors, dimension === "size" ? sizes.filter(item => normalize(item) !== normalize(token)) : sizes);
  };

  const updateVariant = (color: string | null, size: string | null, patch: Partial<VariantDraft>) => {
    const next = variants.map(variant => optionKey(variant.color, variant.size) === optionKey(color, size) ? { ...variant, ...patch } : variant);
    onChange({ variantsCsv: serializeVariants(next), stock: String(next.reduce((total, variant) => total + variant.stock, 0)) });
  };

  return (
    <section style={styles.section} aria-labelledby="product-options-inventory-title">
      <div style={styles.heading}>
        <div>
          <span style={styles.eyebrow}>Opções e estoque</span>
          <h4 id="product-options-inventory-title" style={styles.title}>Variações do produto</h4>
          <p style={styles.description}>Organize cores e tamanhos. O estoque de um produto com variantes é sempre calculado pela matriz abaixo.</p>
        </div>
      </div>

      <div style={styles.optionsGrid}>
        <OptionChips label="Cores" values={colors} suggestions={colorSuggestions} customValue={customColor} onCustomValueChange={setCustomColor} onAdd={valueToAdd => { addOption("color", valueToAdd); setCustomColor(""); }} onRemove={color => removeOption("color", color)} placeholder="Adicionar cor" />
        <OptionChips label="Tamanhos" values={sizes} suggestions={sizeSuggestions} customValue={customSize} onCustomValueChange={setCustomSize} onAdd={valueToAdd => { addOption("size", valueToAdd); setCustomSize(""); }} onRemove={size => removeOption("size", size)} placeholder="Adicionar tamanho" />
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Tipo de tamanho</span>
          <select style={styles.select} value={value.sizeType} onChange={event => onChange({ sizeType: event.target.value })}>
            <option value="alpha">Alfabético (PP, P, M...)</option>
            <option value="numeric">Numérico (36, 38, 40...)</option>
            <option value="custom">Customizado</option>
          </select>
        </label>
      </div>

      {hasVariants ? (
        <>
          <div style={styles.totalCard}>
            <div><span style={styles.fieldLabel}>Estoque total</span><strong style={styles.totalValue}>{totalStock} unidades</strong></div>
            <span style={styles.totalHint}>Calculado automaticamente a partir das variantes.</span>
          </div>
          <div style={styles.summary}><span>{variants.length} variantes</span><span>{availableVariants} disponíveis</span><span>{variants.length - availableVariants} esgotadas</span></div>
          <VariantMatrix colors={colors} sizes={sizes} variants={variants} onUpdate={updateVariant} />
          <details style={styles.advanced}>
            <summary>Opções avançadas por variante</summary>
            <div style={styles.advancedList}>
              {variants.map(variant => (
                <div key={optionKey(variant.color, variant.size)} style={styles.advancedRow}>
                  <strong>{[variant.color, variant.size].filter(Boolean).join(" / ")}</strong>
                  <label>SKU<input style={styles.compactInput} value={variant.sku} onChange={event => updateVariant(variant.color, variant.size, { sku: event.target.value })} /></label>
                  <label>Preço específico<input style={styles.compactInput} placeholder="Usar preço base" value={variant.price} onChange={event => updateVariant(variant.color, variant.size, { price: event.target.value })} /></label>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <label style={styles.stockField}>
          <span style={styles.fieldLabel}>Estoque disponível</span>
          <input type="number" min="0" step="1" inputMode="numeric" style={styles.stockInput} value={value.stock} onChange={event => onChange({ stock: String(Math.max(0, Math.trunc(Number(event.target.value) || 0))) })} />
          <span style={styles.totalHint}>Produtos sem variantes usam o estoque do próprio produto.</span>
        </label>
      )}
    </section>
  );
}

function OptionChips({ label, values, suggestions, customValue, onCustomValueChange, onAdd, onRemove, placeholder }: { label: string; values: string[]; suggestions: readonly string[]; customValue: string; onCustomValueChange: (value: string) => void; onAdd: (value: string) => void; onRemove: (value: string) => void; placeholder: string }) {
  return <div style={styles.optionGroup}><span style={styles.fieldLabel}>{label}</span><div style={styles.chips}>{values.map(value => <button key={value} type="button" style={styles.chip} onClick={() => onRemove(value)} aria-label={`Remover ${value}`}>{value} <span aria-hidden>×</span></button>)}</div><div style={styles.suggestions}>{suggestions.filter(value => !values.some(current => normalize(current) === normalize(value))).map(value => <button key={value} type="button" style={styles.suggestion} onClick={() => onAdd(value)}>+ {value}</button>)}</div><div style={styles.customRow}><input style={styles.compactInput} placeholder={placeholder} value={customValue} onChange={event => onCustomValueChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onAdd(customValue); } }} /><button type="button" style={styles.addButton} onClick={() => onAdd(customValue)}>Adicionar</button></div></div>;
}

function VariantMatrix({ colors, sizes, variants, onUpdate }: { colors: string[]; sizes: string[]; variants: VariantDraft[]; onUpdate: (color: string | null, size: string | null, patch: Partial<VariantDraft>) => void }) {
  const cells = (color: string | null) => (sizes.length > 0 ? sizes : [null]).map(size => variants.find(variant => optionKey(variant.color, variant.size) === optionKey(color, size))!);
  const hasTwoDimensions = colors.length > 0 && sizes.length > 0;
  if (hasTwoDimensions) {
    return <div style={styles.matrixWrap}><div style={{ ...styles.matrix, gridTemplateColumns: `minmax(110px, 1fr) repeat(${sizes.length}, minmax(74px, 1fr))` }}><span style={styles.matrixHeader}>Cor / tamanho</span>{sizes.map(size => <span key={size} style={styles.matrixHeader}>{size}</span>)}{colors.map(color => <MatrixRow key={color} label={color} variants={cells(color)} onUpdate={onUpdate} />)}</div></div>;
  }
  const dimension = colors.length > 0
    ? colors.map(color => ({ label: color, variant: variants.find(item => optionKey(item.color, item.size) === optionKey(color, null))! }))
    : sizes.map(size => ({ label: size, variant: variants.find(item => optionKey(item.color, item.size) === optionKey(null, size))! }));
  return <div style={styles.matrixWrap}><div style={styles.singleDimension}>{dimension.map(({ label, variant }) => <MatrixRow key={label} label={label} variants={[variant]} onUpdate={onUpdate} />)}</div></div>;
}

function MatrixRow({ label, variants, onUpdate }: { label: string; variants: VariantDraft[]; onUpdate: (color: string | null, size: string | null, patch: Partial<VariantDraft>) => void }) {
  if (variants.length === 1) return <><span style={styles.matrixLabel}>{label}</span><StockCell variant={variants[0]} onUpdate={onUpdate} /></>;
  return <><span style={styles.matrixLabel}>{label}</span>{variants.map(variant => <StockCell key={optionKey(variant.color, variant.size)} variant={variant} onUpdate={onUpdate} />)}</>;
}

function StockCell({ variant, onUpdate }: { variant: VariantDraft; onUpdate: (color: string | null, size: string | null, patch: Partial<VariantDraft>) => void }) {
  return <input aria-label={`Estoque ${[variant.color, variant.size].filter(Boolean).join(" ")}`} type="number" min="0" step="1" inputMode="numeric" style={{ ...styles.matrixInput, ...(variant.stock === 0 ? styles.matrixInputEmpty : {}) }} value={variant.stock} onChange={event => onUpdate(variant.color, variant.size, { stock: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} />;
}

const styles: Record<string, CSSProperties> = {
  section: { display: "grid", gap: 14, gridColumn: "1 / -1", padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008)), #0a0a0a" },
  heading: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }, eyebrow: { color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.11em", fontSize: 10, fontWeight: 800 }, title: { margin: "5px 0 0", color: "#f8f4ec", fontSize: 17 }, description: { margin: "6px 0 0", color: "#9ca3af", fontSize: 12, lineHeight: 1.5, maxWidth: 700 },
  optionsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }, optionGroup: { display: "grid", gap: 8, minWidth: 0 }, field: { display: "grid", gap: 7, alignContent: "start" }, fieldLabel: { color: "#d1d5db", fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }, chips: { display: "flex", gap: 6, flexWrap: "wrap", minHeight: 28 }, chip: { border: "1px solid rgba(239,68,68,0.34)", borderRadius: 999, background: "rgba(127,29,29,0.18)", color: "#f8f4ec", minHeight: 28, padding: "0 9px", cursor: "pointer", fontSize: 12, fontWeight: 700 }, suggestions: { display: "flex", gap: 5, flexWrap: "wrap" }, suggestion: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, background: "#131313", color: "#b8bec7", minHeight: 26, padding: "0 8px", cursor: "pointer", fontSize: 11 }, customRow: { display: "flex", gap: 7 }, compactInput: { width: "100%", minWidth: 0, minHeight: 34, borderRadius: 8, border: "1px solid #303030", background: "#101010", color: "#f8f4ec", padding: "0 9px", fontSize: 12 }, addButton: { minHeight: 34, border: "1px solid rgba(239,68,68,0.32)", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#fff", padding: "0 10px", cursor: "pointer", fontSize: 12, fontWeight: 800 }, select: { minHeight: 38, borderRadius: 8, border: "1px solid #303030", background: "#101010", color: "#f8f4ec", padding: "0 10px" },
  totalCard: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.18)", background: "rgba(127,29,29,0.10)" }, totalValue: { display: "block", marginTop: 4, color: "#fff", fontSize: 20 }, totalHint: { color: "#9ca3af", fontSize: 12, lineHeight: 1.45 }, summary: { display: "flex", gap: 12, flexWrap: "wrap", color: "#c4c9d1", fontSize: 12 }, matrixWrap: { overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "#090909" }, matrix: { display: "grid", minWidth: 420 }, matrixHeader: { padding: "10px", color: "#9ca3af", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.07)" }, matrixLabel: { display: "flex", alignItems: "center", padding: "10px", color: "#f0ede8", fontSize: 13, fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.05)" }, matrixInput: { width: "calc(100% - 12px)", minWidth: 54, margin: 6, minHeight: 36, borderRadius: 8, border: "1px solid #343434", background: "#121212", color: "#fff", padding: "0 8px", fontWeight: 800 }, matrixInputEmpty: { borderColor: "rgba(239,68,68,0.38)", background: "rgba(127,29,29,0.12)", color: "#fca5a5" }, singleDimension: { display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(90px, 160px)" }, stockField: { display: "grid", gap: 7, maxWidth: 270 }, stockInput: { minHeight: 42, borderRadius: 8, border: "1px solid #303030", background: "#101010", color: "#fff", padding: "0 10px", fontSize: 16, fontWeight: 800 }, advanced: { color: "#cdd2da", fontSize: 12 }, advancedList: { display: "grid", gap: 8, marginTop: 10 }, advancedRow: { display: "grid", gridTemplateColumns: "minmax(110px, 1fr) minmax(120px, 1fr) minmax(150px, 1fr)", gap: 8, alignItems: "center", padding: 10, borderRadius: 9, background: "#111" },
};
