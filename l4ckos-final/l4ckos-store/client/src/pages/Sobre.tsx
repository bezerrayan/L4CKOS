import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { useIsMobile } from "../hooks/useIsMobile";

const principles = [
  {
    number: "01",
    title: "Identidade",
    text: "Criamos peças com personalidade e elementos reconhecíveis, sem depender de excessos para chamar atenção.",
  },
  {
    number: "02",
    title: "Qualidade com intenção",
    text: "Materiais, modelagem, acabamento e apresentação devem ter uma razão para existir. Cada escolha precisa contribuir para a estética, o conforto e a durabilidade da peça.",
  },
  {
    number: "03",
    title: "Movimento",
    text: "A L4CKOS acompanha diferentes caminhos: atividades ao ar livre, viagens, encontros, descobertas e o cotidiano urbano.",
  },
];

export default function Sobre() {
  const isMobile = useIsMobile();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <main style={styles.page}>
      <section style={{ ...styles.hero, padding: isMobile ? "76px 18px 58px" : styles.hero.padding }}>
        <div style={styles.heroInner}>
          <div style={styles.kicker}>L4CKOS / BUILT FOR ADVENTURE</div>
          <div style={{ ...styles.heroGrid, gridTemplateColumns: isMobile ? "1fr" : styles.heroGrid.gridTemplateColumns }}>
            <div>
              <h1 style={{ ...styles.heroTitle, fontSize: isMobile ? 44 : styles.heroTitle.fontSize }}>
                Não é só sobre vestir.
                <br />
                É sobre carregar identidade.
              </h1>
              <p style={styles.heroText}>
                A L4CKOS é uma marca brasileira independente que une estética urbana,
                espírito de aventura e identidade.
              </p>
              <p style={styles.heroText}>
                Criamos peças para acompanhar quem está em movimento, seja explorando
                novos lugares, construindo novos caminhos ou vivendo o cotidiano da
                própria maneira.
              </p>
            </div>

            <div style={{ ...styles.brandPanel, minHeight: isMobile ? 260 : styles.brandPanel.minHeight }}>
              <div style={styles.routeLineOne} />
              <div style={styles.routeLineTwo} />
              <span style={styles.panelMark}>L<span style={styles.red}>4</span>K</span>
              <span style={styles.panelBrand}>L<span style={styles.red}>4</span>CKOS</span>
              <span style={styles.panelMicro}>movement / identity / outside</span>
            </div>
          </div>
        </div>
      </section>

      <section style={sectionStyle(isMobile)}>
        <div style={styles.sectionLabel}>origem</div>
        <div style={styles.textColumn}>
          <h2 style={titleStyle(isMobile)}>Como tudo começou</h2>
          <p style={styles.bodyText}>A L4CKOS começou antes mesmo de existir como marca.</p>
          <p style={styles.bodyText}>
            O nome surgiu em um perfil criado entre amigos para compartilhar vídeos,
            momentos e experiências ligados à aventura.
          </p>
          <p style={styles.bodyText}>
            Mais tarde, ao conhecermos projetos de roupas que traziam uma nova visão
            para o universo escoteiro, nasceu uma ideia: criar algo com essa mesma
            liberdade, mas que pudesse ir além.
          </p>
          <p style={styles.bodyText}>
            Queríamos desenvolver peças conectadas à aventura, à exploração e às
            experiências ao ar livre, sem que fossem limitadas a um único público ou
            ocasião.
          </p>
          <p style={styles.bodyText}>
            Roupas que pudessem fazer sentido em uma atividade, em uma viagem, na
            cidade ou simplesmente no cotidiano.
          </p>
          <p style={styles.bodyText}>
            Foi assim que a L4CKOS começou a ganhar uma nova forma: deixando de ser
            apenas o nome de um perfil para se transformar em uma marca construída em
            torno de identidade, movimento e propósito.
          </p>
        </div>
      </section>

      <section style={{ ...sectionStyle(isMobile), borderTop: "1px solid #222222" }}>
        <div style={styles.sectionLabel}>fora do óbvio</div>
        <div style={styles.textColumn}>
          <h2 style={titleStyle(isMobile)}>Feita para ir além</h2>
          <p style={styles.bodyText}>
            A inspiração inicial da L4CKOS tem ligação com o universo escoteiro, com
            a vida ao ar livre e com experiências construídas em grupo.
          </p>
          <p style={styles.bodyText}>Mas a marca não nasceu para ficar limitada a esse espaço.</p>
          <p style={styles.bodyText}>
            A proposta é transformar essa essência em peças que também façam sentido
            fora das atividades: na cidade, em viagens, nos encontros e na rotina.
          </p>
          <p style={styles.bodyText}>
            Quem vive o escotismo pode reconhecer essa origem. Quem nunca fez parte
            dele também pode se identificar com a vontade de explorar, descobrir e
            construir o próprio caminho.
          </p>
        </div>
      </section>

      <section style={{ ...styles.statement, padding: isMobile ? "70px 18px" : styles.statement.padding }}>
        <div style={styles.statementInner}>
          <span style={styles.statementSmall}>Built for Adventure</span>
          <h2 style={{ ...styles.statementTitle, fontSize: isMobile ? 42 : styles.statementTitle.fontSize }}>
            Built for Adventure.
            <br />
            Feita para quem está em movimento.
          </h2>
          <p style={styles.statementText}>
            Para a L4CKOS, aventura não acontece apenas em uma trilha ou em um lugar
            distante.
          </p>
          <p style={styles.statementText}>
            Aventura também é começar algo novo, sair do automático, testar uma ideia,
            mudar de direção e aceitar o risco de construir o próprio caminho.
          </p>
          <p style={styles.statementText}>A L4CKOS também nasceu dessa escolha.</p>
        </div>
      </section>

      <section style={sectionStyle(isMobile)}>
        <div style={styles.sectionLabel}>princípios</div>
        <div style={styles.textColumn}>
          <h2 style={titleStyle(isMobile)}>O que orienta a marca</h2>
          <div style={styles.principles}>
            {principles.map(item => (
              <article key={item.number} style={styles.principleItem}>
                <span style={styles.principleNumber}>{item.number}</span>
                <div>
                  <h3 style={styles.principleTitle}>{item.title}</h3>
                  <p style={styles.principleText}>{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={{ ...sectionStyle(isMobile), borderTop: "1px solid #222222" }}>
        <div style={styles.sectionLabel}>independente</div>
        <div style={styles.founderBox}>
          <div>
            <h2 style={titleStyle(isMobile)}>Construída de forma independente</h2>
            <p style={styles.bodyText}>
              A L4CKOS surgiu de uma ideia entre amigos e hoje é construída de forma
              independente por Yan Bezerra.
            </p>
            <p style={styles.bodyText}>
              Yan é responsável pela direção do projeto, desenvolvimento da loja,
              estrutura digital, planejamento e evolução da marca.
            </p>
            <p style={styles.bodyText}>
              A construção acontece do zero, passando por identidade, produtos,
              fornecedores, tecnologia e experiência de compra.
            </p>
          </div>
          <aside style={styles.founderCard}>
            <span style={styles.founderName}>Yan Bezerra</span>
            <span style={styles.founderRole}>Fundador da L4CKOS</span>
          </aside>
        </div>
      </section>

      <section style={{ ...styles.closing, padding: isMobile ? "74px 18px 86px" : styles.closing.padding }}>
        <div style={styles.closingInner}>
          <h2 style={{ ...styles.closingTitle, fontSize: isMobile ? 40 : styles.closingTitle.fontSize }}>
            O caminho está só começando.
          </h2>
          <p style={styles.closingText}>
            A primeira coleção representa o início de uma construção maior.
          </p>
          <p style={styles.closingText}>
            Cada lançamento será uma nova parte desse caminho, explorando diferentes
            ideias, experiências e maneiras de expressar a identidade L4CKOS.
          </p>
          <p style={styles.closingCall}>Vista o caminho. Viva a aventura.</p>
          <Link to="/produtos" style={styles.ctaButton}>
            Conhecer os produtos
          </Link>
        </div>
      </section>
    </main>
  );
}

function sectionStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: 1180,
    margin: "0 auto",
    padding: isMobile ? "58px 18px" : "86px 40px",
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "220px minmax(0, 1fr)",
    gap: isMobile ? 24 : 64,
  };
}

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: "0 0 24px",
    color: "#f4f0e8",
    fontSize: isMobile ? 34 : 52,
    lineHeight: 1,
    fontWeight: 900,
    letterSpacing: 0,
  };
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#080808",
    color: "#f4f0e8",
    overflow: "hidden",
  },
  hero: {
    padding: "108px 40px 92px",
    borderBottom: "1px solid #222222",
    background: "radial-gradient(circle at 78% 28%, rgba(196, 24, 24, 0.16), transparent 34%), #080808",
  },
  heroInner: { maxWidth: 1180, margin: "0 auto" },
  kicker: {
    color: "#c9c1b6",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 34,
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "1.08fr 0.92fr",
    gap: 48,
    alignItems: "center",
  },
  heroTitle: {
    margin: "0 0 28px",
    color: "#ffffff",
    fontSize: 72,
    lineHeight: 0.96,
    fontWeight: 950,
    letterSpacing: 0,
    maxWidth: 760,
  },
  heroText: {
    maxWidth: 640,
    margin: "0 0 18px",
    color: "#c9c1b6",
    fontSize: 17,
    lineHeight: 1.8,
  },
  brandPanel: {
    position: "relative",
    minHeight: 430,
    border: "1px solid #2a2a2a",
    background: "#0f0f0f",
    overflow: "hidden",
  },
  routeLineOne: {
    position: "absolute",
    inset: "18% -18% auto auto",
    width: "92%",
    height: 1,
    background: "#393939",
    transform: "rotate(-18deg)",
    transformOrigin: "center",
  },
  routeLineTwo: {
    position: "absolute",
    inset: "auto auto 20% -20%",
    width: "105%",
    height: 1,
    background: "#c41818",
    opacity: 0.9,
    transform: "rotate(22deg)",
    transformOrigin: "center",
  },
  panelMark: {
    position: "absolute",
    top: 30,
    left: 30,
    color: "#ffffff",
    fontSize: 28,
    fontWeight: 950,
  },
  panelBrand: {
    position: "absolute",
    right: 26,
    bottom: 50,
    color: "#ffffff",
    fontSize: 58,
    fontWeight: 950,
    lineHeight: 1,
  },
  panelMicro: {
    position: "absolute",
    left: 30,
    bottom: 28,
    color: "#8f8981",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  red: { color: "#c41818" },
  sectionLabel: {
    color: "#c41818",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  textColumn: { maxWidth: 760 },
  bodyText: {
    margin: "0 0 18px",
    color: "#c9c1b6",
    fontSize: 16,
    lineHeight: 1.85,
  },
  statement: {
    padding: "104px 40px",
    borderTop: "1px solid #222222",
    borderBottom: "1px solid #222222",
    background: "#0d0d0d",
  },
  statementInner: { maxWidth: 1180, margin: "0 auto" },
  statementSmall: {
    display: "block",
    marginBottom: 26,
    color: "#c41818",
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  statementTitle: {
    margin: "0 0 32px",
    maxWidth: 940,
    color: "#ffffff",
    fontSize: 76,
    lineHeight: 0.96,
    fontWeight: 950,
  },
  statementText: {
    maxWidth: 680,
    margin: "0 0 16px",
    color: "#c9c1b6",
    fontSize: 17,
    lineHeight: 1.8,
  },
  principles: { borderTop: "1px solid #272727" },
  principleItem: {
    display: "grid",
    gridTemplateColumns: "70px minmax(0, 1fr)",
    gap: 24,
    padding: "30px 0",
    borderBottom: "1px solid #272727",
  },
  principleNumber: {
    color: "#c41818",
    fontSize: 15,
    fontWeight: 950,
  },
  principleTitle: {
    margin: "0 0 10px",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: 900,
  },
  principleText: {
    margin: 0,
    color: "#c9c1b6",
    fontSize: 15,
    lineHeight: 1.75,
  },
  founderBox: {
    maxWidth: 820,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 34,
  },
  founderCard: {
    maxWidth: 320,
    padding: "22px 0 0",
    borderTop: "1px solid #c41818",
  },
  founderName: {
    display: "block",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: 900,
    marginBottom: 6,
  },
  founderRole: {
    display: "block",
    color: "#8f8981",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  closing: {
    padding: "100px 40px 116px",
    background: "#050505",
    borderTop: "1px solid #222222",
  },
  closingInner: { maxWidth: 900, margin: "0 auto", textAlign: "center" },
  closingTitle: {
    margin: "0 0 24px",
    color: "#ffffff",
    fontSize: 64,
    lineHeight: 1,
    fontWeight: 950,
  },
  closingText: {
    maxWidth: 680,
    margin: "0 auto 14px",
    color: "#c9c1b6",
    fontSize: 16,
    lineHeight: 1.8,
  },
  closingCall: {
    margin: "34px 0 30px",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: 900,
  },
  ctaButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    padding: "0 24px",
    background: "#ffffff",
    color: "#080808",
    textDecoration: "none",
    border: "1px solid #ffffff",
    borderRadius: 6,
    fontWeight: 900,
    fontSize: 14,
  },
};
