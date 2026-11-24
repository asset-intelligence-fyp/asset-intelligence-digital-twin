import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Shell,type Page} from './components/Shell';
import {TwinProvider,useTwin,POINTS} from './services/twin';
import {Overview} from './pages/Overview';
import {AIMonitoring} from './pages/AIMonitoring';
import {Assets} from './pages/Assets';
import {Sensors} from './pages/Sensors';
import {Analytics} from './pages/Analytics';
import {SystemStatus} from './pages/SystemStatus';
import {AssistantWorkspace} from './components/AssistantWorkspace';
import {Guide} from './pages/Guide';
import {Events} from './pages/Events';
import {Simulator} from './pages/Simulator';
import {CommandPalette} from './components/ExperiencePanel';
import {Presentation} from './pages/Presentation';
import {AdminDatabase,AdminLogin,useAdminSession} from './pages/AdminDatabase';
import {AdminWorkspace} from './pages/AdminWorkspace';
import {Announcements} from './pages/Announcements';
import './styles.css';
import './control-room.css';
import './workspace.css';
import './pulse.css';
import './presentation-refresh.css';
import './clean-dashboard.css';
import './e8a-monitoring.css';
import './login-page.css';
import {applyTheme,getSavedTheme} from './theme.js';
applyTheme(getSavedTheme());
function App(){
 const {selectedRoom:selectedAsset,setSelectedRoom:setSelectedAsset}=useTwin();
 const [commandRequest,setCommandRequest]=useState(0);
 const {session,setSession,logout,sessionLoading}=useAdminSession();
 const [page,updatePage]=useState<Page>('overview');
 const setPage=(next:Page)=>{if(next==='database'&&session.role!=='admin')return;updatePage(next);window.scrollTo({top:0,behavior:'instant'});};
 const handleLogout=async()=>{try{await logout();}finally{setPage('overview');}};
 useEffect(()=>{if(page==='database'&&session.role!=='admin')updatePage('overview')},[page,session.role]);
 const [assistantDraft,setAssistantDraft]=useState<{question:string;scope:string;nonce:number}|null>(null);
 const [investigationId,setInvestigationId]=useState<number|null>(null);
 const [eventRequest,setEventRequest]=useState(0);
 const [selectedEventId,setSelectedEventId]=useState<number|null>(null);
 const openEvent=(id:number)=>{setSelectedEventId(id);setEventRequest(n=>n+1);setPage('events')};
 const [selectedCode,setSelectedCode]=useState('TEMP-L03-OPEN-01');
 const focus=(code:string)=>{const p=POINTS.find(p=>p.code===code);if(!p)return;setSelectedCode(code);setSelectedAsset(p.assetId);setPage('overview');setCommandRequest(n=>n+1)};
 const askSensor=(code:string)=>{setAssistantDraft({scope:code,question:'Review the current readings and available trend for this sensor.',nonce:Date.now()});setPage('assistant')};
 if(sessionLoading)return <div className="twin-auth-screen"><div className="twin-auth-wait" role="status">Checking account session…</div></div>;
 if(!session.authenticated)return <div className="twin-auth-screen"><div className="twin-auth-brand"><div className="twin-auth-mark">T</div><span className="twin-auth-label">TWINLABS · DIGITAL TWIN</span><h1>Welcome to TwinLabs</h1><p>Sign in with your invited account to access the building dashboard.</p></div><AdminLogin onSuccess={result=>{setSession(result);updatePage(result.role==='admin'?'database':'overview');window.scrollTo({top:0,behavior:'instant'})}}/><p className="twin-auth-note">Don't have an account? Contact an administrator to request an invitation. Registration requires a valid one-time invitation code.</p></div>;
 return <><Shell onEvent={openEvent} page={page} setPage={setPage} adminAuthenticated={session.role==='admin'} accountAuthenticated={session.authenticated} accountRole={session.role} onAdminClick={()=>{}} onLogout={()=>{void handleLogout()}}>
  {page==='database'&&session.role==='admin'&&(session.legacy?<AdminDatabase/>:<AdminWorkspace/>)}
  {page==='announcements'&&<Announcements/>}
  {page==='overview'&&<Overview investigationId={investigationId} onDismissInvestigation={()=>setInvestigationId(null)} onEvent={openEvent} externalFocusRequest={commandRequest} setPage={setPage} selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='monitoring'&&<AIMonitoring onEvent={openEvent} onAssistant={()=>setPage('assistant')} onFocus={focus}/>}
  {page==='assets'&&<Assets selectedAsset={selectedAsset} onSelect={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='sensors'&&<Sensors initialCode={selectedCode}/>}
  {page==='analytics'&&<Analytics/>}
  {page==='events'&&<Events key={eventRequest} initialEventId={selectedEventId} onSensor={(code,id)=>{focus(code);setInvestigationId(id??null)}} onAsk={askSensor}/>}
  {page==='simulator'&&<Simulator/>}
  {page==='status'&&<SystemStatus/>}
  {page==='guide'&&<Guide setPage={setPage}/>}
 <div className={page==='assistant'?'assistant-page-inner':''} ><AssistantWorkspace fullPage={page==='assistant'} onExpand={()=>setPage('assistant')} onSensor={(code,id)=>{setInvestigationId(id??null);focus(code)}} onEvent={openEvent} draft={assistantDraft}/></div>
 <CommandPalette onSelect={code=>{const point=POINTS.find(p=>p.code===code);if(point){setSelectedCode(code);setSelectedAsset(point.assetId);setPage('overview');setCommandRequest(n=>n+1)}}}/>
 </Shell>

 </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.hash==='#presentation'?<Presentation/>:<TwinProvider><App/></TwinProvider>}</React.StrictMode>);


