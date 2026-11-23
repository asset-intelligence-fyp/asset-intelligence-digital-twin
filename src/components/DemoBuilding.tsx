import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { XeokitViewer } from '../viewer/XeokitViewer';

export function DemoBuilding({selectedCode,onSelect,focusRequest=0,onFloorChange}:{selectedCode?:string;onSelect:(code:string)=>void;focusRequest?:number;onFloorChange?:(floor:string)=>void}) {
 const [full,setFull]=useState(false);
 useEffect(()=>{if(!full)return;const original=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFull(false)};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=original;window.removeEventListener('keydown',escape)}},[full]);
 return <section className={`model-card surface ${full?'model-fullscreen':''}`}>
  <div className="model-card-header"><div><strong>3D building viewer</strong></div><div className="bim-health-key" aria-label="Sensor status colours"><span><i className="bim-health-key-normal"/>Within demo limits</span><span><i className="bim-health-key-abnormal"/>Abnormal</span><span><i className="bim-health-key-unavailable"/>No data</span></div>
   <div className="model-actions"><button className="small-outline" onClick={()=>setFull(x=>!x)}>{full?<Minimize2 size={13}/>:<Maximize2 size={13}/>} {full?'Minimize':'Full screen'}</button></div></div>
  <div className="model-stage"><XeokitViewer selectedCode={selectedCode} focusRequest={focusRequest} onFloorChange={onFloorChange} onSensorSelect={onSelect}/></div>
 </section>;
}

