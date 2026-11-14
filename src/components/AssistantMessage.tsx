import {Fragment,type ReactNode} from 'react';
function inline(text:string):ReactNode[]{return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:<Fragment key={i}>{part}</Fragment>)}
export function AssistantMessage({text}:{text:string}){
 const lines=text.split('\n'),blocks:ReactNode[]=[];let paragraph:string[]=[],items:string[]=[],ordered=false;
 const flush=()=>{if(paragraph.length){blocks.push(<p key={'p'+blocks.length}>{inline(paragraph.join(' '))}</p>);paragraph=[]}if(items.length){const children=items.map((x,i)=><li key={i}>{inline(x)}</li>);blocks.push(ordered?<ol key={'l'+blocks.length}>{children}</ol>:<ul key={'l'+blocks.length}>{children}</ul>);items=[]}};
 for(const line of lines){const heading=line.match(/^#{1,6}\s+(.+)$/),list=line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/);if(heading){flush();blocks.push(<h3 key={'h'+blocks.length}>{inline(heading[1])}</h3>)}else if(list){const next=!!list[1];if(paragraph.length||items.length&&next!==ordered)flush();ordered=next;items.push(list[2])}else if(!line.trim()){flush()}else{if(items.length)flush();paragraph.push(line)}}flush();
 return <div className="assistant-prose">{blocks}</div>;
}
