import "dotenv/config";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {createReadStream} from "node:fs";
import {mkdir,stat} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {pool} from "../db.js";

const execFileAsync=promisify(execFile);
export const backupDirectory=()=>path.resolve(process.env.BACKUP_DIR||path.join(process.cwd(),"data","backups"));

async function sha256File(file){
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest("hex");
}

export async function createDatabaseBackup(userId){
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error("DATABASE_URL is required for database backup");
  const dir=backupDirectory();
  await mkdir(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const fileName="newfeed-erp-"+stamp+".dump";
  const filePath=path.join(dir,fileName);
  await execFileAsync("pg_dump",["--format=custom","--no-owner","--no-acl","--file",filePath,databaseUrl],{timeout:30*60*1000,maxBuffer:1024*1024});
  const info=await stat(filePath);
  if(!info.size)throw new Error("pg_dump produced an empty backup file");
  const digest=await sha256File(filePath);
  const saved=await pool.query("INSERT INTO system_backups(file_name,sha256,size_bytes,status,created_by) VALUES($1,$2,$3,'completed',$4) RETURNING *",[fileName,digest,info.size,userId]);
  return saved.rows[0];
}

export async function verifyDatabaseBackup(fileName,expectedHash){
  if(typeof fileName!=="string"||!/^[a-zA-Z0-9._-]+\.dump$/.test(fileName))throw new Error("Invalid backup file name");
  const filePath=path.join(backupDirectory(),fileName);
  const digest=await sha256File(filePath);
  if(expectedHash&&digest!==expectedHash)throw new Error("Backup SHA-256 does not match the registered checksum");
  await execFileAsync("pg_restore",["--list",filePath],{timeout:120000,maxBuffer:4*1024*1024});
  return {filePath,sha256:digest};
}
