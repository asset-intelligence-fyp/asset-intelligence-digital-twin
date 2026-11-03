import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { POINTS } from '../services/twin';
import { XeokitViewer } from '../viewer/XeokitViewer';
import { Eyebrow } from './UI';

export function DemoBuilding({selectedCode,onSelect,focusRequest=0,onFloorChange}:{selectedCode?:string;onSelect:(code:string)=>void;focusRequest?:number;onFloorChange?:(floor:string)=>void}) {
 const [full,setFull]=useState(false);
 useEffect(()=>{if(!full)return;const original=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFull(false)};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=original;window.removeEventListener('keydown',escape)}},[full]);
 return <section className={`model-card surface ${full?'model-fullscreen':''}`}>
  <div className="model-card-header"><div><strong>Digital twin · BIM viewer</strong><Eyebrow>FYP WHOLE BUILDING · {POINTS.filter(x=>x.guid).length} IFC SENSOR MARKERS</Eyebrow></div>
   <div className="model-actions"><button className="small-outline" onClick={()=>setFull(x=>!x)}>{full?<Minimize2 size={13}/>:<Maximize2 size={13}/>} {full?'Minimize':'Full screen'}</button></div></div>
  <div className="model-stage"><XeokitViewer selectedCode={selectedCode} focusRequest={focusRequest} onFloorChange={onFloorChange} onSensorSelect={onSelect}/></div>
 </section>;
}

