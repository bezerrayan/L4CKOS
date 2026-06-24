export default function HeroSection() {
  return (
    <section className="text-center text-zinc-900">
      <div className="mx-auto inline-flex flex-col items-center">
        <p className="font-sans text-[clamp(2.1rem,5vw,3.6rem)] font-extrabold leading-none tracking-tight text-zinc-800">L4CKOS</p>
        <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.34em] text-zinc-600 sm:text-xs">Built for Adventure</p>
      </div>

      <h1 className="mx-auto mt-7 max-w-3xl text-balance font-sans text-[clamp(2rem,4.9vw,3.3rem)] font-bold leading-[1.08] tracking-tight text-zinc-800">
        A nova marca de aventura
        <br />
        esta chegando
      </h1>

      <p className="mx-auto mt-4 max-w-2xl text-balance font-sans text-base leading-relaxed text-zinc-600 sm:text-[1.15rem]">
        Equipamentos premium para aventura, tecnologia e movimento.
      </p>
    </section>
  );
}
