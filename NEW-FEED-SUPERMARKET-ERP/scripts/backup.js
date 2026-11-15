import "dotenv/config";
import {createDatabaseBackup,backupDirectory} from "../apps/api/src/services/backups.js";
import {pool} from "../apps/api/src/db.js";

try{
  const backup=await createDatabaseBackup(null);
  process.stdout.write(JSON.stringify({backup,directory:backupDirectory()},null,2)+"\n");
}catch(error){
  process.stderr.write((error?.message||String(error))+"\n");
  process.exitCode=1;
}finally{
  await pool.end();
}
