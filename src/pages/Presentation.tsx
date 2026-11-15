import {useEffect,useRef,useState} from 'react';
import {Pause,Play,RotateCcw,Download,Maximize2,Eye,ArrowLeft,Camera} from 'lucide-react';
import {createPresentationViewer} from '../viewer/presentationViewer.js';
import './presentation.css';

export function Presentation(){
 const canvas=useRef<HTMLCanvasElement>(null),control=useRef<ReturnType<typeof createPresentationViewer>|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[playing,setPlaying]=useState(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches),[paired,setPaired]=useState(true),[clean,setClean]=useState(false);
 useEffect(()=>{
  const oldTitle=document.title;document.title='TwinLabs · Poster studio';let disposed=false;
  // Defer creation so StrictMode's rehearsal cannot allocate a second WebGL scene.
  const frame=requestAnimationFrame(()=>{if(disposed||!canvas.current)return;try{control.current=createPresentationViewer(canvas.current,{onReady:()=>!disposed&&setReady(true),onError:(e:string)=>!disposed&&setError(e)})}catch{setError('This presentation needs WebGL 2. Open it in your graphics-enabled browser.')}});
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setClean(false)};window.addEventListener('keydown',key);
  return()=>{disposed=true;cancelAnimationFrame(frame);control.current?.destroy();control.current=null;window.removeEventListener('keydown',key);document.title=oldTitle};
 },[]);
 const poster=()=>{control.current?.poster();setPlaying(false)};
 const download=()=>{try{poster();const image=control.current?.snapshot();if(!image)return;const a=document.createElement('a');a.href=image;a.download='TwinLabs-building-to-digital-twin.png';a.click()}catch{setError('PNG export could not complete. Use Poster frame and capture the screen instead.')}};
 return <main className={`poster-studio ${clean?'poster-studio-clean':''}`}>
  <div className="poster-grid" aria-hidden="true"/>
  <canvas id="twinlabs-poster-canvas" ref={canvas} aria-label="Solid IFC building transitioning into an extracted X-ray digital twin with 18 pulsing virtual sensor markers"/>
  {!clean&&<><header className="poster-heading"><a href="/" aria-label="Back to dashboard"><ArrowLeft size={15}/> TwinLabs</a><span>PRESENTATION STUDIO</span><h1>From building to digital twin.</h1><p>Your IFC model. Its digital counterpart.</p></header>
  <div className="poster-captions" aria-hidden="true">{paired&&<div><small>01 / BUILDING MODEL</small><strong>Spatial identity</strong></div>}<div><small>02 / DIGITAL TWIN</small><strong>Connected observations</strong></div></div>
  <footer className="poster-controls"><div className="poster-toolbar" aria-label="Presentation controls">
   <button disabled={!ready} onClick={()=>{control.current?.setPlaying(!playing);setPlaying(!playing)}}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'Pause':'Animate'}</button>
   <button disabled={!ready} onClick={()=>{control.current?.replay();setPlaying(true)}}><RotateCcw size={14}/> Replay transition</button>
   <button disabled={!ready} onClick={()=>{control.current?.setPaired(!paired);setPaired(!paired)}} aria-pressed={!paired}><Eye size={14}/>{paired?'X-ray only':'Show both'}</button>
   <button disabled={!ready} onClick={()=>control.current?.fit()}><Maximize2 size={14}/> Fit</button>
   <button disabled={!ready} onClick={poster}><Camera size={14}/> Poster frame</button>
   <button disabled={!ready} onClick={download}><Download size={14}/> Export PNG</button>
   <button disabled={!ready} className="poster-primary" onClick={()=>{poster();setClean(true)}}>Clean screenshot</button>
  </div><p>Actual IFC geometry · virtual sensor markers · pulse animation is a visual effect, not an alert. PNG export contains the model on a transparent background.</p></footer></>}
  {clean&&<button className="poster-restore" onClick={()=>setClean(false)}>Show controls · Esc</button>}
  {!ready&&!error&&<div className="poster-feedback" role="status">Preparing your building and its digital twin…</div>}
  {error&&<div className="poster-feedback" role="alert">{error}</div>}
 </main>;
}
