import { useEffect, useRef, useState } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';

/**
 * UI-only placeholder. It deliberately does not accept prompts, call an AI
 * service, or produce generated responses.
 */
export function AssistantPlaceholder() {
 const [open, setOpen] = useState(false);
 const launcherRef = useRef<HTMLButtonElement>(null);
 const closeRef = useRef<HTMLButtonElement>(null);

 const close = () => {
  setOpen(false);
  launcherRef.current?.focus();
 };

 useEffect(() => {
  if (!open) return;
  closeRef.current?.focus();
  const onKeyDown = (event: KeyboardEvent) => {
   if (event.key === 'Escape') {
    setOpen(false);
    launcherRef.current?.focus();
   }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
 }, [open]);

 return <>
  <button
   ref={launcherRef}
   type="button"
   className="ask-floating"
   aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
   aria-controls="twinlabs-ai-assistant"
   aria-expanded={open}
   onClick={() => open ? close() : setOpen(true)}
  >
   <MessageCircle size={17} aria-hidden="true" />
   <span>AI Assistant</span>
  </button>
  {open && <section
   id="twinlabs-ai-assistant"
   className="assistant-panel twinlabs-assistant"
   role="dialog"
   aria-modal="false"
   aria-labelledby="twinlabs-assistant-title"
   aria-describedby="twinlabs-assistant-description"
  >
   <div className="assistant-head">
    <span className="assistant-avatar" aria-hidden="true"><Bot size={17}/></span>
    <div className="assistant-identity">
     <strong id="twinlabs-assistant-title">TwinLabs AI Assistant</strong>
     <div className="eyebrow">BUILDING INTELLIGENCE</div>
    </div>
    <span className="assistant-preview">Coming soon</span>
    <button ref={closeRef} type="button" className="close-icon" aria-label="Close AI Assistant" onClick={close}><X size={18}/></button>
   </div>
   <div className="assistant-messages">
    <div className="message message-assistant" id="twinlabs-assistant-description">
     <strong>AI Assistant</strong>
     <p>Ask questions about your building, BIM assets and sensor readings here when the assistant is available.</p>
     <p className="assistant-unavailable">AI chat is not connected yet.</p>
    </div>
   </div>
   <div className="assistant-composer">
    <input aria-label="Assistant message" type="text" disabled placeholder="Messaging coming soon" />
    <button type="button" aria-label="Send message unavailable" disabled><Send size={14}/></button>
   </div>
   <div className="assistant-foot">Assistant preview · No messages are sent</div>
  </section>}
 </>;
}
