import {Sun,Cloud,CloudRain,Moon} from 'lucide-react';
import {useTwin,type Weather} from '../services/twin';
const options:{id:Weather;label:string;Icon:typeof Sun}[]=[
 {id:'clear',label:'Clear',Icon:Sun},{id:'cloudy',label:'Cloudy',Icon:Cloud},
 {id:'rain',label:'Rain',Icon:CloudRain},{id:'night',label:'Night',Icon:Moon}
];
export function WeatherControls(){
 const {weather,setWeather,weatherMotion,setWeatherMotion}=useTwin();
 return <section className="weather-toolbar" aria-label="Weather demonstration">
  <div className="weather-intro"><span className="weather-kicker">SCENE PREVIEW</span><strong>Set the atmosphere</strong><span>Visual demo only · sensor readings stay unchanged</span></div>
  <div className="weather-options" role="group" aria-label="Demo weather">{options.map(({id,label,Icon})=><button key={id} aria-pressed={weather===id} onClick={()=>setWeather(id)}><Icon size={16}/>{label}</button>)}</div>
  <div className="weather-extras"><label><input type="checkbox" checked={weatherMotion} onChange={e=>setWeatherMotion(e.target.checked)}/>Animate weather</label></div>
 </section>;
}
