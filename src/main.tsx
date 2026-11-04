import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Shell,type Page} from './components/Shell';
import {TwinProvider,useTwin,POINTS} from './services/twin';
import {Overview} from './pages/Overview';
import {Assets} from './pages/Assets';
import {Analytics} from './pages/Analytics';
import {Events} from './pages/Events';
import {Sensors} from './pages/Sensors';
import {Simulator} from './pages/Simulator';
import {CommandPalette} from './components/ExperiencePanel';
import './styles.css';
import './control-room.css';
document.documentElement.dataset.theme='dark';
function App(){
 const {selectedRoom:selectedAsset,setSelectedRoom:setSelectedAsset}=useTwin();
 const [commandRequest,setCommandRequest]=useState(0);
 const [page,updatePage]=useState<Page>('overview');
 const setPage=(next:Page)=>{updatePage(next);window.scrollTo({top:0,behavior:'instant'});};
 const [selectedCode,setSelectedCode]=useState('TEMP-L03-OPEN-01');
 return <Shell page={page} setPage={setPage}>
  {page==='overview'&&<Overview externalFocusRequest={commandRequest} setPage={setPage} selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='assets'&&<Assets selectedAsset={selectedAsset} onSelect={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='analytics'&&<Analytics/>}
  {page==='sensors'&&<Sensors/>}
  {page==='events'&&<Events/>}
  {page==='simulator'&&<Simulator/>}
 <CommandPalette onSelect={code=>{const point=POINTS.find(p=>p.code===code);if(point){setSelectedCode(code);setSelectedAsset(point.assetId);setPage('overview');setCommandRequest(n=>n+1)}}}/>
 </Shell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><TwinProvider><App/></TwinProvider></React.StrictMode>);

