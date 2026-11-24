import fs from 'node:fs';
import {registry} from './sensorContract.js';
export const definitions=JSON.parse(fs.readFileSync(new URL('../shared/sensorDefinitions.json',import.meta.url),'utf8'));
const points=new Map(registry.map(p=>[p.code,p]));
export function classifyReading(row){
 const point=points.get(row.point_code),d=definitions[point.sensorType];
 if(row.value===null)return {rule:'missing',level:'Warning',reason:'Measurement unavailable (missing source quality).'};
 if(point.sensorType==='water_leakage'&&row.value===1)return {rule:'leak',level:'Critical',reason:'Leak flag is active (1 = leak detected, 0 = dry).'};
 if(d.high!==undefined&&row.value>d.high)return {rule:'high',level:row.value>=d.criticalHigh?'Critical':'Warning',reason:`${point.label} exceeds the demonstration threshold of ${d.high} ${point.unit}.`};
 if(d.low!==undefined&&row.value<d.low)return {rule:'low',level:'Warning',reason:`${point.label} is below the demonstration threshold of ${d.low} ${point.unit}.`};
 return null;
}
export const alertColumns=`a.*,v.severity_name,s.status_name`;
export function toEvent(a){
 const p=points.get(a.point_code);return {id:Number(a.alert_id),point_code:a.point_code,title:`${p?.label||a.point_code} · ${{leak:'Leak detected',high:'High reading',low:'Low reading',missing:'Missing reading'}[a.alert_type]||a.alert_type}`,level:a.severity_name==='Critical'?'Critical':'Warning',description:a.message,source:p?.assetId,zone:p?.floor,time:a.triggered_at,status_name:a.status_name,acknowledged:['Acknowledged','Closed'].includes(a.status_name),synthetic:true,automatic:a.detector==='threshold_v1',detector:a.detector,resolved_at:a.resolved_at,rule:a.alert_type,reading_snapshot:a.evidence?.at(-1),evidence:a.evidence||[],replay_id:a.replay_id};
}
export function createAlertService(schema){
 if(!['twin18','digital_twin'].includes(schema))throw Error('Invalid schema');
 let records=[],nextId=1;
 const joined=`FROM ${schema}.alerts a JOIN ${schema}.alert_severity v USING(alert_severity_id) JOIN ${schema}.alert_status s USING(alert_status_id)`;
 const list=async(db)=>db?(await db.query(`SELECT ${alertColumns} ${joined} WHERE a.detector='threshold_v1' ORDER BY a.alert_id DESC LIMIT 500`)).rows.map(toEvent):records.slice().reverse().map(toEvent);
 // Called inside the SAME transaction as readings. Publish only after COMMIT.
 const process=async(db,batch,history,replay)=>{
  const changes=[];
  for(const row of batch){
   const p=points.get(row.point_code),previous=history.filter(x=>x.point_code===row.point_code);
   if(previous.some(x=>Date.parse(x.timestamp)>=Date.parse(row.timestamp)))continue;
   const condition=classifyReading(row);
   const active=db?(await db.query(`SELECT ${alertColumns} ${joined} WHERE a.point_code=$1 AND a.detector='threshold_v1' AND a.resolved_at IS NULL FOR UPDATE OF a`,[row.point_code])).rows:records.filter(x=>x.point_code===row.point_code&&!x.resolved_at);
   for(const old of active){
    if(old.replay_id===replay&&old.alert_type===condition?.rule){
     if(old.severity_name!==condition.level&&condition.level==='Critical'){
      if(db)await db.query(`UPDATE ${schema}.alerts SET alert_severity_id=(SELECT alert_severity_id FROM ${schema}.alert_severity WHERE severity_name='Critical') WHERE alert_id=$1`,[old.alert_id]);
      old.severity_name='Critical';changes.push(toEvent(old));
     }
     continue;
    }
    const resolved=new Date().toISOString();
    if(db)await db.query(`UPDATE ${schema}.alerts SET resolved_at=$2 WHERE alert_id=$1`,[old.alert_id,resolved]);
    old.resolved_at=resolved;changes.push(toEvent(old));
   }
   if(!condition||active.some(x=>!x.resolved_at&&x.replay_id===replay&&x.alert_type===condition.rule))continue;
   const evidence=[...previous.filter(x=>Date.parse(x.timestamp)<Date.parse(row.timestamp)).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-5),row].map(x=>({point_code:x.point_code,value:x.value,timestamp:x.timestamp,quality:x.quality}));
   const message=`${p.locationLabel}: ${condition.reason} Rule-based synthetic alert; inspect the readings before drawing a diagnosis.`;
   let saved;
   if(db){
    const r=await db.query(`INSERT INTO ${schema}.alerts(point_code,alert_severity_id,alert_status_id,alert_type,message,triggered_at,replay_id,detector,evidence) VALUES($1,(SELECT alert_severity_id FROM ${schema}.alert_severity WHERE severity_name=$2),(SELECT alert_status_id FROM ${schema}.alert_status WHERE status_name='New'),$3,$4,$5,$6,'threshold_v1',$7::jsonb) RETURNING *`,[row.point_code,condition.level==='Critical'?'Critical':'Medium',condition.rule,message,row.timestamp,replay,JSON.stringify(evidence)]);
    saved={...r.rows[0],severity_name:condition.level,status_name:'New'};
   }else{saved={alert_id:nextId++,point_code:row.point_code,alert_type:condition.rule,message,triggered_at:row.timestamp,replay_id:replay,detector:'threshold_v1',evidence,severity_name:condition.level,status_name:'New',resolved_at:null};records.push(saved);}
   changes.push(toEvent(saved));
  }
  if(records.length>500)records=records.slice(-500);
  return changes;
 };
 const acknowledge=async(db,id,status)=>{
  if(db){const updated=await db.query(`UPDATE ${schema}.alerts SET alert_status_id=(SELECT alert_status_id FROM ${schema}.alert_status WHERE status_name=$2) WHERE alert_id=$1 AND detector='threshold_v1' RETURNING alert_id`,[id,status]);if(!updated.rows.length)return null;return (await db.query(`SELECT ${alertColumns} ${joined} WHERE a.alert_id=$1`,[id])).rows.map(toEvent)[0];}
  const item=records.find(x=>x.alert_id===id);if(!item)return null;item.status_name=status;return toEvent(item);
 };
 return {list,process,acknowledge};
}
