import {Fragment,type ReactNode} from 'react';
type Citation={label:string;title:string;onClick:()=>void};
function inline(text:string,citations:Record<string,Citation>={}):ReactNode[]{return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[a-z]+:[A-Za-z0-9_-]+\])/g).map((part,i)=>{const ref=citations[part.slice(1,-1)];return part.startsWith('[')&&ref?<button type="button" className="assistant-citation" title={ref.title} aria-label={ref.title} key={i} onClick={ref.onClick}>{ref.label}</button>:part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:<Fragment key={i}>{part}</Fragment>})}
export function AssistantMessage({text,citations={}}:{text:string;citations?:Record<string,Citation>}){
 const lines=text.split('\n'),blocks:ReactNode[]=[];let paragraph:string[]=[],items:string[]=[],ordered=false;
 const flush=()=>{if(paragraph.length){blocks.push(<p key={'p'+blocks.length}>{inline(paragraph.join(' '),citations)}</p>);paragraph=[]}if(items.length){const children=items.map((x,i)=><li key={i}>{inline(x,citations)}</li>);blocks.push(ordered?<ol key={'l'+blocks.length}>{children}</ol>:<ul key={'l'+blocks.length}>{children}</ul>);items=[]}};
 for(const line of lines){const heading=line.match(/^#{1,6}\s+(.+)$/),list=line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/);if(heading){flush();blocks.push(<h3 key={'h'+blocks.length}>{inline(heading[1],citations)}</h3>)}else if(list){const next=!!list[1];if(paragraph.length||items.length&&next!==ordered)flush();ordered=next;items.push(list[2])}else if(!line.trim()){flush()}else{if(items.length)flush();paragraph.push(line)}}flush();
 return <div className="assistant-prose">{blocks}</div>;
}
