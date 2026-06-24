import { Box, Cog, PenLine } from "lucide-react";

const teaserItems = [
  { label: "Equipamentos exclusivos", Icon: Cog },
  { label: "Acessorios premium", Icon: PenLine },
  { label: "Lancamentos limitados", Icon: Box },
];

export default function PreviewSection() {
  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-300/85 bg-white/62 shadow-[0_12px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        <div className="grid sm:grid-cols-3">
          {teaserItems.map(({ label, Icon }, index) => {
            const withDivider = index < teaserItems.length - 1;
            return (
              <article
                key={label}
                className={`flex items-center justify-center gap-2 px-4 py-6 text-center font-sans text-sm font-medium text-zinc-700 sm:text-[1.05rem] ${withDivider ? "border-b border-zinc-300/70 sm:border-b-0 sm:border-r" : ""}`}
              >
                <Icon size={18} className="text-zinc-500" />
                <span>{label}</span>
              </article>
            );
          })}
        </div>
      </div>

      <p className="text-center font-sans text-[15px] text-zinc-600">Revelaremos tudo no lancamento.</p>
      <p className="text-center font-sans text-sm text-zinc-500 sm:text-base">&copy; 2024 L4CKOS. Todos os direitos reservados.</p>
    </section>
  );
}
