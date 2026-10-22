// Explicit fixture-only precision for the frozen candidate suites. MySQL 8
// rounds TIMESTAMP(0) fractions by default; their assertions expect truncation.
// Never changes global SQL mode; never permits TCP or non-fixture databases.
import { vi } from 'vitest';
vi.mock('mysql2/promise', async original => {
  const actual=await original<typeof import('mysql2/promise')>();
  function assertLocal(options: any) {
    if(process.env.L4CKOS_MYSQL_TEST!=='1' || !options || typeof options!=='object' ||
      !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(options.socketPath??'') ||
      (options.database && !/^l4ckos_test_recovery_[a-f0-9]{12}$/.test(options.database)))
      throw Error('LOCAL_PRECISION_FIXTURE_ONLY');
  }
  const sql="SET SESSION sql_mode=CONCAT_WS(',',NULLIF(@@session.sql_mode,''),'TIME_TRUNCATE_FRACTIONAL')";
  return {...actual,
    createConnection:async(options:any)=>{assertLocal(options);const c=await actual.createConnection(options);await c.query(sql);return c;},
    createPool:(options:any)=>{assertLocal(options);const p=actual.createPool(options);
      p.pool.on('connection',c=>{c.query(sql);});return p;},
  };
});
