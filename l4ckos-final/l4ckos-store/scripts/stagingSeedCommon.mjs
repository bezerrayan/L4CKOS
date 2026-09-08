import bcrypt from "bcryptjs";

export const read = (name, environment = process.env) => String(environment[name] ?? "").trim();

export const fail = message => {
  throw new Error(`STAGING_SEED_REFUSED: ${message}`);
};

export function assertStagingSeedTarget(environment = process.env) {
  if (read("APP_ENV", environment) !== "staging") fail("APP_ENV must be staging");

  const databaseUrl = read("DATABASE_URL", environment);
  if (!databaseUrl) fail("DATABASE_URL is required");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL must be a valid URL");
  }

  const databaseName = url.pathname.replace(/^\//, "");
  if (url.hostname !== read("EXPECTED_DATABASE_HOST", environment) || databaseName !== read("EXPECTED_DATABASE_NAME", environment)) {
    fail("database does not match EXPECTED_DATABASE_HOST/NAME");
  }
  if (!/staging/i.test(databaseName)) fail("database name must contain staging");
  if (url.hostname === read("PRODUCTION_DATABASE_HOST", environment) || databaseName === read("PRODUCTION_DATABASE_NAME", environment)) {
    fail("production database target detected");
  }

  return { databaseUrl, databaseName };
}

export function readClientFixtureInput(environment = process.env) {
  const email = read("STAGING_CLIENT_EMAIL", environment).toLowerCase();
  const password = read("STAGING_CLIENT_PASSWORD", environment);
  const appUrl = read("APP_URL", environment).replace(/\/+$/, "");

  if (!email.endsWith("@example.test")) fail("seed client account must use the reserved example.test domain");
  if (password.length < 12) fail("STAGING_CLIENT_PASSWORD must have at least 12 characters");
  if (!appUrl) fail("APP_URL is required");

  return { email, password, appUrl };
}

export async function upsertStagingClientFixture(connection, { email, password }) {
  const openId = `local:${email}`;
  await connection.execute(
    `INSERT INTO users (openId,name,email,loginMethod,role,isVip,isBlocked,sessionVersion)
     VALUES (?,?,?,'local-staging','user',0,0,1)
     ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),loginMethod='local-staging',role='user',isBlocked=0`,
    [openId, "Cliente Staging", email],
  );
  const [[user]] = await connection.execute("SELECT id FROM users WHERE openId=?", [openId]);
  const userId = Number(user.id);
  const passwordHash = await bcrypt.hash(password, 12);
  await connection.execute(
    `INSERT INTO localAuthUsers (userId,email,passwordHash) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE userId=VALUES(userId),passwordHash=VALUES(passwordHash)`,
    [userId, email, passwordHash],
  );
  await connection.execute("DELETE FROM userAddresses WHERE userId=? AND label='Endereco sintetico staging'", [userId]);
  await connection.execute(
    "INSERT INTO userAddresses (userId,label,recipient,zipCode,street,number,complement,neighborhood,city,state,isDefault) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
    [userId, "Endereco sintetico staging", "Cliente Staging", "70000000", "Rua de Teste", "100", "Ambiente isolado", "Centro de Testes", "Brasilia", "DF"],
  );

  return { userId };
}
