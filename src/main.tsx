import React, {useEffect,useState} from 'react';
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
import {AdminDatabase,AdminLogin,useAdminSession} from './pages/AdminDatabase';
import './styles.css';
import './control-room.css';
import './workspace.css';
import './pulse.css';
document.documentElement.dataset.theme='dark';
function App(){
 const {selectedRoom:selectedAsset,setSelectedRoom:setSelectedAsset}=useTwin();
 const [commandRequest,setCommandRequest]=useState(0);
 const [adminOpen,setAdminOpen]=useState(false);
 const {session,setSession,logout}=useAdminSession();
 const [page,updatePage]=useState<Page>('overview');
 const setPage=(next:Page)=>{setAdminOpen(false);updatePage(next);window.scrollTo({top:0,behavior:'instant'});};
 useEffect(()=>{if(!adminOpen)return;const handler=(event:KeyboardEvent)=>{if(event.key==='Escape')setAdminOpen(false)};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler)},[adminOpen]);
 const [assistantDraft,setAssistantDraft]=useState<{question:string;scope:string;nonce:number}|null>(null);
 const [selectedCode,setSelectedCode]=useState('TEMP-L03-OPEN-01');
 const focus=(code:string)=>{const p=POINTS.find(p=>p.code===code);if(!p)return;setSelectedCode(code);setSelectedAsset(p.assetId);setPage('overview');setCommandRequest(n=>n+1)};
 const askSensor=(code:string)=>{setAssistantDraft({scope:code,question:'Review the current readings and available trend for this sensor.',nonce:Date.now()});setPage('assistant')};
 return <><Shell page={page} setPage={setPage} onAdminClick={()=>setAdminOpen(true)}>
  {page==='overview'&&<Overview externalFocusRequest={commandRequest} setPage={setPage} selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='assets'&&<Assets selectedAsset={selectedAsset} onSelect={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='sensors'&&<Sensors initialCode={selectedCode}/>}
  {page==='analytics'&&<Analytics/>}
  {page==='events'&&<Events onSensor={focus} onAsk={askSensor}/>}
  {page==='simulator'&&<Simulator/>}
  {page==='status'&&<SystemStatus/>}
 <div className={page==='assistant'?'assistant-page-inner':''} ><AssistantWorkspace fullPage={page==='assistant'} onExpand={()=>setPage('assistant')} onSensor={focus} draft={assistantDraft}/></div>
 <CommandPalette onSelect={code=>{const point=POINTS.find(p=>p.code===code);if(point){setSelectedCode(code);setSelectedAsset(point.assetId);setPage('overview');setCommandRequest(n=>n+1)}}}/>
 </Shell>
 {adminOpen&&<div className="admin-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setAdminOpen(false)}}><div className={`admin-modal ${session.authenticated?'admin-modal-wide':''}`} role="dialog" aria-modal="true" aria-label={session.authenticated?'Database Management':'Admin Login'}>{session.authenticated?<AdminDatabase onLogout={()=>{void logout()}} onClose={()=>setAdminOpen(false)}/>:<AdminLogin onSuccess={setSession} onClose={()=>setAdminOpen(false)}/>}</div></div>}
 </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.hash==='#presentation'?<Presentation/>:<TwinProvider><App/></TwinProvider>}</React.StrictMode>);

