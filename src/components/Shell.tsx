import { BellRing, Box, Boxes, ChartNoAxesCombined, FlaskConical, Clock3, Database, Grid2X2, ListFilter, MessageCircle, Activity, BookOpen, UserRound, LogOut, Sun, Moon, BrainCircuit, ChevronDown, MoreHorizontal } from 'lucide-react';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import { useTwin,type EventRecord } from '../services/twin';
import {applyTheme} from '../theme.js';

export type Page='monitoring'|'database'|'overview'|'assets'|'analytics'|'events'|'sensors'|'simulator'|'assistant'|'status'|'guide';
const mainNav: {id:Page;label:string;Icon:typeof Grid2X2}[]=[
 {id:'overview',label:'Overview',Icon:Grid2X2},
 {id:'monitoring',label:'AI monitoring',Icon:BrainCircuit},
 {id:'analytics',label:'Analytics',Icon:ChartNoAxesCombined},
 {id:'events',label:'Events',Icon:BellRing},
];
const extraNav: {id:Page;label:string;Icon:typeof Grid2X2}[]=[
 {id:'simulator',label:'Simulation lab',Icon:FlaskConical},
 {id:'assets',label:'Asset register',Icon:Boxes},
 {id:'sensors',label:'Sensor monitoring',Icon:ListFilter},
 {id:'assistant',label:'AI assistant',Icon:MessageCircle},
 {id:'status',label:'System status',Icon:Activity},
 {id:'guide',label:'How to use',Icon:BookOpen},
];
export function Shell({onEvent,page,setPage,children,onAdminClick,onLogout,adminAuthenticated}:{onEvent:(id:number)=>void;page:Page;setPage:(p:Page)=>void;children:ReactNode;onAdminClick:()=>void;onLogout:()=>void;adminAuthenticated:boolean}){
 const [appearance,setAppearance]=useState<'light'|'dark'>(()=>document.documentElement.dataset.theme==='light'?'light':'dark');
 const toggleAppearance=()=>{
  const next=appearance==='dark'?'light':'dark';
  setAppearance(next);
  applyTheme(next,{persist:true});
  window.dispatchEvent(new CustomEvent('twinlabs:appearance-changed',{detail:{theme:next}}));
 };
 const [notificationsOpen,setNotificationsOpen]=useState(false);
 const [clock,setClock]=useState(()=>new Date());
 const [profileOpen,setProfileOpen]=useState(false);
 const profileRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{if(!profileOpen)return;const dismiss=(event:MouseEvent)=>{if(profileRef.current&&!profileRef.current.contains(event.target as Node))setProfileOpen(false)};const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setProfileOpen(false)};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',onEscape);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',onEscape)}},[profileOpen]);
 useEffect(()=>{if(!adminAuthenticated)setProfileOpen(false)},[adminAuthenticated]);
 useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(timer)},[]);
 const {backendConnected,storage,httpCoverage,events}=useTwin();

 const knownAlerts=useRef<Set<number>|null>(null),[toast,setToast]=useState<EventRecord|null>(null);
 useEffect(()=>{if(!backendConnected)return;if(knownAlerts.current===null){knownAlerts.current=new Set(events.map(e=>e.id));return;}const fresh=events.find(e=>e.automatic&&!e.resolved_at&&!e.acknowledged&&!knownAlerts.current!.has(e.id));for(const e of events)knownAlerts.current.add(e.id);if(fresh)setToast(fresh)},[events,backendConnected]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),8000);return()=>clearTimeout(timer)},[toast?.id]);
 const openEvents=events.filter(e=>!e.acknowledged&&!e.resolved_at).length;
 return <div className="app-shell">
  <header className="topbar">
   <button className="brand" title="Building overview" onClick={()=>setPage('overview')}><span className="brand-symbol"><Box size={16}/></span><span className="brand-name">Twin<span>Labs</span><small>DIGITAL TWIN</small></span></button>
   <div className="brand-separator"/><div className="site-identity"><strong>FYP whole building</strong></div>
   <div className="top-actions"><span className="top-live"><i/>{httpCoverage}/18 reporting</span><span className="simulation-badge"><FlaskConical size={12}/> Simulation</span><button type="button" className="appearance-toggle" onClick={toggleAppearance} aria-label={appearance==='dark'?'Switch to light mode':'Switch to dark mode'} title={appearance==='dark'?'Switch to light mode':'Switch to dark mode'}>{appearance==='dark'?<Sun size={15}/>:<Moon size={15}/>}<span>{appearance==='dark'?'Light':'Dark'}</span></button><time className="header-clock"><Clock3 size={12}/>{clock.toLocaleTimeString('en-GB',{timeZone:'Asia/Kuching'})} MYT</time><button className="top-notifications" aria-label="Open alert notifications" aria-expanded={notificationsOpen} onClick={()=>setNotificationsOpen(v=>!v)}><BellRing size={15}/>{openEvents>0&&<span>{openEvents}</span>}</button><div className="admin-profile" ref={profileRef}>{adminAuthenticated?<button className="avatar admin-login-trigger" type="button" title="Administrator account" aria-label="Administrator account menu" aria-expanded={profileOpen} aria-haspopup="menu" onClick={()=>setProfileOpen(open=>!open)}><UserRound size={18} strokeWidth={1.8}/></button>:<button className="avatar admin-login-trigger admin-login-text" type="button" title="Login" aria-label="Login" onClick={onAdminClick}>Login</button>}{adminAuthenticated&&profileOpen&&<div className="admin-profile-menu" role="menu"><div className="admin-profile-label">Administrator</div><button type="button" role="menuitem" onClick={()=>{setProfileOpen(false);onLogout()}}><LogOut size={15}/> Logout</button></div>}</div></div>
  </header>
  {toast&&<div className="alert-toast" role="status"><div><strong>{toast.level}: {toast.title}</strong><p>{toast.source} · New automatic alert</p></div><button className="small-outline" onClick={()=>{onEvent(toast.id);setToast(null)}}>Investigate</button><button className="text-link" aria-label="Dismiss alert notification" onClick={()=>setToast(null)}>×</button></div>}
  {notificationsOpen&&<aside className="notification-tray" aria-label="Alert notifications"><div className="heading-actions"><h2>Notifications</h2><button className="small-outline" onClick={()=>setNotificationsOpen(false)}>Close</button></div><p role="status">{openEvents} active, unacknowledged alerts</p>{events.slice(0,8).map(e=><button key={e.id} className="notification-item" onClick={()=>{setNotificationsOpen(false);onEvent(e.id)}}><strong>{e.title}</strong><span>{e.resolved_at?'Recovered':e.acknowledged?'Acknowledged':e.level} · {e.source}</span><small>{new Date(e.time).toLocaleString()}</small></button>)}{!events.length&&<p>Automatic alerts appear when incoming readings breach a demo rule.</p>}<button className="text-link" onClick={()=>{setNotificationsOpen(false);setPage('events')}}>Open event log</button></aside>}
  <nav className="sidebar" aria-label="Main navigation"><div className="sidebar-top">
   {mainNav.map(({id,label,Icon})=><button key={id} className={`nav-icon ${page===id?'selected':''}`} title={label} aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={19} strokeWidth={1.65}/><span>{label}</span></button>)}
   <details className="sidebar-more"><summary><MoreHorizontal size={17}/> More tools <ChevronDown size={13}/></summary><div className="sidebar-more-list">
   {extraNav.map(({id,label,Icon})=><button key={id} className={`nav-icon ${page===id?'selected':''}`} title={label} aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={18}/><span>{label}</span></button>)}
   {adminAuthenticated&&<button className={`nav-icon ${page==='database'?'selected':''}`} title="Database" onClick={()=>setPage('database')}><Database size={18}/><span>Database</span></button>}
   </div></details>
  </div></nav>
  <main className={`page-container${page==='assistant'?' assistant-main':''}`}>{children}</main>
  <footer className="statusbar"><span><i/>{backendConnected?'Simulated telemetry connected':'Simulator API disconnected'}</span><span>BIM: FYP whole building</span><span>{backendConnected?(storage==='postgresql'?'PostgreSQL connected':'Temporary memory · resets on restart'):'API not connected'}</span></footer>
 </div>;
}


