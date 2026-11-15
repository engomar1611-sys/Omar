import "dotenv/config";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {pool} from "../apps/api/src/db.js";
import {createDatabaseBackup,verifyDatabaseBackup} from "../apps/api/src/services/backups.js";

const execFileAsync=promisify(execFile);
const arg=process.argv.find(x=>x.startsWith("--file="));
const fileName=arg?.slice("--file=".length);
if(process.env.ALLOW_DATABASE_RESTORE!=="YES"){
  process.stderr.write("Restore blocked. Set ALLOW_DATABASE_RESTORE=YES only during a planned maintenance window.\n");
  process.exit(2);
}
if(!fileName){
  process.stderr.write("Usage: ALLOW_DATABASE_RESTORE=YES npm run restore -- --file=backup-file.dump\n");
  process.exit(2);
}
try{
  const registered=await pool.query("SELECT sha256 FROM system_backups WHERE file_name=$1 AND status='completed'",[fileName]);
  if(!registered.rowCount)throw new Error("Backup is not registered in this database; restore requires a verified registered backup");
  const verified=await verifyDatabaseBackup(fileName,registered.rows[0].sha256);
  const safety=await createDatabaseBackup(null);
  process.stdout.write("Safety backup created: "+safety.file_name+"\n");
  await pool.end();
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error("DATABASE_URL is required");
  await execFileAsync("pg_restore",["--clean","--if-exists","--no-owner","--no-acl","--exit-on-error","--dbname",databaseUrl,verified.filePath],{timeout:60*60*1000,maxBuffer:8*1024*1024});
  process.stdout.write("Database restore completed. Start the application service and run health and integrity checks.\n");
}catch(error){
  process.stderr.write((error?.message||String(error))+"\n");
  process.exitCode=1;
  await pool.end().catch(()=>{});
}
