import type { ReactNode } from 'react';
import { ArrowUpRight, CircleHelp, Activity } from 'lucide-react';
type SystemStatus = 'Running'|'Idle'|'Fault';

export function Eyebrow({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}
export function Pill({children, tone = 'neutral', className = ''}: {children: ReactNode; tone?: 'neutral' | 'teal' | 'fault' | 'warning' | 'muted'; className?: string}) {
  return <span className={`pill pill-${tone} ${className}`}>{children}</span>;
}
export function StatusPill({status}: {status:SystemStatus}) {
  return <Pill tone={status === 'Running' ? 'teal' : status === 'Fault' ? 'fault' : 'muted'}><span className="status-dot" />{status}</Pill>;
}
export function Health({value}: {value:number}) {
  return <div className="health-meter"><span className={`health-track ${value < 65 ? 'unhealthy' : ''}`}><span style={{width: `${value}%`}} /></span><span>{value}%</span></div>;
}
export function IconLink({label, onClick}: {label:string; onClick:()=>void}) {
  return <button className="icon-link" onClick={onClick} aria-label={label} title={label}><ArrowUpRight size={15} /></button>;
}
export function EmptyState({message}: {message: string}) {
  return <div className="empty-state"><CircleHelp size={22} /><p>{message}</p></div>;
}
export function TinyLine({color = '#279da5'}:{color?: string}) {
  return <Activity size={16} color={color} />;
}

