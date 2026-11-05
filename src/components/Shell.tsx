import { BellRing, Box, Grid2X2, Radio, ListFilter, Sun, Moon, MessageCircle, Activity } from 'lucide-react';
import {useEffect,useState,type ReactNode} from 'react';
import { useTwin } from '../services/twin';

export type Page='overview'|'assets'|'analytics'|'events'|'sensors'|'simulator'|'assistant'|'status';
const nav: {id:Page;label:string;Icon:typeof Grid2X2}[]=[
 {id:'overview',label:'Building overview',Icon:Grid2X2},
 {id:'sensors',label:'Sensors & trends',Icon:ListFilter},
 {id:'events',label:'Event log',Icon:BellRing},
 {id:'assistant',label:'AI assistant',Icon:MessageCircle},
 {id:'simulator',label:'Simulation lab',Icon:Radio},
 {id:'status',label:'System status',Icon:Activity},
];
export function Shell({page,setPage,children}:{page:Page;setPage:(p:Page)=>void;children:ReactNode}){
 const {backendConnected,storage,httpCoverage}=useTwin();
 const [dark,setDark]=useState(()=>localStorage.getItem('twin-neutral-theme')==='dark');
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('twin-neutral-theme',dark?'dark':'light')},[dark]);
 return <div className="app-shell">
  <header className="topbar">
   <button className="brand" title="Building overview" onClick={()=>setPage('overview')}><span className="brand-symbol"><Box size={16}/></span><span className="brand-name">Twin<span>Labs</span><small>DIGITAL TWIN</small></span></button>
   <div className="brand-separator"/><div className="site-identity"><strong>FYP whole building</strong><span>5 locations · 18 sensor points · 18 BIM markers</span></div>
   <div className="top-actions"><span className="top-live"><i/>Synthetic HTTP · {httpCoverage}/18</span><button className="top-demo" aria-label="Toggle control room theme" onClick={()=>setDark(!dark)}>{dark?<Sun size={15}/>:<Moon size={15}/>}</button><div className="avatar">DT</div></div>
  </header>
  <nav className="sidebar" aria-label="Main navigation"><div className="sidebar-top">{nav.map(({id,label,Icon})=><button key={id} className={`nav-icon ${page===id?'selected':''}`} title={label} aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={19} strokeWidth={1.65}/><span>{label}</span></button>)}</div><div className="sidebar-bottom"><span>IFC</span></div></nav>
  <main className="page-container">{children}</main>
  <footer className="statusbar"><span><i/>{`Simulated HTTP ${httpCoverage}/18 active`}</span><span>BIM: FYP whole building</span><span>{backendConnected?(storage==='postgresql'?'PostgreSQL connected':'Temporary memory · resets on restart'):'API not connected'} · 18 channels</span></footer>
 </div>;
}

