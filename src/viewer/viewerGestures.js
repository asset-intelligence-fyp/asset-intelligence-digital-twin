/** Normal wheel gestures scroll the page; explicit modifiers control the camera. */
export function bindViewerGestures(element,{onWheel,onPinch,onInteract=()=>{}}){
 const options={passive:false,capture:true};let previousScale=1;
 const isControl=event=>!!event.target?.closest?.('button,select,input,textarea,[data-viewer-scroll]');
 const wheel=event=>{
  if(isControl(event)||(!event.ctrlKey&&!event.metaKey&&!event.shiftKey))return;
  event.preventDefault();event.stopPropagation();
  onInteract();onWheel({deltaX:event.deltaX||0,deltaY:event.deltaY||0,deltaMode:event.deltaMode||0,ctrlKey:!!(event.ctrlKey||event.metaKey),shiftKey:!!event.shiftKey});
 };
 const start=event=>{if(isControl(event))return;event.preventDefault();event.stopPropagation();previousScale=1;onInteract()};
 const change=event=>{if(isControl(event))return;event.preventDefault();event.stopPropagation();const scale=event.scale||1;onPinch(previousScale/scale);previousScale=scale};
 const end=event=>{if(isControl(event))return;event.preventDefault();event.stopPropagation();previousScale=1};
 element.addEventListener('wheel',wheel,options);element.addEventListener('gesturestart',start,options);element.addEventListener('gesturechange',change,options);element.addEventListener('gestureend',end,options);
 return ()=>{element.removeEventListener('wheel',wheel,options);element.removeEventListener('gesturestart',start,options);element.removeEventListener('gesturechange',change,options);element.removeEventListener('gestureend',end,options)};
}
