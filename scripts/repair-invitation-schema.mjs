import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{
 host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE||'digital_twin_18',
 ...(process.env.PGUSER?{user:process.env.PGUSER}:{}),
 ...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})
});
try{
 await pool.query("ALTER TABLE digital_twin.access_invites ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'not_configured'");
 await pool.query("ALTER TABLE digital_twin.access_invites ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ");
 console.log('Invitation email delivery metadata ready.');
}catch(e){console.error('Invitation schema update failed:',e.message);process.exitCode=1}finally{await pool.end()}
