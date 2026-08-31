import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const read = name => String(process.env[name] ?? "").trim();
const fail = message => { throw new Error(`STAGING_SEED_REFUSED: ${message}`); };

if (read("APP_ENV") !== "staging") fail("APP_ENV must be staging");
const databaseUrl = read("DATABASE_URL");
if (!databaseUrl) fail("DATABASE_URL is required");
const url = new URL(databaseUrl);
const databaseName = url.pathname.replace(/^\//, "");
if (url.hostname !== read("EXPECTED_DATABASE_HOST") || databaseName !== read("EXPECTED_DATABASE_NAME")) fail("database does not match EXPECTED_DATABASE_HOST/NAME");
if (!/staging/i.test(databaseName)) fail("database name must contain staging");
if (url.hostname === read("PRODUCTION_DATABASE_HOST") || databaseName === read("PRODUCTION_DATABASE_NAME")) fail("production database target detected");

const clientEmail = read("STAGING_CLIENT_EMAIL").toLowerCase();
const adminEmail = read("STAGING_ADMIN_EMAIL").toLowerCase();
const clientPassword = read("STAGING_CLIENT_PASSWORD");
const adminPassword = read("STAGING_ADMIN_PASSWORD");
if (!clientEmail.endsWith("@example.test") || !adminEmail.endsWith("@example.test")) fail("seed accounts must use the reserved example.test domain");
if (clientPassword.length < 12 || adminPassword.length < 12 || clientPassword === adminPassword) fail("provide two distinct passwords with at least 12 characters through the environment");

const connection = await mysql.createConnection(databaseUrl);
await connection.beginTransaction();

async function upsertUser(email, role, name) {
  const openId = `local:${email}`;
  await connection.execute(
    `INSERT INTO users (openId,name,email,loginMethod,role,isVip,isBlocked,sessionVersion)
     VALUES (?,?,?,'local-staging',?,0,0,1)
     ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),loginMethod='local-staging',role=VALUES(role),isBlocked=0`,
    [openId, name, email, role],
  );
  const [[user]] = await connection.execute("SELECT id FROM users WHERE openId=?", [openId]);
  return Number(user.id);
}

async function upsertCredential(userId, email, password) {
  const hash = await bcrypt.hash(password, 12);
  await connection.execute(
    `INSERT INTO localAuthUsers (userId,email,passwordHash) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE userId=VALUES(userId),passwordHash=VALUES(passwordHash)`,
    [userId, email, hash],
  );
}

async function upsertProduct(product) {
  const [rows] = await connection.execute("SELECT id FROM products WHERE name=? LIMIT 1", [product.name]);
  if (rows.length) {
    await connection.execute(
      "UPDATE products SET description=?,fullDescription=?,category=?,price=?,optionColors=?,optionSizes=?,sizeType=?,imageUrl=?,stock=? WHERE id=?",
      [product.description, product.fullDescription, product.category, product.price, product.optionColors, product.optionSizes, product.sizeType, product.imageUrl, product.stock, rows[0].id],
    );
    return Number(rows[0].id);
  }
  const [result] = await connection.execute(
    "INSERT INTO products (name,description,fullDescription,category,price,optionColors,optionSizes,sizeType,imageUrl,stock) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [product.name, product.description, product.fullDescription, product.category, product.price, product.optionColors, product.optionSizes, product.sizeType, product.imageUrl, product.stock],
  );
  return Number(result.insertId);
}

try {
  const clientId = await upsertUser(clientEmail, "user", "Cliente Staging");
  const adminId = await upsertUser(adminEmail, "admin", "Admin Staging");
  await upsertCredential(clientId, clientEmail, clientPassword);
  await upsertCredential(adminId, adminEmail, adminPassword);

  await connection.execute("DELETE FROM userAddresses WHERE userId=? AND label='Endereco sintetico staging'", [clientId]);
  await connection.execute(
    "INSERT INTO userAddresses (userId,label,recipient,zipCode,street,number,complement,neighborhood,city,state,isDefault) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
    [clientId, "Endereco sintetico staging", "Cliente Staging", "70000000", "Rua de Teste", "100", "Ambiente isolado", "Centro de Testes", "Brasilia", "DF"],
  );

  const appUrl = read("APP_URL").replace(/\/+$/, "");
  const common = { description: "Fixture sintético para homologação isolada.", fullDescription: "Dados fictícios. Não representa produto ou cliente real.", category: "staging", sizeType: "alpha" };
  const highStockId = await upsertProduct({ ...common, name: "[STAGING] Produto simples estoque alto", price: 9900, optionColors: null, optionSizes: null, imageUrl: `${appUrl}/images/camisa.png`, stock: 100 });
  const variantProductId = await upsertProduct({ ...common, name: "[STAGING] Produto com tamanho e cor", price: 12900, optionColors: JSON.stringify(["Preto", "Verde"]), optionSizes: JSON.stringify(["M", "G"]), imageUrl: `${appUrl}/images/camisa.png`, stock: 40 });
  const oneStockId = await upsertProduct({ ...common, name: "[STAGING] Ultima unidade", price: 7900, optionColors: null, optionSizes: null, imageUrl: `${appUrl}/images/camisa.png`, stock: 1 });
  const noStockId = await upsertProduct({ ...common, name: "[STAGING] Sem estoque", price: 5900, optionColors: null, optionSizes: null, imageUrl: `${appUrl}/images/camisa.png`, stock: 0 });

  await connection.execute("DELETE FROM productVariants WHERE productId=?", [variantProductId]);
  for (const [size, color, stock] of [["M", "Preto", 10], ["G", "Preto", 10], ["M", "Verde", 10], ["G", "Verde", 10]]) {
    await connection.execute(
      "INSERT INTO productVariants (productId,name,sku,size,color,optionKey,price,stock) VALUES (?,?,?,?,?,?,?,?)",
      [variantProductId, `${color} ${size}`, `STG-${color.slice(0, 3).toUpperCase()}-${size}`, size, color, `size:${size.toLowerCase()}|color:${color.toLowerCase()}`, 12900, stock],
    );
  }

  for (const productId of [highStockId, variantProductId, oneStockId, noStockId]) {
    await connection.execute("DELETE FROM productImages WHERE productId=?", [productId]);
    await connection.execute("INSERT INTO productImages (productId,imageUrl,color,alt,`order`) VALUES (?,?,?,?,0)", [productId, `${appUrl}/images/camisa.png`, null, "Imagem sintética de staging"]);
  }
  await connection.execute("INSERT INTO productImages (productId,imageUrl,color,alt,`order`) VALUES (?,?,?,?,1)", [variantProductId, `${appUrl}/images/camisa.png`, "Preto", "Variação preta sintética"]);

  await connection.execute(
    `INSERT INTO coupons (code,type,value,maxUses,usedCount,isActive) VALUES ('STAGING10','percent',10,1000,0,1)
     ON DUPLICATE KEY UPDATE type='percent',value=10,maxUses=1000,usedCount=0,isActive=1`,
  );
  const [banners] = await connection.execute("SELECT id FROM promoBanners WHERE title='[STAGING] Banner de homologacao' LIMIT 1");
  if (banners.length) {
    await connection.execute("UPDATE promoBanners SET description=?,ctaLabel='Ver fixtures',imageUrl=?,mobileImageUrl=?,imageAlt=?,linkUrl='/produtos',discountText='TESTE',discountLabel='STG',sortOrder=0,isActive=1 WHERE id=?", ["Banner exclusivamente sintético.", `${appUrl}/images/camisa.png`, `${appUrl}/images/camisa.png`, "Banner sintético de staging", banners[0].id]);
  } else {
    await connection.execute("INSERT INTO promoBanners (badge,title,description,ctaLabel,imageUrl,mobileImageUrl,imageAlt,linkUrl,discountText,discountLabel,sortOrder,isActive) VALUES ('STAGING','[STAGING] Banner de homologacao','Banner exclusivamente sintético.','Ver fixtures',?,?,?,'/produtos','TESTE','STG',0,1)", [`${appUrl}/images/camisa.png`, `${appUrl}/images/camisa.png`, "Banner sintético de staging"]);
  }

  await connection.commit();
  console.log(JSON.stringify({ ok: true, database: databaseName, accounts: { client: clientEmail, admin: adminEmail }, fixtures: { products: 4, variants: 4, coupon: "STAGING10", banner: 1, address: 1 }, passwords: "supplied through environment; never printed" }, null, 2));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
