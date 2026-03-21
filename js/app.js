// grow27 — app.js
// Shared: navigation, utilities, weather, init
// ─────────────────────────────────────────────────────────────────────────────

// ── MODULE + SUBTAB NAVIGATION ──────────────────────────────────────────────
const MODULE_NAMES={markets:'MARKETS',herd:'HERD',fields:'FIELDS',finance:'FINANCE',about:'ABOUT'};

function switchModule(mod, navEl){
  document.querySelectorAll('.module').forEach(m=>m.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('mod-'+mod).classList.add('active');
  navEl.classList.add('active');
  document.getElementById('module-bar').dataset.mod=mod;
  document.getElementById('header-module-name').textContent=MODULE_NAMES[mod];
  const subs={markets:'watching the boards...'};
  const subEl=document.getElementById('header-module-sub');
  if(subEl){
    if(subs[mod]){subEl.textContent=subs[mod];subEl.style.display='';}
    else{subEl.textContent='';subEl.style.display='none';}
  }
  const titles={markets:'Markets',herd:'Herd',fields:'Fields',finance:'Finance',about:'grow27'};
  document.title=titles[mod]||'grow27';

  // persist last module

}

function switchSubtab(sub){
  ['grain','cattle','dairy'].forEach(s=>{
    const st=document.getElementById('subtab-'+s), sm=document.getElementById('sub-'+s);
    if(st)st.classList.toggle('active',s===sub);
    if(sm)sm.classList.toggle('active',s===sub);
  });
  const label={grain:'Grain',cattle:'Cattle',dairy:'Dairy'};
  document.title='Markets · '+(label[sub]||'Markets');
}

// Per-submodule tab switching — prefix all section IDs with submodule
function switchTab(sub,id,el){
  const sections=document.getElementById('sub-'+sub).querySelectorAll('.section');
  sections.forEach(s=>s.classList.remove('active'));
  document.getElementById(sub+'-'+id).classList.add('active');
  const tabs=el.closest('.tabs').querySelectorAll('.tab');
  tabs.forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  if(sub==='cattle'&&id==='charts'&&CATTLE_DATA.lc)renderHistCharts();
  if(sub==='cattle'&&id==='margin'){calc();renderSeasonal();}
}

function switchNews(panelId,btn){
  // find sibling panels
  const toggle=btn.closest('.news-toggle');
  toggle.querySelectorAll('.news-mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // panels are siblings of the toggle's parent
  const container=toggle.parentElement;
  container.querySelectorAll('.news-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+panelId).classList.add('active');
}

function switchCalc(id,btn){
  document.querySelectorAll('.calc-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.calc-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('calc-'+id).classList.add('active');
  btn.classList.add('active');
}

// ── LAST UPDATED ─────────────────────────────────────────────────────────────
function markUpdated(){
  const el=document.getElementById('last-updated-txt');
  if(!el)return;
  const d=new Date();
  let h=d.getHours(),m=d.getMinutes();
  const ampm=h>=12?'pm':'am';h=h%12||12;
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  el.textContent='Updated '+h+':'+(m<10?'0':'')+m+' '+ampm+' · '+days[d.getDay()]+', '+months[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
}

// ── SHARED UTILITIES ─────────────────────────────────────────────────────────
function distMiles(a,b,c,d){const R=3958.8,dLat=(c-a)*Math.PI/180,dLon=(d-b)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function setBadge(id,change,pct){const el=document.getElementById(id);if(!el)return;const arrow=change>0.005?'▲':change<-0.005?'▼':'▬';const cls=change>0.005?'up':change<-0.005?'down':'flat';el.className='badge '+cls;el.textContent=arrow+' '+(change>=0?'+':'')+change.toFixed(4)+' ('+pct.toFixed(2)+'%)';}
function commas(v){return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmt$(v){return(v<0?'-$':'$')+commas(Math.abs(v));}
function fmtK(v){const abs=Math.abs(v);return(v<0?'-$':'$')+(abs>=1000000?(abs/1000000).toFixed(2)+'M':abs>=1000?(abs/1000).toFixed(1)+'k':commas(abs));}

// ── WEATHER ──────────────────────────────────────────────────────────────────
const GRAIN_CITIES=[{idx:1,name:'AMES IA',lat:42.03,lon:-93.62},{idx:2,name:'MANKATO MN',lat:44.16,lon:-94.00},{idx:3,name:'SIOUX FALLS',lat:43.55,lon:-96.73},{idx:4,name:'FARGO ND',lat:46.88,lon:-96.79}];
const CATTLE_CITIES=[{idx:1,name:'AMES IA',lat:42.03,lon:-93.62},{idx:2,name:'WORTHINGTON MN',lat:43.62,lon:-95.60},{idx:3,name:'OMAHA NE',lat:41.26,lon:-95.93},{idx:4,name:'PIPESTONE MN',lat:43.99,lon:-96.32}];
const conds={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',80:'Showers',95:'Thunderstorm'};
const cropNote=t=>t<28?'Frost risk':t<40?'Cold — watch emergence':t<55?'Cool — good soil temps':t<75?'Ideal field conditions':t<88?'Warm — good growth':'Heat stress';
const cattleNote=t=>t<28?'Frost risk':t<40?'Cold — low stress':t<60?'Cool — good':t<80?'Ideal conditions':t<90?'Warm — watch moisture':'Heat stress';

async function getCityName(lat,lon){try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);const d=await r.json();const city=d.address.city||d.address.town||d.address.village||d.address.county||'Your Area';const state=d.address.state_code||'';return(city+' '+state).trim().toUpperCase();}catch{return'YOUR LOCATION';}}

async function loadWeather(ulat,ulon){
  // Grain weather
  GRAIN_CITIES.forEach(c=>{const el=document.getElementById('wx-city-'+c.idx);if(el)el.textContent=c.name;});
  if(ulat&&ulon){const nm=await getCityName(ulat,ulon);const el=document.getElementById('wx-city-5');if(el)el.textContent=nm;}
  const gList=[...GRAIN_CITIES.map(c=>({idx:c.idx,lat:c.lat,lon:c.lon,pref:'wx',noteF:cropNote})),{idx:5,lat:ulat,lon:ulon,pref:'wx',noteF:cropNote}];
  // Cattle weather
  CATTLE_CITIES.forEach(c=>{const el=document.getElementById('cwx-city-'+c.idx);if(el)el.textContent=c.name;});
  const cList=[...CATTLE_CITIES.map(c=>({idx:c.idx,lat:c.lat,lon:c.lon,pref:'cwx',noteF:cattleNote})),{idx:5,lat:ulat,lon:ulon,pref:'cwx',noteF:cattleNote}];
  await Promise.all([...gList,...cList].map(async c=>{
    try{const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+c.lat+'&longitude='+c.lon+'&current=temperature_2m,weathercode&temperature_unit=fahrenheit');const d=await r.json();const temp=Math.round(d.current.temperature_2m),code=d.current.weathercode;const tempEl=document.getElementById(c.pref+'-'+c.idx);const condEl=document.getElementById(c.pref.replace('wx','wc')+'-'+c.idx);const noteEl=document.getElementById(c.pref.replace('wx','wn')+'-'+c.idx);if(tempEl)tempEl.textContent=temp+'°F';if(condEl)condEl.textContent=conds[code]||'Cloudy';if(noteEl)noteEl.textContent=c.noteF(temp);}
    catch(e){}
  }));
  // barn/locker distances
  const BARNS=[{id:'central',lat:44.2933,lon:-92.6744},{id:'lanesboro',lat:43.7180,lon:-91.9802},{id:'rockcreek',lat:45.9524,lon:-92.9577},{id:'sleepyeye',lat:44.2972,lon:-94.7244},{id:'pipestone',lat:43.9939,lon:-96.3172}];
  const LOCKERS=[{id:'herdas',lat:44.2955,lon:-93.2688},{id:'kreniks',lat:44.3900,lon:-93.5600},{id:'lonsdale',lat:44.4791,lon:-93.4158},{id:'dennison',lat:44.4063,lon:-92.9855},{id:'okeefes',lat:44.3922,lon:-93.7302}];
  if(ulat&&ulon){BARNS.forEach(b=>{const el=document.getElementById('dist-'+b.id);if(el)el.textContent='~'+Math.round(distMiles(ulat,ulon,b.lat,b.lon))+' miles';});LOCKERS.forEach(l=>{const el=document.getElementById('dist-'+l.id);if(el)el.textContent='~'+Math.round(distMiles(ulat,ulon,l.lat,l.lon))+' miles';});}
  if(ulat&&ulon){rebuildElevatorSelect();buildCashTable();rebuildElevatorDirectory();rebuildBarnSelect();buildBarnDirectory();buildLockerDirectory();updateCornCardCattle();}
  markUpdated();
}

function initLocation(){
  if(navigator.geolocation){navigator.geolocation.getCurrentPosition(pos=>{userLat=pos.coords.latitude;userLon=pos.coords.longitude;if(activeRegion==='auto')setRegion('auto');loadWeather(userLat,userLon);discoverElevators(userLat,userLon);rebuildDairyPlantSelect();rebuildBarnSelect();},()=>{userLat=44.03;userLon=-94.76;if(activeRegion==='auto')setRegion('auto');loadWeather(44.03,-94.76);discoverElevators(44.03,-94.76);rebuildDairyPlantSelect();rebuildBarnSelect();});}
  else{userLat=44.03;userLon=-94.76;if(activeRegion==='auto')setRegion('auto');loadWeather(44.03,-94.76);discoverElevators(44.03,-94.76);rebuildDairyPlantSelect();rebuildBarnSelect();}
}

// ── INIT ─────────────────────────────────────────────────────────────────────
// Restore last module
try{
  const navEl=document.querySelector('.nav-item[data-mod="markets"]');
  if(navEl)switchModule('markets',navEl);
  switchSubtab('grain');
}catch(e){}

loadGrainPrices();
loadCattlePrices();
loadDairyPrices();
loadBarnPrices();
loadFeedInputPrices();
loadFeederWeightPrices();
updateSlaughterWeightTable();
updateCornCardCattle();
// Retry corn card after data fully loads
setTimeout(updateCornCardCattle, 3000);
initLocation();
calcGrain();
calcSoy();
calc();
calcDairy();
updateRegionBadge();
// Build directories — slight delay to ensure DOM is ready
setTimeout(()=>{ rebuildElevatorDirectory(); rebuildBarnSelect(); buildBarnDirectory(); buildLockerDirectory(); rebuildDairyPlantSelect(); buildDairyPlantDirectory(); }, 100);

setInterval(loadGrainPrices,15*60*1000);
setInterval(loadCattlePrices,15*60*1000);
setInterval(loadDairyPrices,15*60*1000);
setInterval(()=>{if(userLat)loadWeather(userLat,userLon);},30*60*1000);

if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}
