import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {XKTModel,writeXKTModelToArrayBuffer} from '@xeokit/xeokit-convert';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'twin18-ifc-'));
const source=path.join(dir,'building.ifc');
const model=new XKTModel({modelId:'fyp_whole_building'});
const guids=new Set();let triangles=0;
try {
 fs.writeFileSync(source,zlib.gunzipSync(fs.readFileSync(path.join(root,'public/models/FYP_WholeBuilding_18Sensors.ifc.gz'))));
 const child=spawn(process.env.PYTHON||'python3',[path.join(root,'scripts/export-ifc-geometry.py'),source],{stdio:['ignore','pipe','inherit']});
 let spawnError;const finished=new Promise(resolve=>{child.on('error',error=>{spawnError=error;resolve(-1)});child.on('exit',resolve)});
 for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
  const r=JSON.parse(line);
  if(r.kind==='meta')model.createMetaObject({metaObjectId:r.id,metaObjectName:r.name,metaObjectType:r.type,parentMetaObjectId:r.parent||undefined});
  else if(r.indices.length){
   model.createGeometry({geometryId:r.id,primitiveType:'triangles',positions:r.positions,indices:r.indices});
   model.createMesh({meshId:r.id,geometryId:r.id,color:r.color,opacity:r.opacity});
   model.createEntity({entityId:r.id,meshIds:[r.id]});guids.add(r.id);triangles+=r.indices.length/3;
  }
 }
 const code=await finished;if(code!==0)throw spawnError||Error('IFC tessellation failed: '+code);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'shared/sensorRegistry.json'),'utf8'));
 const missing=registry.filter(p=>!guids.has(p.guid));if(missing.length)throw Error('Missing sensor geometry: '+missing.map(p=>p.code).join(', '));
 await model.finalize();
 const output=path.join(root,'public/models/FYP_WholeBuilding_18Sensors.xkt');
 fs.writeFileSync(output,Buffer.from(writeXKTModelToArrayBuffer(model,null,{texturesSize:0},{zip:true})));
 const audit={converter:'IfcOpenShell tessellation + xeokit XKT',objects:guids.size,triangles,sensorMarkers:registry.length,missingSensorMarkers:[],excludedTypes:['IfcSpace','IfcOpeningElement'],linearDeflectionMetres:0.01,axes:'IFC Z-up converted to viewer Y-up',xktBytes:fs.statSync(output).size};
 fs.writeFileSync(path.join(root,'public/models/model-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(audit);
} finally {fs.rmSync(dir,{recursive:true,force:true})}
