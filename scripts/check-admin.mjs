import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
if(process.env.TWIN_STORAGE==='memory')throw Error('Admin Database requires PostgreSQL, not memory mode.');
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{
 host:process.env.PGHOST||'localhost',
 port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE||'digital_twin_18',
 ...(process.env.PGUSER?{user:process.env.PGUSER}:{}),
 ...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})
});
try{
 const result=await pool.query(`SELECT u.username, r.role_name
 FROM digital_twin.users u JOIN digital_twin.roles r ON r.role_id=u.role_id
 WHERE r.role_name='admin' ORDER BY u.username LIMIT 10`);
 console.log('PostgreSQL administrator records: '+result.rowCount);
 for(const user of result.rows)console.log('  '+user.username+' ('+user.role_name+')');
 if(!result.rowCount){console.error('No administrator configured; run npm run admin:setup');process.exitCode=1;}
 const port=Number(process.env.SERVER_PORT||3001);
 try{
  const health=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(4000)});
  const status=await health.json();
  console.log('Website API: '+(status.ok?'ready':'not ready')+'; storage: '+status.storage+'; schema: '+status.schema);
  if(!status.ok||status.storage!=='postgresql'||status.schema!=='digital_twin')process.exitCode=1;
 }catch{console.warn('Website not currently running; start npm run host:lan to check the web API.');}
}catch(e){console.error('Admin database verification failed:',e.message);process.exitCode=1;}
finally{await pool.end();}
