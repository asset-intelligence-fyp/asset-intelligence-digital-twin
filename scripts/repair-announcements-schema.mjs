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
 await pool.query(`CREATE TABLE IF NOT EXISTS digital_twin.announcements (
  announcement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_by TEXT NOT NULL,updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS announcements_status_published_idx ON digital_twin.announcements(status,published_at DESC)');
 console.log('Announcements storage ready. Existing TwinLabs records retained.');
}catch(e){console.error('Announcements schema setup failed:',e.message);process.exitCode=1}finally{await pool.end()}
