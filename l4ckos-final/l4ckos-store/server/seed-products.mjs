import { drizzle } from "drizzle-orm/mysql2";
import { createMysqlConnectionOptions } from "./database/mysqlTls.mjs";
import { products } from "../drizzle/schema.ts";

const db = drizzle({ connection: createMysqlConnectionOptions(process.env.DATABASE_URL) });

const seedProducts = [
  {
    name: "Camiseta Premium",
    category: "vestuario",
    price: 8990, // R$ 89.90
    description: "Camiseta de alta qualidade em algodão 100%",
    fullDescription: "Camiseta confeccionada em algodão 100% premium, com acabamento impecável. Perfeita para o dia a dia ou para usar em atividades ao ar livre.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/JXy9jMBcgXzXdfFGrJALXw-img-1_1770397704000_na1fn_cHJvZHVjdC0xLWNhbWlzZXRh.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 50,
  },
  {
    name: "Lenço Personalizado",
    category: "vestuario",
    price: 5990, // R$ 59.90
    description: "Lenço tradicional com detalhes em ouro",
    fullDescription: "Lenço confeccionado em tecido de alta qualidade com acabamento em ouro. Ideal para complementar seu uniforme ou usar em atividades especiais.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/JXy9jMBcgXzXdfFGrJALXw-img-2_1770397704000_na1fn_cHJvZHVjdC0yLWxlbmNv.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 30,
  },
  {
    name: "Garrafa Térmica",
    category: "hidratacao",
    price: 12990, // R$ 129.90
    description: "Garrafa isolada de 750ml em aço inoxidável",
    fullDescription: "Garrafa térmica de alta performance com isolamento duplo em vácuo. Mantém bebidas quentes por até 12 horas e frias por até 24 horas.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/JXy9jMBcgXzXdfFGrJALXw-img-3_1770397700000_na1fn_cHJvZHVjdC0zLWdhcnJhZmE.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 25,
  },
  {
    name: "Bússola Profissional",
    category: "acessorios",
    price: 14990, // R$ 149.90
    description: "Bússola de latão com agulha magnética de precisão",
    fullDescription: "Bússola profissional de latão com agulha magnética de alta precisão. Inclui escala de medição e protetor. Ideal para navegação e orientação em trilhas.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/JXy9jMBcgXzXdfFGrJALXw-img-4_1770397709000_na1fn_cHJvZHVjdC00LWJ1c3NvbGE.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 15,
  },
  {
    name: "Mochila 40L",
    category: "acessorios",
    price: 29990, // R$ 299.90
    description: "Mochila de trekking com compartimentos organizadores",
    fullDescription: "Mochila de trekking de 40 litros com estrutura ergonômica, compartimentos organizadores e alças ajustáveis. Fabricada em nylon resistente com costuras reforçadas.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/JXy9jMBcgXzXdfFGrJALXw-img-5_1770397708000_na1fn_cHJvZHVjdC01LW1vY2hpbGE.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 10,
  },
  {
    name: "Caneca Térmica",
    category: "hidratacao",
    price: 7990, // R$ 79.90
    description: "Caneca térmica 350ml com tampa hermética",
    fullDescription: "Caneca térmica em aço inoxidável com isolamento duplo. Mantém bebidas quentes ou frias. Inclui tampa hermética à prova de vazamentos.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/bkAGmACi8gxE6kAWky60P5-img-1_1770397736000_na1fn_cHJvZHVjdC02LWNhbmVjYQ.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 40,
  },
  {
    name: "Cinto Canvas",
    category: "acessorios",
    price: 6990, // R$ 69.90
    description: "Cinto em canvas com fivela de metal resistente",
    fullDescription: "Cinto confeccionado em canvas de alta qualidade com fivela de metal resistente. Ajustável e durável para uso em atividades outdoor.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/bkAGmACi8gxE6kAWky60P5-img-2_1770397732000_na1fn_cHJvZHVjdC03LWNpbnRv.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 35,
  },
  {
    name: "Kit Navegação",
    category: "acessorios",
    price: 24990, // R$ 249.90
    description: "Kit completo com mapa, bússola e caderneta",
    fullDescription: "Kit completo de navegação incluindo mapa topográfico, bússola profissional, caderneta à prova d'água e caneta. Perfeito para expedições e trilhas.",
    imageUrl: "https://private-us-east-1.manuscdn.com/sessionFile/dcndoke2KcrgXhJcfkLXhQ/sandbox/bkAGmACi8gxE6kAWky60P5-img-3_1770397737000_na1fn_cHJvZHVjdC04LW1hcGEtYnVzc29sYQ.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80",
    stock: 20,
  },
];

async function seed() {
  try {
    console.log("Seeding products...");
    
    for (const product of seedProducts) {
      await db.insert(products).values(product);
      console.log(`✓ Created product: ${product.name}`);
    }
    
    console.log("✅ Seeding completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
