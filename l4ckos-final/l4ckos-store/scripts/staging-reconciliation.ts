// No dotenv, target selectors, remote override, providers, or direct SQL.
import { FixedRailwayAdapter } from "../database/staging/railway";
import { prepareStaging, applyStaging } from "../database/staging/executor";
import { SchemaError } from "../database/schema/safety";
async function main() {
  const args = process.argv.slice(2), adapter = new FixedRailwayAdapter();
  if (args.length === 3 && args[0] === "prepare" && args[1] === "--commit" && /^[a-f0-9]{40}$/.test(args[2])) return prepareStaging(adapter, args[2]);
  if (args.length === 5 && args[0] === "apply" && args[1] === "--plan" && args[3] === "--confirm") return applyStaging(adapter, args[2], args[4]);
  throw new SchemaError("INVALID_STAGING_COMMAND_ARGUMENTS");
}
main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(JSON.stringify({ code: error instanceof SchemaError ? error.code : "STAGING_EXECUTOR_FAILED" })); process.exitCode = 1; });
