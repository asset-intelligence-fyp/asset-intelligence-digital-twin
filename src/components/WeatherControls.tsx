import {useEffect,useState} from 'react';
import {useSimulationSource} from './WeatherStation';
import {Sun,Cloud,CloudRain,Moon} from 'lucide-react';
import {useTwin,type Weather} from '../services/twin';
const options:{id:Weather;label:string;Icon:typeof Sun}[]=[
 {id:'clear',label:'Clear',Icon:Sun},{id:'cloudy',label:'Cloudy',Icon:Cloud},
 {id:'rain',label:'Rain',Icon:CloudRain},{id:'night',label:'Night',Icon:Moon}
];
export function WeatherControls(){
 const source=useSimulationSource(),[follow,setFollow]=useState(true);
 const generated=source?.simulation?.weather;
 const automatic=follow&&!!generated;
 const {weather,setWeather,weatherMotion,setWeatherMotion}=useTwin();
 useEffect(()=>{if(automatic&&generated)setWeather(generated.scene as Weather)},[automatic,generated?.scene,setWeather]);
 return <section className="weather-toolbar" aria-label="Weather demonstration">
  <div className="weather-intro"><span className="weather-kicker">SCENE PREVIEW</span><strong>Set the atmosphere</strong><span>{automatic?'Scene follows virtual weather sensors':'Scene preview only · does not change sensor inputs'}</span></div>
  <div className="weather-options" role="group" aria-label="Demo weather">{options.map(({id,label,Icon})=><button key={id} aria-pressed={weather===id} disabled={automatic} onClick={()=>setWeather(id)}><Icon size={16}/>{label}</button>)}</div>
  <div className="weather-extras"><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>Follow virtual weather</label><label><input type="checkbox" checked={weatherMotion} onChange={e=>setWeatherMotion(e.target.checked)}/>Animate weather</label></div>
 </section>;
}
