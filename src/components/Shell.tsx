import { BellRing, Box, Boxes, ChartNoAxesCombined, Grid2X2, Radio, ListFilter } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTwin } from '../services/twin';
export type Page='overview'|'assets'|'analytics'|'events'|'sensors'|'simulator';
const nav: {id:Page;label:string;Icon:typeof Grid2X2}[]=[
 {id:'overview',label:'Building overview',Icon:Grid2X2},
 {id:'assets',label:'Asset register',Icon:Boxes},
 {id:'analytics',label:'Building performance',Icon:ChartNoAxesCombined},
 {id:'sensors',label:'Sensor monitoring',Icon:ListFilter},
 {id:'events',label:'Event log',Icon:BellRing},
 {id:'simulator',label:'Simulator',Icon:Radio},
];
export function Shell({page,setPage,children}:{page:Page;setPage:(p:Page)=>void;children:ReactNode}){
 const {mode,setMode,backendConnected,mqttCoverage}=useTwin();
 return <div className="app-shell">
  <header className="topbar">
   <button className="brand" title="Building overview" onClick={()=>setPage('overview')}><span className="brand-symbol"><Box size={16}/></span><span className="brand-name">Twin<span>Labs</span><small>DIGITAL TWIN</small></span></button>
   <div className="brand-separator"/><div className="site-identity"><strong>Snowdon Towers · Level 5</strong><span>3 HRUs · 9 sensor points · 8 BIM markers</span></div>
   <div className="top-actions"><span className="top-live"><i/>{mode==='random'?'Random simulation':`MQTT · ${mqttCoverage}/9`}</span><button className="top-demo" onClick={()=>setMode(mode==='random'?'mqtt':'random')} title="Switch telemetry source">{mode==='random'?'Use MQTT':'Use simulator'}</button><div className="avatar">DT</div></div>
  </header>
  <nav className="sidebar" aria-label="Main navigation"><div className="sidebar-top">{nav.map(({id,label,Icon})=><button key={id} className={`nav-icon ${page===id?'selected':''}`} title={label} aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={19} strokeWidth={1.65}/></button>)}</div><div className="sidebar-bottom"><span>L5</span></div></nav>
  <main className="page-container">{children}</main>
  <footer className="statusbar"><span><i/>{mode==='random'?'Synthetic readings · local generator':`MQTT ${mqttCoverage}/9 active`}</span><span>BIM: Snowdon Towers · Level 5</span><span>PostgreSQL {backendConnected?'connected':'not connected'} · nine channels</span></footer>
 </div>;
}
