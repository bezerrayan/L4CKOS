import { describe, expect, it, vi } from "vitest";
import { securityLog } from "./security";
describe("security log token redaction", () => {
  it.each(["short", "synthetic-long-token-never-print"])("never discloses token material", token => {
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      securityLog("warn","synthetic",{token,hasTokenHeader:true,password:"synthetic",secret:"synthetic",requestIp:"127.0.0.1"});
      const details=log.mock.calls[0][1];
      expect(details).toMatchObject({token:"[redacted]",hasTokenHeader:true,password:"[redacted]",secret:"[redacted]",requestIp:"127.0.0.*"});
      expect(JSON.stringify(details)).not.toContain(token);
    } finally {log.mockRestore();}
  });
});
