/** Contain gestures locally, without disabling scrolling or zoom elsewhere on the page. */
export function bindViewerGestures(element,{onWheel,onPinch,onInteract=()=>{}}){
 const options={passive:false,capture:true};let previousScale=1;
 const wheel=event=>{
  event.preventDefault();event.stopPropagation();
  if(event.target?.closest?.('select,input,textarea,[data-viewer-scroll]'))return;
  onInteract();onWheel({deltaX:event.deltaX||0,deltaY:event.deltaY||0,deltaMode:event.deltaMode||0,ctrlKey:!!event.ctrlKey,shiftKey:!!event.shiftKey});
 };
 const start=event=>{event.preventDefault();event.stopPropagation();previousScale=1;onInteract()};
 const change=event=>{event.preventDefault();event.stopPropagation();const scale=event.scale||1;onPinch(previousScale/scale);previousScale=scale};
 const end=event=>{event.preventDefault();event.stopPropagation();previousScale=1};
 element.addEventListener('wheel',wheel,options);element.addEventListener('gesturestart',start,options);element.addEventListener('gesturechange',change,options);element.addEventListener('gestureend',end,options);
 return ()=>{element.removeEventListener('wheel',wheel,options);element.removeEventListener('gesturestart',start,options);element.removeEventListener('gesturechange',change,options);element.removeEventListener('gestureend',end,options)};
}
