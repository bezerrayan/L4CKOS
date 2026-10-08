import { describe, expect, it, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { FixedPreorderRailwayAdapter } from "../../database/staging0021/railway";
import { TARGET } from "../../database/staging0021/policy";
const state = vi.hoisted(() => ({ change: {} as Record<string,string>, calls: [] as { args: string[]; env: any }[], probe: false, payloadChecked: false }));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (file: string, args: string[], options: any) => {
    if (file !== "/home/yan/.railway/bin/railway") return actual.execFileSync(file,args,options);
    state.calls.push({args,env:options.env});
    const project = state.change.projectId || "2bb90c8e-eb65-43ee-826b-f93750f0499c";
    const environment = "15545eee-bc02-4b70-afc4-19a5db9e6f46";
    const app = "9f1c7705-f2f9-48cf-b957-8f63a6bba4db", mysql = "bcda5d78-4a0d-4682-8659-8316847addb7";
    if (args[0] === "status") return JSON.stringify({ id: project, name: state.change.projectName || "l4ckos-staging", environments: { edges: [{ node: { id: environment, name: "production", serviceInstances: { edges: [{ node: { serviceId: app, serviceName: state.change.service || "l4ckos-staging", domains: {customDomains:[{domain:state.change.backendHost || "api-staging.l4ckos.com.br"}]}, activeDeployments:[{id:"11111111-1111-1111-1111-111111111111"}] } }, {node:{ serviceId:mysql, serviceName:"mysql" }}] } } }] } });
    if (args[0] === "private-network") return JSON.stringify({ serviceId:mysql, domain:state.change.privateNetworkDomain || "mysql.railway.internal" });
    const service = args[args.indexOf("--service")+1];
    return JSON.stringify({ RAILWAY_PROJECT_ID:project, RAILWAY_ENVIRONMENT_ID:environment, RAILWAY_SERVICE_ID:service, ...(service===app?{DATABASE_URL:state.change.database || "mysql://root:synthetic@mysql.railway.internal/app"}:{MYSQL_URL:"mysql://root:synthetic@mysql.railway.internal/app"}) });
  }, spawnSync: (file: string,args: string[],options: any) => {
    if (file !== "/home/yan/.railway/bin/railway") return actual.spawnSync(file,args,options);
    if (!state.probe) throw Error("NO_REMOTE_TRANSPORT_ALLOWED_IN_TEST");
    expect(args.slice(-2)).toEqual(["node","--input-type=commonjs"]);
    const checked = actual.spawnSync(process.execPath,["--input-type=commonjs"],{cwd:process.cwd(),env:{PATH:process.env.PATH},input:options.input,encoding:"utf8"});
    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout.trim())).toMatchObject({ok:false,code:"STAGING_RUNTIME_IDENTITY_MISMATCH"});
    state.payloadChecked = true;
    return { status:0,stdout:JSON.stringify({ok:true,value:{offlineBundleVerified:true}}),stderr:"" };
  } };
});
afterEach(() => { state.change={};state.calls=[];state.probe=false;state.payloadChecked=false;vi.unstubAllEnvs(); });
describe("fixed 0021 Railway transport, offline API fixtures only", () => {
  it("verifies API/service/private database independently of spoofed local env", async () => {
    vi.stubEnv("DATABASE_URL","mysql://synthetic@production.invalid/prod");vi.stubEnv("RAILWAY_PROJECT_ID","wrong");vi.stubEnv("ALLOW_REMOTE","true");
    const identity=await new FixedPreorderRailwayAdapter().identity();
    expect(identity.projectId).toBe(TARGET.projectId);
    for(const call of state.calls){expect(call.args).toContain(TARGET.projectId);expect(call.env.DATABASE_URL).toBeUndefined();expect(call.env.RAILWAY_PROJECT_ID).toBeUndefined();}
  });
  it.each([{projectName:"l4ckos-production"},{projectName:"wrong"},{projectId:"wrong"},{service:"wrong"},{backendHost:"l4ckos.com.br"},{database:"mysql://root:synthetic@production.railway.internal/app"},{privateNetworkDomain:"production.railway.internal"}])("rejects mismatched evidence %j",async change=>{
    state.change=change;await expect(new FixedPreorderRailwayAdapter().identity()).rejects.toThrow();
  });
  // The packaging probe needs the new implementation committed; runs again after the commit.
  it.skipIf(execFileSync("git",["status","--porcelain","--","database/staging0021"],{encoding:"utf8"}).trim()!=="")("builds the exact Git bundle and executes it locally, without any DB/SSH/network access",async()=>{
    state.probe=true;
    const adapter=new FixedPreorderRailwayAdapter();await adapter.identity();
    expect(await (adapter as any).remote("inspect")).toEqual({offlineBundleVerified:true});
    expect(state.payloadChecked).toBe(true);
  });
});
