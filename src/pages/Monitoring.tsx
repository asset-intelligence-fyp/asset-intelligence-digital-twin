import {useState} from 'react';
import {Sensors} from './Sensors';import {Analytics} from './Analytics';
export function Monitoring({initialCode,initialTab='readings'}:{initialCode?:string;initialTab?:string}){
 const [tab,setTab]=useState(initialTab);
 return <><div className="workspace-tabs" role="tablist" aria-label="Sensors and trends"><button role="tab" aria-selected={tab==='readings'} onClick={()=>setTab('readings')}>Sensor readings</button><button role="tab" aria-selected={tab==='trends'} onClick={()=>setTab('trends')}>Building trends</button></div>{tab==='readings'?<Sensors initialCode={initialCode}/>:<Analytics/>}</>;
}
