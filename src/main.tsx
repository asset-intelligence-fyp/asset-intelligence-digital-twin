import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Shell,type Page} from './components/Shell';
import {TwinProvider,useTwin,POINTS} from './services/twin';
import {Overview} from './pages/Overview';
import {Assets} from './pages/Assets';
import {Sensors} from './pages/Sensors';
import {Analytics} from './pages/Analytics';
import {SystemStatus} from './pages/SystemStatus';
import {AssistantWorkspace} from './components/AssistantWorkspace';
import {Events} from './pages/Events';
import {Simulator} from './pages/Simulator';
import {CommandPalette} from './components/ExperiencePanel';
import {Presentation} from './pages/Presentation';
import './styles.css';
import './control-room.css';
import './workspace.css';
import './pulse.css';
document.documentElement.dataset.theme='dark';
function App(){
 const {selectedRoom:selectedAsset,setSelectedRoom:setSelectedAsset}=useTwin();
 const [commandRequest,setCommandRequest]=useState(0);
 const [page,updatePage]=useState<Page>('overview');
 const setPage=(next:Page)=>{updatePage(next);window.scrollTo({top:0,behavior:'instant'});};
 const [assistantDraft,setAssistantDraft]=useState<{question:string;scope:string;nonce:number}|null>(null);
 const [selectedCode,setSelectedCode]=useState('TEMP-L03-OPEN-01');
 const focus=(code:string)=>{const p=POINTS.find(p=>p.code===code);if(!p)return;setSelectedCode(code);setSelectedAsset(p.assetId);setPage('overview');setCommandRequest(n=>n+1)};
 const askSensor=(code:string)=>{setAssistantDraft({scope:code,question:'Review the current readings and available trend for this sensor.',nonce:Date.now()});setPage('assistant')};
 return <><Shell page={page} setPage={setPage}>
  {page==='overview'&&<Overview externalFocusRequest={commandRequest} setPage={setPage} selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='assets'&&<Assets selectedAsset={selectedAsset} onSelect={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='sensors'&&<Sensors initialCode={selectedCode}/>}
  {page==='analytics'&&<Analytics/>}
  {page==='events'&&<Events onSensor={focus} onAsk={askSensor}/>}
  {page==='simulator'&&<Simulator/>}
  {page==='status'&&<SystemStatus/>}
 <div className={page==='assistant'?'assistant-page-inner':''}><AssistantWorkspace fullPage={page==='assistant'} onExpand={()=>setPage('assistant')} onSensor={focus} draft={assistantDraft}/></div>
 <CommandPalette onSelect={code=>{const point=POINTS.find(p=>p.code===code);if(point){setSelectedCode(code);setSelectedAsset(point.assetId);setPage('overview');setCommandRequest(n=>n+1)}}}/>
 </Shell></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.hash==='#presentation'?<Presentation/>:<TwinProvider><App/></TwinProvider>}</React.StrictMode>);

