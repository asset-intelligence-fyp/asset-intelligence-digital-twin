import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { POINTS } from '../services/twin';
import { XeokitViewer } from '../viewer/XeokitViewer';
import { Eyebrow } from './UI';

export function DemoBuilding({selectedCode,onSelect}:{selectedCode?:string;onSelect:(code:string)=>void}) {
 const [full,setFull]=useState(false);
 return <section className={`model-card surface ${full?'model-fullscreen':''}`}>
  <div className="model-card-header"><div><strong>Digital twin · BIM viewer</strong><Eyebrow>SNOWDON TOWERS · LEVEL 5 · {POINTS.filter(x=>x.guid).length} IFC SENSOR MARKERS</Eyebrow></div>
   <div className="model-actions"><button className="small-outline" onClick={()=>setFull(x=>!x)}>{full?<Minimize2 size={13}/>:<Maximize2 size={13}/>} {full?'Minimize':'Full screen'}</button></div></div>
  <div className="model-stage"><XeokitViewer selectedCode={selectedCode} onSensorSelect={onSelect}/></div>
 </section>;
}
