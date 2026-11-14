import "dotenv/config";
import {readdir,readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";

const {Pool}=pg;
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try{
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    migration_name VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files=["schema.sql",...(await readdir(path.join(root,"database"))).filter(x=>/^\\d{3}_.+\\.sql$/.test(x)).sort()];
  for(const file of files){
    const applied=await client.query("SELECT 1 FROM schema_migrations WHERE migration_name=$1",[file]);
    if(applied.rowCount){console.log("SKIP",file);continue;}
    const source=await readFile(path.join(root,"database",file),"utf8");
    console.log("APPLY",file);
    await client.query("BEGIN");
    try{
      await client.query(source);
      await client.query("INSERT INTO schema_migrations(migration_name) VALUES($1)",[file]);
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      throw new Error("Migration failed: "+file+"; "+error.message,{cause:error});
    }
  }
  console.log("Database migrations completed.");
}catch(error){
  console.error(error);
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
