// Initialize or deliberately rotate a database-backed TwinLabs administrator.
// No password or verifier is committed to Git, and .env is not modified.
import {randomBytes,scryptSync} from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if(process.env.TWIN_STORAGE==='memory'||process.env.TWIN_DB_SCHEMA!=='digital_twin'){
 console.error('Set TWIN_DB_SCHEMA=digital_twin and configure PostgreSQL (not memory mode) in local .env.');
 process.exit(1);
}
const reset=process.argv.includes('--reset');
const unexpected=process.argv.slice(2).filter(x=>x!=='--reset');
if(unexpected.length){console.error('Usage: npm run admin:db:setup [-- --reset]');process.exit(1);}
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{
 host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE||'digital_twin_18',
 ...(process.env.PGUSER?{user:process.env.PGUSER}:{}),
 ...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})
});
let client;
try{
 client=await pool.connect();
 await client.query('BEGIN');
 // Require the existing schema; never silently recreate or replace tables.
 const exists=await client.query("SELECT to_regclass('digital_twin.users') AS users,to_regclass('digital_twin.roles') AS roles");
 if(!exists.rows[0].users||!exists.rows[0].roles)throw Error('digital_twin.users / roles missing. Review and run the v3 schema setup on the intended database first.');
 const current=await client.query("SELECT user_id FROM digital_twin.users WHERE username='admin' FOR UPDATE");
 if(current.rowCount&&!reset){
   await client.query('ROLLBACK');
   console.log('Administrator already exists. No changes made. To deliberately rotate its password: npm run admin:db:setup -- --reset');
 }else{
   const password=randomBytes(24).toString('base64url');
   const salt=randomBytes(16).toString('hex');
   const hash='scrypt:'+salt+':'+scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
   const role=await client.query("INSERT INTO digital_twin.roles(role_name) VALUES('admin') ON CONFLICT(role_name) DO UPDATE SET role_name=EXCLUDED.role_name RETURNING role_id");
   if(current.rowCount){
     await client.query('UPDATE digital_twin.users SET password_hash=$1,role_id=$2 WHERE username=$3',[hash,role.rows[0].role_id,'admin']);
   }else{
     await client.query("INSERT INTO digital_twin.users(role_id,username,email,password_hash) VALUES($1,'admin','admin@twinlabs.invalid',$2)",[role.rows[0].role_id,hash]);
   }
   await client.query('COMMIT');
   console.log('Database administrator '+(current.rowCount?'password rotated':'created')+'.');
   console.log('Username: admin');
   console.log('Password: '+password);
   console.log('Store this password privately; it will not be shown again.');
   console.log('No administrator credentials were written to .env.');
 }
}catch(error){
 if(client)await client.query('ROLLBACK').catch(()=>{});
 console.error('Database administrator setup failed:',error.message);
 process.exitCode=1;
}finally{client?.release();await pool.end();}
