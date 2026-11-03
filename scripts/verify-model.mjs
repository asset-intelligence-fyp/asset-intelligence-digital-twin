import fs from 'node:fs';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
const registry=JSON.parse(fs.readFileSync(new URL('../shared/sensorRegistry.json',import.meta.url),'utf8'));
const data=fs.readFileSync(new URL('../public/models/FYP_WholeBuilding_18Sensors.xkt',import.meta.url));
assert.equal(data.readUInt32LE(0)&0x7fffffff,12);
const count=data.readUInt32LE(4);let offset=(count+2)*4;const parts=[];
for(let i=0;i<count;i++){const length=data.readUInt32LE((i+2)*4);parts.push(inflateSync(data.subarray(offset,offset+length)));offset+=length;}
assert.equal(offset,data.length);
const metadata=JSON.parse(parts[0].toString());const entities=new Set(JSON.parse(parts[25].toString()));
const byId=new Map(metadata.metaObjects.map(m=>[m.id,m]));
for(const p of registry){assert.ok(entities.has(p.guid),p.code+' geometry absent');let meta=byId.get(p.guid);const seen=new Set();while(meta&&meta.type!=='IfcBuildingStorey'&&!seen.has(meta.id)){seen.add(meta.id);meta=byId.get(meta.parent)}assert.equal(meta?.name,p.floor,p.code+' storey mismatch');}
console.log(`Verified ${entities.size} drawable objects and all 18 sensor geometries / storey links in delivered XKT`);
