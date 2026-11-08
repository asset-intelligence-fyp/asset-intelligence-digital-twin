import { BellRing, Box, Boxes, ChartNoAxesCombined, FlaskConical, Clock3, Grid2X2, Radio, ListFilter, MessageCircle, Activity, Sun, Moon } from 'lucide-react';
import {useEffect,useState,type ReactNode} from 'react';
import { useTwin } from '../services/twin';
import {useTheme} from '../services/theme';

export type Page='overview'|'assets'|'analytics'|'events'|'sensors'|'simulator'|'assistant'|'status';
const nav: {id:Page;label:string;Icon:typeof Grid2X2}[]=[
 {id:'overview',label:'Building overview',Icon:Grid2X2},
 {id:'assets',label:'Asset register',Icon:Boxes},
 {id:'analytics',label:'Building performance',Icon:ChartNoAxesCombined},
 {id:'sensors',label:'Sensor monitoring',Icon:ListFilter},
 {id:'events',label:'Event log',Icon:BellRing},
 {id:'assistant',label:'AI assistant',Icon:MessageCircle},
 {id:'simulator',label:'Simulation lab',Icon:Radio},
 {id:'status',label:'System status',Icon:Activity},
];
export function Shell({page,setPage,children}:{page:Page;setPage:(p:Page)=>void;children:ReactNode}){
 const [clock,setClock]=useState(()=>new Date());
 useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(timer)},[]);
 const {backendConnected,storage,httpCoverage,events}=useTwin();
 const {theme,toggleTheme}=useTheme();
 const openEvents=events.filter(e=>!e.acknowledged).length;
 return <div className="app-shell">
  <header className="topbar">
   <button className="brand" title="Building overview" onClick={()=>setPage('overview')}><span className="brand-symbol"><Box size={16}/></span><span className="brand-name">Twin<span>Labs</span><small>DIGITAL TWIN</small></span></button>
   <div className="brand-separator"/><div className="site-identity"><strong>FYP whole building</strong><span>Digital twin · 5 locations · 18 indoor channels</span></div>
   <div className="top-actions"><span className="top-live"><i/>{httpCoverage}/18 reporting</span><span className="simulation-badge"><FlaskConical size={12}/> Simulation</span><time className="header-clock"><Clock3 size={12}/>{clock.toLocaleTimeString('en-GB',{timeZone:'Asia/Kuching'})} MYT</time><button className="theme-toggle" type="button" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={toggleTheme}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button><button className="top-notifications" aria-label="Open event log" onClick={()=>setPage('events')}><BellRing size={15}/>{openEvents>0&&<span>{openEvents}</span>}</button><div className="avatar">DT</div></div>
  </header>
  <nav className="sidebar" aria-label="Main navigation"><div className="sidebar-top">{nav.map(({id,label,Icon})=><button key={id} className={`nav-icon ${page===id?'selected':''}`} title={label} aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={19} strokeWidth={1.65}/><span>{label}</span></button>)}</div><div className="sidebar-bottom"><div className="model-sync"><span className="eyebrow">MODEL SYNC</span><i/><strong>5 locations · 18 sensors</strong><small>IFC geometry · simulated telemetry</small></div><span className="sidebar-project">TwinLabs · Asset Intelligence</span></div></nav>
  <main className="page-container">{children}</main>
  <footer className="statusbar"><span><i/>{`Simulated HTTP ${httpCoverage}/18 active`}</span><span>BIM: FYP whole building</span><span>{backendConnected?(storage==='postgresql'?'PostgreSQL connected':'Temporary memory · resets on restart'):'API not connected'} · 18 channels</span></footer>
 </div>;
}

