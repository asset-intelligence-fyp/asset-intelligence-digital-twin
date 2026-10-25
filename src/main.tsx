import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Shell,type Page} from './components/Shell';
import {TwinProvider} from './services/twin';
import {Overview} from './pages/Overview';
import {Assets} from './pages/Assets';
import {Analytics} from './pages/Analytics';
import {Events} from './pages/Events';
import {Sensors} from './pages/Sensors';
import {Simulator} from './pages/Simulator';
import './styles.css';
function App(){
 const [page,setPage]=useState<Page>('overview');
 const [selectedAsset,setSelectedAsset]=useState<'HRU501A'|'HRU504'|'HRU507'>('HRU501A');
 const [selectedCode,setSelectedCode]=useState('SAT-501A');
 return <Shell page={page} setPage={setPage}>
  {page==='overview'&&<Overview setPage={setPage} selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='assets'&&<Assets selectedAsset={selectedAsset} onSelect={setSelectedAsset} selectedCode={selectedCode} onSelectCode={setSelectedCode}/>}
  {page==='analytics'&&<Analytics/>}
  {page==='sensors'&&<Sensors/>}
  {page==='events'&&<Events/>}
  {page==='simulator'&&<Simulator/>}
 </Shell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><TwinProvider><App/></TwinProvider></React.StrictMode>);
