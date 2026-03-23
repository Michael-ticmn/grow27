
// ── FIELD SYNC (slider ↔ number input) ───────────────────────────────────────
// Safely update a calc field value label without destroying the unit span
function setFieldVal(id, text) {
  const el = document.getElementById(id);
  if(!el) return;
  const unit = el.querySelector('span');
  el.textContent = text + ' ';
  if(unit) el.appendChild(unit);
}

function syncField(id, val, decimals, prefix) {
  const v = parseFloat(val) || 0;
  const numStr = prefix ? prefix + v.toFixed(decimals) : v.toFixed(decimals);
  // Update both inputs
  const slider = document.getElementById(id);
  const numInput = document.getElementById(id + '-n');
  if(slider) slider.value = v;
  if(numInput) numInput.value = v;
  // Update display label — preserve the unit <span> inside the value span
  const label = document.getElementById(id.replace('-','') + '-val') ||
                document.getElementById(id + '-val');
  if(label) {
    const unitSpan = label.querySelector('span');
    if(unitSpan) {
      label.textContent = numStr + ' ';
      label.appendChild(unitSpan);
    } else {
      label.textContent = numStr;
    }
  }
}
// grow27 — markets.js
// Grain prices, cattle prices, charts, margin calculators, local buyers, OSM discovery
// ─────────────────────────────────────────────────────────────────────────────

// ── GRAIN PRICES ─────────────────────────────────────────────────────────────
let GRAIN_DATA={cn:{price:4.35,open:4.31,high:4.42,low:4.28,change:0.04,pct:0.93},cn2:{price:4.52,open:4.49,high:4.58,low:4.46,change:0.03,pct:0.67},sb:{price:9.72,open:9.68,high:9.80,low:9.61,change:0.04,pct:0.41},sb2:{price:10.05,open:10.01,high:10.12,low:9.97,change:0.04,pct:0.40}};

async function loadGrainPrices(){
  const fb={cn:{price:4.3475,open:4.3100,high:4.3775,low:4.2875,change:0.0375,pct:0.87},cn2:{price:4.5225,open:4.4900,high:4.5500,low:4.4750,change:0.0325,pct:0.72},sb:{price:9.7225,open:9.6800,high:9.8100,low:9.6200,change:0.0425,pct:0.44},sb2:{price:10.045,open:10.010,high:10.120,low:9.970,change:0.0350,pct:0.35}};
  async function fetchOne(sym){try{const r=await fetch('https://stooq.com/q/l/?s='+sym+'&f=sd2t2ohlcv&h&e=csv');const t=await r.text();const cols=t.trim().split('\n')[1]?.split(',');if(!cols)throw 0;const[open,high,low,close]=[3,4,5,6].map(i=>parseFloat(cols[i]));if(isNaN(close))throw 0;return{price:close,open,high,low,change:close-open,pct:((close-open)/open)*100};}catch{return null;}}
  const[cn,cn2,sb,sb2]=await Promise.all([fetchOne('c.f'),fetchOne('ch.f'),fetchOne('s.f'),fetchOne('sh.f')]);
  GRAIN_DATA={cn:cn||fb.cn,cn2:cn2||fb.cn2,sb:sb||fb.sb,sb2:sb2||fb.sb2};
  const isLive=[cn,cn2,sb,sb2].some(Boolean);document.getElementById('status-txt').textContent=isLive?'Live data':'Recent values';cbotNow=new Date();const cbotTs='as of '+cbotNow.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' '+cbotNow.toLocaleDateString('en-US',{month:'short',day:'numeric'});['cn','cn2','sb','sb2'].forEach(id=>{const el=document.getElementById('cbot-ts-'+id);if(el)el.textContent=cbotTs;});
  function setCard(id,d){const el=document.getElementById('p-'+id);el.textContent='$'+d.price.toFixed(4);el.style.color=d.change>0.003?'var(--up)':d.change<-0.003?'var(--down)':'var(--corn)';document.getElementById('h-'+id).textContent=d.high.toFixed(4);document.getElementById('l-'+id).textContent=d.low.toFixed(4);document.getElementById('v-'+id).textContent=d.open.toFixed(4);setBadge('b-'+id,d.change,d.pct);}
  setCard('cn',GRAIN_DATA.cn);setCard('cn2',GRAIN_DATA.cn2);setCard('sb',GRAIN_DATA.sb);setCard('sb2',GRAIN_DATA.sb2);
  buildCashTable();
  updateCornCardCattle();
  markUpdated();
}

// ── CATTLE PRICES ────────────────────────────────────────────────────────────
let CATTLE_DATA={lc:null,fc:null,cn:null},histRange=90,charts={};

async function loadCattlePrices(){
  const fb={lc:{price:231.50,open:230.90,high:232.10,low:229.80,change:0.60,pct:0.26},fc:{price:354.50,open:349.85,high:355.35,low:345.08,change:4.65,pct:1.33},cn:{price:4.5250,open:4.4875,high:4.5750,low:4.4600,change:0.0375,pct:0.84}};
  async function fetchOne(sym){try{const r=await fetch('https://stooq.com/q/l/?s='+sym+'&f=sd2t2ohlcv&h&e=csv');const t=await r.text();const cols=t.trim().split('\n')[1]?.split(',');if(!cols)throw 0;const[open,high,low,close]=[3,4,5,6].map(i=>parseFloat(cols[i]));if(isNaN(close))throw 0;return{price:close,open,high,low,change:close-open,pct:((close-open)/open)*100};}catch{return null;}}
  const[lc,fc,cn]=await Promise.all([fetchOne('lc.f'),fetchOne('fc.f'),fetchOne('c.f')]);
  CATTLE_DATA={lc:lc||fb.lc,fc:fc||fb.fc,cn:cn||fb.cn};
  function set(id,suffix,d,isCorn){const fmt=v=>isCorn?v.toFixed(4):v.toFixed(2);const el=document.getElementById('p-'+id+suffix);if(!el)return;el.textContent=isCorn?'$'+fmt(d.price):fmt(d.price);el.style.color=d.change>0.005?'var(--up)':d.change<-0.005?'var(--down)':'var(--corn)';const h=document.getElementById('h-'+id+suffix);const l=document.getElementById('l-'+id+suffix);const v=document.getElementById('v-'+id+suffix);if(h)h.textContent=fmt(d.high);if(l)l.textContent=fmt(d.low);if(v)v.textContent=fmt(d.open);setBadge('b-'+id+suffix,d.change,d.pct);}
  set('lc','-c',CATTLE_DATA.lc,false); // NOTE: cattle corn card uses suffix -c to avoid ID clash with grain
  // Wait — cattle cards use p-lc, p-fc, p-cn-c  (the -c suffix for cattle corn only)
  const lcEl=document.getElementById('p-lc');if(lcEl){lcEl.textContent=CATTLE_DATA.lc.price.toFixed(2);lcEl.style.color=CATTLE_DATA.lc.change>0.005?'var(--up)':CATTLE_DATA.lc.change<-0.005?'var(--down)':'var(--corn)';document.getElementById('h-lc').textContent=CATTLE_DATA.lc.high.toFixed(2);document.getElementById('l-lc').textContent=CATTLE_DATA.lc.low.toFixed(2);document.getElementById('v-lc').textContent=CATTLE_DATA.lc.open.toFixed(2);setBadge('b-lc',CATTLE_DATA.lc.change,CATTLE_DATA.lc.pct);}
  // Set feeder card with type discount applied
  if(document.getElementById('p-fc')) {
    const feederDisc = (CATTLE_TYPE_DISCOUNTS[cattleType]?.discountCwt || 0) * 0.4;
    const fcAdj = (CATTLE_DATA.fc.price - feederDisc).toFixed(2);
    const fcEl = document.getElementById('p-fc');
    fcEl.textContent = fcAdj;
    fcEl.style.color = CATTLE_DATA.fc.change>0.005?'var(--up)':CATTLE_DATA.fc.change<-0.005?'var(--down)':'var(--corn)';
    document.getElementById('h-fc').textContent = (CATTLE_DATA.fc.high - feederDisc).toFixed(2);
    document.getElementById('l-fc').textContent = (CATTLE_DATA.fc.low  - feederDisc).toFixed(2);
    document.getElementById('v-fc').textContent = (CATTLE_DATA.fc.open - feederDisc).toFixed(2);
    const adjOpen = CATTLE_DATA.fc.open - feederDisc;
    const adjChg  = parseFloat(fcAdj) - adjOpen;
    setBadge('b-fc', adjChg, (adjChg/adjOpen)*100);
    // Update card name to reflect cattle type
    const fcName = document.getElementById('fc-card-name');
    if(fcName) fcName.textContent = (CATTLE_TYPE_DISCOUNTS[cattleType]?.label || 'Beef Steer') + ' Feeder';
  }
  const cnCEl=document.getElementById('p-cn-c');if(cnCEl){cnCEl.textContent='$'+CATTLE_DATA.cn.price.toFixed(4);cnCEl.style.color=CATTLE_DATA.cn.change>0.003?'var(--up)':CATTLE_DATA.cn.change<-0.003?'var(--down)':'var(--corn)';document.getElementById('h-cn-c').textContent=CATTLE_DATA.cn.high.toFixed(4);document.getElementById('l-cn-c').textContent=CATTLE_DATA.cn.low.toFixed(4);document.getElementById('v-cn-c').textContent=CATTLE_DATA.cn.open.toFixed(4);setBadge('b-cn-c',CATTLE_DATA.cn.change,CATTLE_DATA.cn.pct);}
  const{lc:l,fc:f,cn:c}=CATTLE_DATA;
  let msg='';
  if(l.change>0&&f.change>0)msg='<strong>Both cattle markets moving up</strong> — favorable selling conditions today.';
  else if(l.change>0&&f.change<=0)msg='<strong>Live up, feeder flat</strong> — spread widening. Good time to evaluate near-finish animals.';
  else if(c.price>5.0)msg='<strong>Corn above $5.00/bu</strong> — high feed value. Check the margin calc for the sell-corn tradeoff.';
  else msg='Market stable. Live cattle <strong>'+l.price.toFixed(2)+'¢/lb</strong>, corn <strong>$'+c.price.toFixed(2)+'/bu</strong>.';
  document.getElementById('cattle-insight').innerHTML=msg;
  document.getElementById('sp').value=Math.round(l.price);const spNi=document.getElementById('sp-n');if(spNi)spNi.value=Math.round(l.price);setFieldVal('sp-val',Math.round(l.price));
  document.getElementById('cp').value=c.price.toFixed(2);const cpNi=document.getElementById('cp-n');if(cpNi)cpNi.value=c.price.toFixed(2);setFieldVal('cp-val','$'+c.price.toFixed(2));
  calc();renderSeasonal();
  updateSlaughterWeightTable();
  buildBarnTable(); // refresh feeder avg column now that CATTLE_DATA.fc is loaded
  markUpdated();
}

// ── CATTLE CHARTS ─────────────────────────────────────────────────────────────
function genHistory(price,days,vol=0.008){const arr=[];let p=price*(1-(Math.random()*0.05));for(let i=0;i<days;i++){p=p*(1+(Math.random()-0.49)*vol);arr.push(parseFloat(p.toFixed(3)));}arr.push(price);return arr;}
function genLabels(days){const labs=[],now=new Date();for(let i=days;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);labs.push((d.getMonth()+1)+'/'+d.getDate());}return labs;}
// Monthly helpers — used by dairy premium chart (rolling 13 months)
function genMonthlyLabels(n){const MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],labs=[],now=new Date();for(let i=n-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);labs.push(MO[d.getMonth()]+' \''+(d.getFullYear()%100).toString().padStart(2,'0'));}return labs;}
function genMonthlyHistory(premium,n,vol=0.015){const arr=[];let p=premium*(1-(Math.random()*0.04));for(let i=0;i<n-1;i++){p=p*(1+(Math.random()-0.49)*vol);arr.push(parseFloat(p.toFixed(3)));}arr.push(premium);return arr;}
function makeLine(id,labels,datasets,opts={}){if(charts[id])charts[id].destroy();const ctx=document.getElementById(id);if(!ctx)return;charts[id]=new Chart(ctx,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false}},scales:{x:{ticks:{color:'#5e6369',font:{size:11},maxTicksLimit:8,maxRotation:0},grid:{color:'#252a31'}},y:{ticks:{color:'#5e6369',font:{size:11}},grid:{color:'#252a31'}}},elements:{point:{radius:0,hitRadius:12},line:{tension:0.35}}}});}
function renderHistCharts(){const{lc,fc,cn}=CATTLE_DATA;if(!lc)return;const labs=genLabels(histRange);makeLine('hist-lc',labs,[{label:'Live Cattle',data:genHistory(lc.price,histRange,0.01),borderColor:'#c46a40',borderWidth:2,fill:false}]);makeLine('hist-fc',labs,[{label:'Feeder Cattle',data:genHistory(fc.price,histRange,0.012),borderColor:'#d4a027',borderWidth:2,fill:false}]);makeLine('hist-cn-chart',labs,[{label:'Corn',data:genHistory(cn.price,histRange,0.015),borderColor:'#3ea8aa',borderWidth:2,fill:false}]);const lcH=genHistory(lc.price,histRange,0.01),fcH=genHistory(fc.price,histRange,0.012);makeLine('hist-spread',labs,[{label:'Spread',data:lcH.map((v,i)=>parseFloat((v-fcH[i]).toFixed(2))),borderColor:'#d4a027',borderWidth:2,fill:true,backgroundColor:'rgba(212,160,39,.07)'}]);}
function setRange(r,btn){histRange=r;document.querySelectorAll('.hist-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderHistCharts();}
function renderSeasonal(){if(charts['seasonal-chart'])charts['seasonal-chart'].destroy();const ctx=document.getElementById('seasonal-chart');if(!ctx)return;const seasonal=[2.1,1.8,3.2,3.8,3.5,1.2,-0.8,-1.5,-2.1,-0.5,2.2,1.4];const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const curMonth=new Date().getMonth();const colors=seasonal.map((_,i)=>i===curMonth?'#d4a027':seasonal[i]>=0?'rgba(60,185,106,.55)':'rgba(224,80,80,.5)');charts['seasonal-chart']=new Chart(ctx,{type:'bar',data:{labels:months,datasets:[{data:seasonal,backgroundColor:colors,borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>(c.raw>=0?'+':'')+c.raw+'% vs annual avg'}}},scales:{x:{ticks:{color:'#5e6369',font:{size:11}},grid:{display:false}},y:{ticks:{color:'#5e6369',font:{size:11},callback:v=>(v>=0?'+':'')+v+'%'},grid:{color:'#252a31'}}}}});}

// ── CATTLE MARGIN CALC ───────────────────────────────────────────────────────

// ── GRAIN MARGIN CALC ────────────────────────────────────────────────────────

// ── CATTLE MARGIN CALC ───────────────────────────────────────────────────────
function calc(){
  const bw  = +document.getElementById('bw').value;
  const bp  = +document.getElementById('bp').value / 100;
  const sw  = +document.getElementById('sw').value;
  const dof = +document.getElementById('dof').value;
  const sp  = +document.getElementById('sp').value / 100;
  const herd = Math.max(1, +document.getElementById('herd-count').value || 150);

  // Feed costs
  const cf   = +document.getElementById('cf').value;
  const cp   = +document.getElementById('cp').value;
  const sbm  = +(document.getElementById('sbm')  ? document.getElementById('sbm').value  : 0);
  const sbmp = +(document.getElementById('sbmp') ? document.getElementById('sbmp').value : 320);
  const ddg  = +(document.getElementById('ddg')  ? document.getElementById('ddg').value  : 0);
  const ddgp = +(document.getElementById('ddgp') ? document.getElementById('ddgp').value : 180);
  const pro  = +(document.getElementById('pro')  ? document.getElementById('pro').value  : 0);
  const prop = +(document.getElementById('prop') ? document.getElementById('prop').value : 450);
  const hay  = +(document.getElementById('hay')  ? document.getElementById('hay').value  : 0);
  const hayp = +(document.getElementById('hayp') ? document.getElementById('hayp').value : 200);
  const oc   = +document.getElementById('oc').value;

  // Per head costs
  const buyCost  = bw * bp;
  const cornCost = dof * cf * cp;
  const sbmCost  = dof * sbm  * (sbmp  / 2000);   // lbs/day × days × $/lb (ton÷2000)
  const ddgCost  = dof * ddg  * (ddgp  / 2000);
  const proCost  = dof * pro  * (prop  / 2000);
  const hayCost  = dof * hay  * (hayp  / 2000);
  const otherCost= dof * oc;

  const totalFeedCost = cornCost + sbmCost + ddgCost + proCost + hayCost;
  const totalCost = buyCost + totalFeedCost + otherCost;
  const revenue = sw * sp;
  const margin  = revenue - totalCost;

  // Update results
  document.getElementById('r-buy').textContent   = fmt$(buyCost);
  document.getElementById('r-corn').textContent  = fmt$(totalFeedCost);
  document.getElementById('r-other').textContent = fmt$(otherCost);
  document.getElementById('r-total').textContent = fmt$(totalCost);
  document.getElementById('r-rev').textContent   = fmt$(revenue);
  document.getElementById('r-margin').textContent= fmt$(margin);
  document.getElementById('r-margin-row').className = 'result-row total ' + (margin >= 0 ? 'profit' : 'loss');

  // Herd totals
  document.getElementById('herd-rev').textContent  = fmtK(revenue * herd);
  document.getElementById('herd-cost').textContent = fmtK(totalCost * herd);
  const hm = document.getElementById('herd-margin');
  hm.textContent = fmtK(margin * herd);
  hm.style.color = margin >= 0 ? 'var(--up)' : 'var(--down)';
  const dailyFeed = (cf * cp) + (sbm * sbmp / 2000) + (ddg * ddgp / 2000) + (pro * prop / 2000) + (hay * hayp / 2000) + oc;
  document.getElementById('herd-daily').textContent = fmtK(dailyFeed * herd);

  // Verdict
  const verd = document.getElementById('verdict');
  if(margin > 200)      { verd.className = 'verdict feed-steer'; verd.textContent = 'Feed to finish — strong margin of ' + fmt$(margin) + '/head at current prices.'; }
  else if(margin > 0)   { verd.className = 'verdict neutral';    verd.textContent = 'Marginal at ' + fmt$(margin) + '/head. Watch feed costs and market timing closely.'; }
  else                  { verd.className = 'verdict sell-corn';  verd.textContent = 'Currently losing ' + fmt$(Math.abs(margin)) + '/head to finish. Consider selling or adjusting ration.'; }
}

// ── GRAIN MARGIN CALC ────────────────────────────────────────────────────────
function calcGrain(){const yld=+document.getElementById('c-yield').value,seed=+document.getElementById('c-seed').value,fert=+document.getElementById('c-fert').value,chem=+document.getElementById('c-chem').value,land=+document.getElementById('c-land').value,mach=+document.getElementById('c-mach').value,dry=+document.getElementById('c-dry').value*yld,sale=+document.getElementById('c-sale').value,acres=+document.getElementById('c-acres').value||400;document.getElementById('cv-sale').textContent='$'+sale.toFixed(2);const total=seed+fert+chem+land+mach+dry,be=total/yld,rev=yld*sale,margin=rev-total;document.getElementById('cr-seed').textContent=fmt$(seed);document.getElementById('cr-fert').textContent=fmt$(fert);document.getElementById('cr-chem').textContent=fmt$(chem);document.getElementById('cr-land').textContent=fmt$(land);document.getElementById('cr-mach').textContent=fmt$(mach);document.getElementById('cr-dry').textContent=fmt$(dry);document.getElementById('cr-total').textContent=fmt$(total);document.getElementById('cr-be').textContent='$'+be.toFixed(2)+'/bu';document.getElementById('cr-rev').textContent=fmt$(rev);document.getElementById('cr-margin').textContent=fmt$(margin);document.getElementById('cr-margin-row').className='result-row total '+(margin>=0?'profit':'loss');const vEl=document.getElementById('c-verdict');if(sale>be+0.30){vEl.className='verdict strong-sell';vEl.innerHTML='<strong>Strong sell signal.</strong> You are $'+(sale-be).toFixed(2)+'/bu above break-even.';}else if(sale>be+0.05){vEl.className='verdict hold';vEl.innerHTML='<strong>Above break-even.</strong> Modest margin of $'+(sale-be).toFixed(2)+'/bu.';}else if(sale>=be){vEl.className='verdict neutral';vEl.innerHTML='<strong>At/near break-even.</strong> Only $'+(sale-be).toFixed(2)+'/bu margin.';}else{vEl.className='verdict neutral';vEl.innerHTML='<strong>Below break-even.</strong> Loss of $'+(be-sale).toFixed(2)+'/bu.';}document.getElementById('cf-rev').textContent=fmtK(rev*acres);document.getElementById('cf-cost').textContent=fmtK(total*acres);const fm=margin*acres;document.getElementById('cf-margin').textContent=fmtK(fm);document.getElementById('cf-margin').style.color=fm>=0?'var(--up)':'var(--down)';document.getElementById('cf-be').textContent='$'+be.toFixed(2)+'/bu';}
function calcSoy(){const yld=+document.getElementById('s-yield').value,seed=+document.getElementById('s-seed').value,fert=+document.getElementById('s-fert').value,chem=+document.getElementById('s-chem').value,land=+document.getElementById('s-land').value,mach=+document.getElementById('s-mach').value,sale=+document.getElementById('s-sale').value,acres=+document.getElementById('s-acres').value||400;document.getElementById('sv-sale').textContent='$'+sale.toFixed(2);const total=seed+fert+chem+land+mach,be=total/yld,rev=yld*sale,margin=rev-total;document.getElementById('sr-seed').textContent=fmt$(seed);document.getElementById('sr-fert').textContent=fmt$(fert);document.getElementById('sr-chem').textContent=fmt$(chem);document.getElementById('sr-land').textContent=fmt$(land);document.getElementById('sr-mach').textContent=fmt$(mach);document.getElementById('sr-total').textContent=fmt$(total);document.getElementById('sr-be').textContent='$'+be.toFixed(2)+'/bu';document.getElementById('sr-rev').textContent=fmt$(rev);document.getElementById('sr-margin').textContent=fmt$(margin);document.getElementById('sr-margin-row').className='result-row total '+(margin>=0?'profit':'loss');const vEl=document.getElementById('s-verdict');if(sale>be+1.50){vEl.className='verdict strong-sell';vEl.innerHTML='<strong>Strong sell signal.</strong> You are $'+(sale-be).toFixed(2)+'/bu above break-even.';}else if(sale>be+0.25){vEl.className='verdict hold';vEl.innerHTML='<strong>Above break-even.</strong> Margin of $'+(sale-be).toFixed(2)+'/bu.';}else if(sale>=be){vEl.className='verdict neutral';vEl.innerHTML='<strong>At/near break-even.</strong> Only $'+(sale-be).toFixed(2)+'/bu margin.';}else{vEl.className='verdict neutral';vEl.innerHTML='<strong>Below break-even.</strong> Loss of $'+(be-sale).toFixed(2)+'/bu.';}document.getElementById('sf-rev').textContent=fmtK(rev*acres);document.getElementById('sf-cost').textContent=fmtK(total*acres);const fm=margin*acres;document.getElementById('sf-margin').textContent=fmtK(fm);document.getElementById('sf-margin').style.color=fm>=0?'var(--up)':'var(--down)';document.getElementById('sf-be').textContent='$'+be.toFixed(2)+'/bu';}

// ── LOCAL BUYERS (GRAIN) ─────────────────────────────────────────────────────
const REGION_A={id:'regionA',label:'Area 1',sublabel:'Mountain Lake · Fairmont · Trimont',centerLat:43.88,centerLon:-94.76,elevators:{newvision:{name:'New Vision Coop',loc:'Mountain Lake MN',lat:44.0297,lon:-94.9346,cornBasis:-0.20,soyBasis:-0.28,curated:true,region:'A',phone:'(507) 427-2419',phoneLabel:'Grain'},cfs:{name:'CFS — St. James',loc:'St. James MN',lat:43.9822,lon:-94.6271,cornBasis:-0.18,soyBasis:-0.25,curated:true,region:'A',phone:'(507) 375-3350',phoneLabel:'Grain'},cfscv:{name:'Crystal Valley (CFS)',loc:'Crystal Valley MN',lat:44.0300,lon:-94.8000,cornBasis:-0.22,soyBasis:-0.27,curated:true,region:'A',phone:'(507) 639-2031',phoneLabel:'Location'},trimont:{name:'Crystal Valley — Trimont',loc:'Trimont MN',lat:43.7622,lon:-94.7110,cornBasis:-0.16,soyBasis:-0.24,curated:true,region:'A',phone:'(507) 639-2031',phoneLabel:'Grain'},chs:{name:'CHS Fairmont',loc:'Fairmont MN',lat:43.6522,lon:-94.4614,cornBasis:-0.19,soyBasis:-0.26,curated:true,region:'A',phone:'(800) 652-9727',phoneLabel:'Grain'},poet:{name:'POET Biorefining',loc:'Bingham Lake MN',lat:43.8944,lon:-95.0414,cornBasis:-0.14,soyBasis:null,curated:true,region:'A',phone:'(507) 831-0067',phoneLabel:'Commodity'}}};
const REGION_B={id:'regionB',label:'Area 2',sublabel:'Northfield · Kenyon · Owatonna · Le Center',centerLat:44.29,centerLon:-93.27,elevators:{cfs_nfield:{name:'CFS — Northfield Grain',loc:'Northfield MN',lat:44.4560,lon:-93.1627,cornBasis:-0.17,soyBasis:-0.24,curated:true,region:'B',note:'1600 Hwy 3 S · daily cash bids online',url:'https://www.centralfarmservice.com',phone:'(507) 263-2050',phoneLabel:'Grain'},cfs_kenyon:{name:'CFS — Kenyon Grain',loc:'Kenyon MN',lat:44.2716,lon:-93.0011,cornBasis:-0.18,soyBasis:-0.25,curated:true,region:'B',note:'806 2nd St · futures contracting',url:'https://www.centralfarmservice.com',phone:'(507) 263-2050',phoneLabel:'Grain'},cfs_owatonna:{name:'CFS — Owatonna Main',loc:'Owatonna MN',lat:44.0836,lon:-93.2241,cornBasis:-0.19,soyBasis:-0.26,curated:true,region:'B',note:'712 N Cedar Ave · harvest extended hours',url:'https://www.centralfarmservice.com',phone:'(507) 451-1230',phoneLabel:'Main'},mnvg_webster:{name:'MN Valley Grain — Webster',loc:'Webster MN',lat:44.4000,lon:-93.3700,cornBasis:-0.21,soyBasis:-0.28,curated:true,region:'B',note:'Corn & soybeans · DP contracts',url:null,phone:'(507) 357-6841',phoneLabel:'Office'},mnvg_montgomery:{name:'MN Valley Grain — Montgomery',loc:'Montgomery MN',lat:44.4383,lon:-93.5822,cornBasis:-0.20,soyBasis:-0.27,curated:true,region:'B',note:'Delayed Pricing contracts for both crops',url:null,phone:'(507) 357-6841',phoneLabel:'Office'},mnvg_lecenter:{name:'MN Valley Grain — Le Center',loc:'Le Center MN',lat:44.3922,lon:-93.7302,cornBasis:-0.21,soyBasis:-0.28,curated:true,region:'B',note:'Corn & soybeans — buy, sell, store',url:null,phone:'(507) 357-6841',phoneLabel:'Office'},farmers_elev:{name:'Farmers Elevator — Hope',loc:'Hope MN',lat:44.0500,lon:-93.3400,cornBasis:-0.18,soyBasis:-0.25,curated:true,region:'B',note:'New Crop Delayed Pricing · open storage',url:'https://www.hopegrain.com',phone:'(507) 451-9020',phoneLabel:'Main'},agpartners_gd:{name:'Ag Partners — Goodhue',loc:'Goodhue MN',lat:44.3972,lon:-92.6261,cornBasis:-0.16,soyBasis:-0.23,curated:true,region:'B',note:'Market-specific cash bids · service charge schedules',url:'https://agpartners.net',phone:'(651) 923-4496',phoneLabel:'Main'},agpartners_bc:{name:'Ag Partners — Bellechester',loc:'Bellechester MN',lat:44.3750,lon:-92.4836,cornBasis:-0.17,soyBasis:-0.24,curated:true,region:'B',note:'Drying & storage schedules online',url:'https://agpartners.net',phone:'(651) 923-4453',phoneLabel:'Grain'},
    jennyo:{name:'Jennie-O Turkey Store',loc:'Faribault MN',lat:44.2955,lon:-93.2688,cornBasis:-0.12,soyBasis:null,curated:true,region:'B',note:'Major turkey processor — corn buyer only · call for daily bids',url:'https://www.jennieo.com',phone:'(507) 334-5555',phoneLabel:'Grain'},
    alcorn:{name:'Al-Corn Clean Fuel',loc:'Claremont MN',lat:44.0369,lon:-92.9880,cornBasis:-0.10,soyBasis:null,curated:true,region:'B',note:'Ethanol plant — corn only · 44M bu/yr grind · call for daily bids',url:'https://www.al-corn.com',phone:'(507) 681-7100',phoneLabel:'Grain'}}};
let activeRegion='auto';
let CURATED=Object.assign({},REGION_A.elevators,REGION_B.elevators);
let ELEVATORS=Object.assign({},CURATED);
let userLat=null,userLon=null;

// ── GRAIN SCRAPER DATA OVERLAY ──────────────────────────────────────────────
// Maps curated elevator keys → { source: grain-config id, location: slug in index.json }
const GRAIN_SCRAPE_MAP = {
  cfs:               { source: 'cfs', location: 'st-james' },
  cfs_nfield:        { source: 'cfs', location: 'northfield' },
  cfs_kenyon:        { source: 'cfs', location: 'kenyon' },
  mnvg_webster:      { source: 'mvg', location: 'webster' },
  mnvg_montgomery:   { source: 'mvg', location: 'montgomery' },
  mnvg_lecenter:     { source: 'mvg', location: 'le-center' },
  agpartners_gd:     { source: 'agp', location: 'goodhue' },
  agpartners_bc:     { source: 'agp', location: 'bellechester' },
};
let GRAIN_SCRAPED = {}; // populated by loadGrainScrapedData()
let GRAIN_SCRAPE_DATES = {}; // { sourceId: "2026-03-22" }

async function loadGrainScrapedData() {
  try {
    const r = await fetch('data/prices/grain/index.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const idx = await r.json();
    // Build lookup: { sourceId: { locationSlug: { corn: [...], beans: [...] } } }
    for (const src of idx) {
      GRAIN_SCRAPED[src.id] = src.locations || {};
      GRAIN_SCRAPE_DATES[src.id] = src.scrapedAt || src.date || null;
    }
    console.log('[grain] loaded scraped data:', Object.keys(GRAIN_SCRAPED).join(', '));

    // Overlay actual basis onto ELEVATORS
    let updated = 0;
    for (const [elevKey, map] of Object.entries(GRAIN_SCRAPE_MAP)) {
      const elev = ELEVATORS[elevKey];
      if (!elev) continue;
      const locData = GRAIN_SCRAPED[map.source]?.[map.location];
      if (!locData) continue;
      const scrapeDate = GRAIN_SCRAPE_DATES[map.source] || null; // ISO datetime or date string
      // Use nearby (first) corn bid — store cash, basis, and futures data
      const cornNearby = locData.corn?.[0];
      if (cornNearby && cornNearby.basis != null) {
        elev.cornBasis = cornNearby.basis;
        elev.cornCash = cornNearby.cash;
        elev.cornCbot = cornNearby.cbot;
        elev.cornFuturesMonth = cornNearby.futuresMonth;
        elev.cornActual = true;
        elev.cornActualDate = scrapeDate;
      }
      // Use nearby (first) bean bid — store cash, basis, and futures data
      const beanNearby = locData.beans?.[0];
      if (beanNearby && beanNearby.basis != null) {
        elev.soyBasis = beanNearby.basis;
        elev.soyCash = beanNearby.cash;
        elev.soyCbot = beanNearby.cbot;
        elev.soyFuturesMonth = beanNearby.futuresMonth;
        elev.soyActual = true;
        elev.soyActualDate = scrapeDate;
      }
      updated++;
    }
    console.log('[grain] overlaid actual prices on ' + updated + ' elevators');
    buildCashTable();
    rebuildElevatorDirectory();
    updateGrainInsight();
  } catch (e) {
    console.warn('[grain] could not load scraped data:', e.message);
  }
}

function getCuratedForRegion(k){if(k==='A')return REGION_A.elevators;if(k==='B')return REGION_B.elevators;return{...REGION_A.elevators,...REGION_B.elevators};}
function autoDetectRegion(){if(!userLat||!userLon)return'both';const dA=distMiles(userLat,userLon,REGION_A.centerLat,REGION_A.centerLon),dB=distMiles(userLat,userLon,REGION_B.centerLat,REGION_B.centerLon);if(Math.abs(dA-dB)<25)return'both';return dA<dB?'A':'B';}
function setRegion(k){activeRegion=k;const discovered=Object.fromEntries(Object.entries(ELEVATORS).filter(([,e])=>e.discovered));CURATED=getCuratedForRegion(k==='auto'?autoDetectRegion():k);ELEVATORS=Object.assign({},CURATED,discovered);document.querySelectorAll('.region-btn').forEach(b=>b.classList.toggle('active',b.dataset.region===k));rebuildElevatorSelect();buildCashTable();rebuildElevatorDirectory();updateRegionBadge();}
function updateRegionBadge(){const el=document.getElementById('active-region-label');if(!el)return;const eff=activeRegion==='auto'?(userLat?autoDetectRegion():'both'):activeRegion;if(eff==='A')el.textContent=REGION_A.label+' — '+REGION_A.sublabel;else if(eff==='B')el.textContent=REGION_B.label+' — '+REGION_B.sublabel;else el.textContent='All regions — '+REGION_A.label+' + '+REGION_B.label;}
function sortedElevatorKeys(){const keys=Object.keys(ELEVATORS);if(!userLat)return keys;return keys.slice().sort((a,b)=>distMiles(userLat,userLon,ELEVATORS[a].lat,ELEVATORS[a].lon)-distMiles(userLat,userLon,ELEVATORS[b].lat,ELEVATORS[b].lon));}
function onElevChange(){const key=document.getElementById('elev-select').value;const disp=document.getElementById('elev-basis-display');const distEl=document.getElementById('elev-dist-display');if(!key){disp.style.display='none';distEl.textContent='';updateGrainInsight();return;}const e=ELEVATORS[key];let html='<strong>'+e.name+'</strong> — Corn basis: ';const cb=e.cornBasis;html+='<span style="color:'+(cb>=0?'var(--up)':'var(--down)')+'">'+(cb>=0?'+':'')+cb.toFixed(2)+'</span>';if(e.soyBasis!==null){const sb=e.soyBasis;html+='  &nbsp;·&nbsp;  Soy basis: <span style="color:'+(sb>=0?'var(--up)':'var(--down)')+'">'+(sb>=0?'+':'')+sb.toFixed(2)+'</span>';}else{html+='  &nbsp;·&nbsp;  <span style="color:var(--txt3)">Soy: N/A</span>';}disp.innerHTML=html;disp.style.display='';if(userLat&&userLon){const d=Math.round(distMiles(userLat,userLon,e.lat,e.lon));distEl.textContent='~'+d+' mi away';}highlightTableRow(key);updateGrainInsight();}
function highlightTableRow(key){document.querySelectorAll('#cash-table-body tr').forEach(tr=>tr.classList.toggle('selected',tr.dataset.key===key));}
function selectFromTable(key){document.getElementById('elev-select').value=key;onElevChange();}
function rebuildElevatorSelect(){const sel=document.getElementById('elev-select');if(!sel)return;const cur=sel.value;const sorted=sortedElevatorKeys();sel.innerHTML='<option value="">Select local buyer…</option>';const groups={A:[],B:[],discovered:[]};sorted.forEach(k=>{const e=ELEVATORS[k];if(e.discovered)groups.discovered.push(k);else if(e.region==='B')groups.B.push(k);else groups.A.push(k);});function addGroup(label,keys){if(!keys.length)return;const og=document.createElement('optgroup');og.label=label;keys.forEach(k=>{const e=ELEVATORS[k];const dist=userLat?Math.round(distMiles(userLat,userLon,e.lat,e.lon)):null;const opt=document.createElement('option');opt.value=k;opt.textContent=e.name+' — '+e.loc+(dist!==null?' (~'+dist+' mi)':'');og.appendChild(opt);});sel.appendChild(og);}addGroup('Area 1 — Curated',groups.A);addGroup('Area 2 — Curated',groups.B);addGroup('Discovered Nearby',groups.discovered);if(cur&&ELEVATORS[cur])sel.value=cur;else if(userLat&&sorted.length){sel.value=sorted[0];onElevChange();}}
function buildCashTable(){const tbody=document.getElementById('cash-table-body');if(!tbody)return;const sorted=sortedElevatorKeys();const rows=sorted.map((key,idx)=>{const e=ELEVATORS[key];const cornFut=GRAIN_DATA.cn.price,soyFut=GRAIN_DATA.sb.price;const cornCash=(e.cornActual&&e.cornCash!=null)?e.cornCash.toFixed(4):(cornFut+e.cornBasis).toFixed(4);const soyCash=e.soyBasis===null?'—':((e.soyActual&&e.soyCash!=null)?e.soyCash.toFixed(4):(soyFut+e.soyBasis).toFixed(4));const cbClass=e.cornBasis>=0?'basis-pos':'basis-neg';const sbClass=e.soyBasis===null?'':(e.soyBasis>=0?'basis-pos':'basis-neg');const dist=userLat?Math.round(distMiles(userLat,userLon,e.lat,e.lon)):null;const distBadge=dist!==null?(idx===0?`<span style="color:var(--corn);background:var(--corn-dim);padding:2px 7px;border-radius:3px;font-size:11px;">${dist} mi ★</span>`:`<span style="font-size:12px;">${dist} mi</span>`):'—';const cbStr=(e.cornBasis>=0?'+':'')+e.cornBasis.toFixed(2);const sbStr=e.soyBasis!==null?((e.soyBasis>=0?'+':'')+e.soyBasis.toFixed(2)):'—';function fmtScrapeBadge(d){if(!d)return'';const dt=new Date(d.includes('T')?d:d+'T12:00:00');const mo=dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});const tm=d.includes('T')?(' '+dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})):'';const stale=(Date.now()-dt.getTime())>24*60*60*1000;const color=stale?'var(--down)':'var(--up)';return`<span style="margin-left:4px;font-size:8px;color:${color};border:1px solid ${color};border-radius:3px;padding:1px 4px;" title="Basis scraped ${d}">${mo}${tm}</span>`;}const cornBadge=e.cornActual?fmtScrapeBadge(e.cornActualDate):'';const soyBadge=e.soyActual?fmtScrapeBadge(e.soyActualDate):'';return`<tr data-key="${key}" onclick="selectFromTable('${key}')"><td><div class="elev-name-cell">${e.name}</div><div class="elev-loc-cell">${e.loc}</div></td><td class="cash-price-cell">$${cornCash}${cornBadge}</td><td class="${cbClass}">${cbStr}</td><td class="cash-price-cell soy">${soyCash!=='—'?'$'+soyCash+soyBadge:'<span style="color:var(--txt3)">—</span>'}</td><td class="${sbClass}">${sbStr}</td><td>${distBadge}</td></tr>`;});tbody.innerHTML=rows.join('');const cur=document.getElementById('elev-select').value;if(cur)highlightTableRow(cur);}
function updateGrainInsight(){
  const el=document.getElementById('grain-insight');
  if(!el)return;
  const selKey=document.getElementById('elev-select')?.value;
  const selElev=selKey?ELEVATORS[selKey]:null;
  const ts=cbotNow||new Date();
  const tsStr='<span style="color:var(--txt3);font-size:11px;"> · as of '+ts.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' '+ts.toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span>';

  // If a buyer is selected and has actual data, show their prices
  if(selElev&&selElev.cornActual){
    const parts=['<strong>'+selElev.name+'</strong>'];
    if(selElev.cornCash!=null)parts.push('Corn <strong>$'+selElev.cornCash.toFixed(4)+'</strong> (basis '+(selElev.cornBasis>=0?'+':'')+selElev.cornBasis.toFixed(2)+')');
    if(selElev.soyCash!=null)parts.push('Beans <strong>$'+selElev.soyCash.toFixed(4)+'</strong> (basis '+(selElev.soyBasis>=0?'+':'')+selElev.soyBasis.toFixed(2)+')');
    el.innerHTML=parts.join(' · ')+tsStr;
    return;
  }

  // No buyer selected or no actual data — show best actual prices
  let bestCorn=null,bestCornName='',bestSoy=null,bestSoyName='';
  for(const[k,e]of Object.entries(ELEVATORS)){
    if(e.cornActual&&e.cornCash!=null&&(bestCorn===null||e.cornCash>bestCorn)){bestCorn=e.cornCash;bestCornName=e.name;}
    if(e.soyActual&&e.soyCash!=null&&(bestSoy===null||e.soyCash>bestSoy)){bestSoy=e.soyCash;bestSoyName=e.name;}
  }
  if(bestCorn!==null||bestSoy!==null){
    const parts=[];
    if(bestCorn!==null)parts.push('Best corn: <strong>'+bestCornName+' $'+bestCorn.toFixed(4)+'</strong>');
    if(bestSoy!==null)parts.push('Best beans: <strong>'+bestSoyName+' $'+bestSoy.toFixed(4)+'</strong>');
    el.innerHTML=parts.join(' · ')+tsStr;
    return;
  }

  // Fallback — CBOT summary
  const{cn:c,sb:s}=GRAIN_DATA;
  let msg='';
  if(c.change>0&&s.change>0)msg='<strong>Both corn and beans moving up</strong> — positive selling conditions today.';
  else if(c.change>0&&s.change<=0)msg='<strong>Corn up, beans flat</strong> — corn offers the better opportunity today.';
  else if(c.change<=0&&s.change>0)msg='<strong>Beans stronger than corn today.</strong> Compare cash bids across buyers.';
  else msg='Market quiet. Corn <strong>$'+c.price.toFixed(4)+'</strong> nearby · Beans <strong>$'+s.price.toFixed(4)+'</strong> nearby.';
  el.innerHTML=msg+tsStr;
}
let cbotNow=null;
function rebuildElevatorDirectory() {
  const col1 = document.getElementById('elev-dir-col-1');
  const col2 = document.getElementById('elev-dir-col-2');
  if(!col1 || !col2) return;
  const sorted = sortedElevatorKeys();
  if(!sorted || sorted.length === 0) {
    col1.innerHTML = '<div style="color:var(--txt3);font-size:13px;padding:20px;">No buyers found for current region.</div>';
    return;
  }

  col1.innerHTML = '';
  col2.innerHTML = '';

  sorted.forEach((key, idx) => {
    const e = ELEVATORS[key];
    const dist = userLat ? Math.round(distMiles(userLat,userLon,e.lat,e.lon)) : null;
    const isNearest = idx === 0 && dist !== null;

    // Distance badge
    const distBadge = dist !== null
      ? `<span style="font-size:11px;color:var(--corn);background:var(--corn-dim);padding:3px 9px;border-radius:3px;white-space:nowrap;">${dist} mi${isNearest ? ' ★' : ''}</span>`
      : '';

    // Region + discovered badges
    const regionBadge = e.region==='A' ? `<span class="region-badge-a">Area 1</span>`
                      : e.region==='B' ? `<span class="region-badge-b">Area 2</span>` : '';
    const discoveredBadge = e.discovered
      ? `<span class="elev-crop-tag" style="background:var(--bg3);color:var(--txt3);font-size:9px;letter-spacing:1px;">Discovered</span>` : '';

    // Crop tags
    const cropTags = `<div class="elev-crops" style="margin-top:6px;">
      <span class="elev-crop-tag corn">Corn</span>
      ${e.soyBasis !== null ? '<span class="elev-crop-tag soy">Soybeans</span>' : ''}
    </div>`;

    // Basis block
    const cornBasisStr = (e.cornBasis >= 0 ? '+' : '') + e.cornBasis.toFixed(2);
    const soyBasisStr  = e.soyBasis !== null ? (e.soyBasis >= 0 ? '+' : '') + e.soyBasis.toFixed(2) : null;
    const cornTag = e.cornActual ? ' <span class="barn-src-badge barn-src-live" style="font-size:8px;">ACTUAL</span>' : e.curated ? '' : ' est.';
    const soyTag  = e.soyActual  ? ' <span class="barn-src-badge barn-src-live" style="font-size:8px;">ACTUAL</span>' : e.curated ? '' : ' est.';
    const basisBlock = `<div class="elev-details-row" style="margin-top:10px;">
      <div class="elev-detail-item">CORN BASIS
        <strong style="color:${e.cornActual?'var(--corn)':e.curated?'var(--corn)':'var(--txt3)'}">
          ${cornBasisStr}${cornTag}
        </strong>
      </div>
      ${soyBasisStr !== null ? `<div class="elev-detail-item">SOY BASIS
        <strong style="color:${e.soyActual?'var(--soy)':e.curated?'var(--soy)':'var(--txt3)'}">
          ${soyBasisStr}${soyTag}
        </strong>
      </div>` : ''}
    </div>`;

    // Address — use loc as fallback
    const addressHtml = `<div class="auction-detail">📍 ${e.loc}</div>`;

    // Phone
    const phoneHtml = e.phone
      ? `<div class="auction-detail">📞 <a href="tel:${e.phone}" style="color:var(--txt3);text-decoration:none;">${e.phone}${e.phoneLabel ? ' · ' + e.phoneLabel : ''}</a></div>`
      : `<div class="auction-detail" style="color:var(--txt3);font-style:italic;">📞 Phone not available</div>`;

    // Note
    const noteHtml = e.note
      ? `<div class="auction-detail" style="margin-top:6px;">${e.note}</div>` : '';
    const discoveredNote = e.discovered
      ? `<div class="auction-detail" style="font-style:italic;margin-top:4px;">Found via OpenStreetMap · basis estimated</div>` : '';

    // Links
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.name + ', ' + e.loc)}`;
    const websiteLink = e.url ? `<a href="${e.url}" target="_blank" rel="noopener" class="auction-link">Website ↗</a>` : '';
    const borderStyle = isNearest ? 'border-color:rgba(60,185,106,.25);' : '';

    const card = `<div class="panel" style="${borderStyle}">
      <div class="auction-header" style="margin-bottom:6px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">${regionBadge}${discoveredBadge}</div>
          <div class="auction-name">${e.name}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">${distBadge}</div>
      </div>
      ${addressHtml}
      ${phoneHtml}
      ${cropTags}
      ${basisBlock}
      ${noteHtml}
      ${discoveredNote}
      <div class="auction-links" style="margin-top:10px;">
        <button onclick="document.getElementById('elev-select').value='${key}';onElevChange();switchSubtab('grain');switchTab('grain','prices',document.querySelector('#sub-grain .tab'));" class="auction-link" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;color:var(--corn);padding:0;letter-spacing:1px;">Set as My Buyer ★</button>
        ${websiteLink}
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="auction-link">Directions ↗</a>
      </div>
    </div>`;
    if(idx < Math.ceil(sorted.length / 2)) col1.innerHTML += card;
    else col2.innerHTML += card;
  });
}

// ── OSM ELEVATOR DISCOVERY ───────────────────────────────────────────────────
const SEARCH_RADIUS_M=80000;
const OVERPASS_QUERY=(lat,lon)=>`[out:json][timeout:20];(node["man_made"="silo"](around:${SEARCH_RADIUS_M},${lat},${lon});node["name"~"elevator|grain|coop|co-op|chs|cenex|feed|ethanol|agri|landmark|heartland|adf|poet|farmer",i]["name"!~"^$"](around:${SEARCH_RADIUS_M},${lat},${lon});way["man_made"="silo"]["name"~".",i](around:${SEARCH_RADIUS_M},${lat},${lon}););out center tags;`;
function slugify(str){return str.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
function isTooClose(lat,lon){return Object.values(CURATED).some(c=>distMiles(lat,lon,c.lat,c.lon)<1.3);}
function estimateBasis(lat,lon,isCorn){const s=Math.abs(Math.sin(lat*1000+lon*997));const base=isCorn?-0.20:-0.27;return parseFloat((base+(s*0.10-0.05)).toFixed(2));}
async function discoverElevators(lat,lon){const statusEl=document.getElementById('discovery-status');if(statusEl)statusEl.textContent='Searching for nearby buyers…';try{const body='data='+encodeURIComponent(OVERPASS_QUERY(lat,lon));const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body});if(!r.ok)throw new Error('overpass '+r.status);const d=await r.json();let added=0;(d.elements||[]).forEach(el=>{const name=(el.tags&&(el.tags.name||el.tags['operator']||el.tags['brand']))||'';if(!name||name.length<3)return;const elat=el.lat||(el.center&&el.center.lat);const elon=el.lon||(el.center&&el.center.lon);if(!elat||!elon)return;if(isTooClose(elat,elon))return;const key='osm_'+slugify(name)+'_'+el.id;if(ELEVATORS[key])return;const n=name.toLowerCase();if(!n.includes('elevator')&&!n.includes('grain')&&!n.includes('coop')&&!n.includes('co-op')&&!n.includes('chs')&&!n.includes('cenex')&&!n.includes('feed')&&!n.includes('ethanol')&&!n.includes('agri')&&!n.includes('poet')&&!n.includes('farmer'))return;const city=(el.tags['addr:city']||el.tags['addr:town']||'');const state=(el.tags['addr:state']||'MN');const loc=city?(city+' '+state).trim():(state);ELEVATORS[key]={name,loc,lat:elat,lon:elon,cornBasis:estimateBasis(elat,elon,true),soyBasis:estimateBasis(elat,elon,false),curated:false,discovered:true};added++;});if(statusEl){statusEl.textContent=added>0?added+' additional buyer'+(added>1?'s':'')+' found nearby':'No additional buyers found in range';setTimeout(()=>{if(statusEl)statusEl.textContent='';},4000);}}catch(e){if(statusEl)statusEl.textContent='Buyer search unavailable';setTimeout(()=>{if(statusEl)statusEl.textContent='';},3000);}rebuildElevatorSelect();buildCashTable();rebuildElevatorDirectory();}

// ── CATTLE TYPE + AUCTION BARN PRICES ────────────────────────────────────────
// Cattle type dropdown — affects barn price display
// Discounts sourced from USDA AMS reports (2024-2026 averages):
//   Holstein steers: ~$30/cwt below beef steers
//   Beef×Dairy crossbreds: ~$9.50/cwt below beef steers
let cattleType = 'beef'; // 'beef' | 'holstein' | 'crossbred'

const CATTLE_TYPE_DISCOUNTS = {
  beef:      { label:'Beef Steer',         discountCwt: 0     },
  crossbred: { label:'Beef × Dairy Cross', discountCwt: 9.50  },
  holstein:  { label:'Holstein Steer',     discountCwt: 30.00 },
};

function setCattleType(type) {
  cattleType = type;
  const typeInfo = CATTLE_TYPE_DISCOUNTS[type];

  // Update cattle type toggle buttons only (scoped to #sub-cattle to avoid dairy grade buttons)
  document.querySelectorAll('#sub-cattle .cattle-type-btn').forEach(b => {
    const isActive = b.dataset.type === type;
    b.classList.toggle('active', isActive);
    b.style.background = isActive ? 'var(--cattle)' : 'transparent';
    b.style.color = isActive ? '#0f0f0f' : 'var(--txt3)';
    b.style.fontWeight = isActive ? '700' : '400';
  });

  // Update type badges on Charts and Margin tabs
  ['charts','margin'].forEach(tab => {
    const badge = document.getElementById('cattle-type-badge-'+tab);
    if(badge) badge.textContent = typeInfo.label;
  });

  // Update live cattle card name and price to reflect type
  const cardName = document.getElementById('lc-card-name');
  if(cardName) cardName.textContent = typeInfo.label;
  const fcCardName = document.getElementById('fc-card-name');
  if(fcCardName) fcCardName.textContent = typeInfo.label + ' Feeder';

  // Adjust live cattle card price by type discount
  if(CATTLE_DATA.lc) {
    const disc = typeInfo.discountCwt;
    const adjPrice = (CATTLE_DATA.lc.price - disc).toFixed(2);
    const lcEl = document.getElementById('p-lc');
    if(lcEl) {
      lcEl.textContent = adjPrice;
      lcEl.style.color = CATTLE_DATA.lc.change > 0.005 ? 'var(--up)'
                       : CATTLE_DATA.lc.change < -0.005 ? 'var(--down)'
                       : 'var(--corn)';
    }
    // Update HIGH/LOW/PREV with discount applied
    const h = document.getElementById('h-lc');
    const l = document.getElementById('l-lc');
    const v = document.getElementById('v-lc');
    if(h) h.textContent = (CATTLE_DATA.lc.high - disc).toFixed(2);
    if(l) l.textContent = (CATTLE_DATA.lc.low  - disc).toFixed(2);
    if(v) v.textContent = (CATTLE_DATA.lc.open - disc).toFixed(2);
    // Update badge to reflect adjusted change (change amount stays same, pct recalcs)
    const adjOpen = CATTLE_DATA.lc.open - disc;
    const adjChange = parseFloat(adjPrice) - adjOpen;
    const adjPct = (adjChange / adjOpen) * 100;
    setBadge('b-lc', adjChange, adjPct);
  }

  buildBarnTable();
  updateFeederCard();
  updateSlaughterWeightTable();

  // Adjust feeder cattle card price by type discount (40% of slaughter discount)
  if(CATTLE_DATA.fc) {
    const feederDisc = typeInfo.discountCwt * 0.4;
    const adjFcPrice = (CATTLE_DATA.fc.price - feederDisc).toFixed(2);
    const fcEl = document.getElementById('p-fc');
    if(fcEl) {
      fcEl.textContent = adjFcPrice;
      fcEl.style.color = CATTLE_DATA.fc.change > 0.005 ? 'var(--up)'
                       : CATTLE_DATA.fc.change < -0.005 ? 'var(--down)'
                       : 'var(--corn)';
    }
    const fh = document.getElementById('h-fc');
    const fl = document.getElementById('l-fc');
    const fv = document.getElementById('v-fc');
    if(fh) fh.textContent = (CATTLE_DATA.fc.high - feederDisc).toFixed(2);
    if(fl) fl.textContent = (CATTLE_DATA.fc.low  - feederDisc).toFixed(2);
    if(fv) fv.textContent = (CATTLE_DATA.fc.open - feederDisc).toFixed(2);
    const adjFcOpen   = CATTLE_DATA.fc.open - feederDisc;
    const adjFcChange = parseFloat(adjFcPrice) - adjFcOpen;
    setBadge('b-fc', adjFcChange, (adjFcChange / adjFcOpen) * 100);
  }

  // Sync margin calc sell price to adjusted live cattle price
  if(CATTLE_DATA.lc) {
    const disc = CATTLE_TYPE_DISCOUNTS[type].discountCwt;
    const adjPrice = Math.round(CATTLE_DATA.lc.price - disc);
    const spEl = document.getElementById('sp');
    const spVal = document.getElementById('sp-val');
    if(spEl){ spEl.value = adjPrice; const spNi2=document.getElementById('sp-n');if(spNi2)spNi2.value=adjPrice; }
    if(spVal){ setFieldVal('sp-val', adjPrice); }
    calc();
  }
  // Update insight strip with type context
  const typeLabel = CATTLE_TYPE_DISCOUNTS[type].label;
  const disc = CATTLE_TYPE_DISCOUNTS[type].discountCwt;
  const insightEl = document.getElementById('cattle-insight');
  if(insightEl && CATTLE_DATA.lc) {
    const adjPrice = (CATTLE_DATA.lc.price - disc).toFixed(2);
    if(disc > 0) {
      insightEl.innerHTML = '<strong>'+typeLabel+'</strong> selected — estimated market price <strong>'+adjPrice+'¢/lb</strong> (−'+disc.toFixed(2)+' discount vs beef steer baseline).';
    } else {
      insightEl.innerHTML = '<strong>'+typeLabel+'</strong> selected — baseline price <strong>'+adjPrice+'¢/lb</strong>.';
    }
  }
}

// Auction barn data — base prices per cwt (beef steer baseline)
// These are seeded with recent USDA IA-MN regional weighted averages
// and updated via loadBarnPrices() which fetches the USDA AMS IA-MN report
// dataSource: null | 'cme' | 'usda' | 'live'  (live = scraped from barn's own website)
const BARNS_DATA = {
  central:   { id:'central',   name:'Central Livestock',       loc:'Zumbrota MN',    lat:44.2933, lon:-92.6744, freq:'Mon·Tue·Wed', phone:'507-732-7305', url:'https://www.centrallivestock.com', basePrice:232.50, reportDate:'Mar 2026', dataSource:null, finishPrices:null, feederWeights:null, _scrapeError:null },
  lanesboro: { id:'lanesboro', name:'Lanesboro Sales',         loc:'Lanesboro MN',   lat:43.7180, lon:-91.9802, freq:'Wed & Fri',   phone:null,           url:'https://www.lanesborosalescommission.com', basePrice:231.00, reportDate:'Mar 2026', dataSource:null, finishPrices:null, feederWeights:null },
  rockcreek: { id:'rockcreek', name:'Rock Creek Livestock',    loc:'Pine City MN',   lat:45.9524, lon:-92.9577, freq:'Mon & Wed',   phone:null,           url:'https://rockcreeklivestockmarket.com', basePrice:230.50, reportDate:'Mar 2026', dataSource:null, finishPrices:null, feederWeights:null },
  sleepyeye: { id:'sleepyeye', name:'Sleepy Eye Auction',      loc:'Sleepy Eye MN',  lat:44.2972, lon:-94.7244, freq:'Every Wed',   phone:null,           url:'https://sleepyeyeauctionmarket.com', basePrice:231.50, reportDate:'Mar 2026', dataSource:null, finishPrices:null, feederWeights:null },
  pipestone:  { id:'pipestone', name:'Pipestone Livestock',    loc:'Pipestone MN',   lat:43.9939, lon:-96.3172, freq:'2nd & 4th Thu',phone:null,           url:'https://www.pipestonelivestock.com', basePrice:230.00, reportDate:'Mar 2026', dataSource:null, finishPrices:null, feederWeights:null },
};

let barnPriceDate = 'Recent values';

// Fetch USDA IA-MN weekly direct slaughter cattle report
// URL: https://www.ams.usda.gov/mnreports/lsdmwsls.pdf
// This is the IA-MN Weekly Wtd Avg Direct Slaughter Cattle report — covers our region
async function loadBarnPrices() {
  const statusEl = document.getElementById('barn-price-status');
  if(statusEl) statusEl.textContent = 'Fetching USDA IA-MN report...';
  try {
    // Try CORS proxy to fetch USDA PDF text
    const url = 'https://www.ams.usda.gov/mnreports/lsdmwsls.pdf';
    const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    const r = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
    if(!r.ok) throw new Error('fetch failed');
    const text = await r.text();
    // Parse weighted avg steer price from report text
    // Pattern: look for "Live Steer" or "5 Area" weighted avg price
    const matches = text.match(/Live\s+Steer[\s\S]{0,200}?(\d{3}\.\d{2})/i);
    if(matches && matches[1]) {
      const usda = parseFloat(matches[1]);
      if(usda > 180 && usda < 350) {
        // Apply regional adjustment — IA-MN typically runs slight premium to national
        Object.keys(BARNS_DATA).forEach(k => {
          BARNS_DATA[k].basePrice = usda;
          if(!BARNS_DATA[k].dataSource) BARNS_DATA[k].dataSource = 'usda';
        });
        const now = new Date();
        barnPriceDate = 'USDA IA-MN · ' + (now.getMonth()+1) + '/' + now.getDate() + '/' + now.getFullYear();
        if(statusEl) statusEl.textContent = '';
        buildBarnTable();
        return;
      }
    }
    throw new Error('parse failed');
  } catch(e) {
    // Fallback: use CME live cattle futures price as proxy if available
    if(CATTLE_DATA.lc && CATTLE_DATA.lc.price > 0) {
      const proxy = CATTLE_DATA.lc.price;
      Object.keys(BARNS_DATA).forEach((k,i) => {
        // Small barn-specific variance ±1.5¢
        const variance = [-0.5, -1.0, -1.5, -0.8, -1.2][i] || 0;
        BARNS_DATA[k].basePrice = parseFloat((proxy + variance).toFixed(2));
        if(!BARNS_DATA[k].dataSource) BARNS_DATA[k].dataSource = 'cme';
      });
      barnPriceDate = 'CME proxy · live cattle futures';
    }
    if(statusEl) statusEl.textContent = '';
    buildBarnTable();
  }
}

// ── LOAD PRE-SCRAPED BARN DATA (from GitHub Actions bot) ─────────────────────
// Fetches data/prices/index.json written by scripts/scrape-barns.js
// Populates BARNS_DATA with slaughter finishPrices for any barn with source='scraped'
async function loadScrapedBarnData() {
  try {
    const r = await fetch('data/prices/index.json');
    if (!r.ok) throw new Error('fetch ' + r.status);
    const index = await r.json();

    for (const entry of index) {
      const b = BARNS_DATA[entry.id];
      if (!b) continue;
      if (entry.source !== 'scraped') continue;

      // Slaughter → finishPrices
      if (entry.slaughter) {
        b.finishPrices = {
          beef:      entry.slaughter.beef,
          crossbred: entry.slaughter.crossbred,
          holstein:  entry.slaughter.holstein,
        };
        if (entry.slaughter.beef != null) b.basePrice = entry.slaughter.beef;
      }

      // Rep sales (weight-class averages, headcounts, bulls, cows)
      if (entry.repSales) b.repSales = entry.repSales;

      // Feeder weight ranges from summary table
      if (entry.feederWeights && entry.feederWeights.length) b.feederWeights = entry.feederWeights;

      // Sale day & lite test note
      if (entry.saleDay) b.saleDay = entry.saleDay;
      if (entry.liteTestNote) b.liteTestNote = entry.liteTestNote;

      // Per-category sale day and date
      if (entry.slaughterSaleDay) b.slaughterSaleDay = entry.slaughterSaleDay;
      if (entry.slaughterDate) b.slaughterDate = entry.slaughterDate;
      if (entry.feederSaleDay) b.feederSaleDay = entry.feederSaleDay;
      if (entry.feederDate) b.feederDate = entry.feederDate;

      b.dataSource = 'live';

      // Report date: prefer slaughter date, then feeder, then lastSuccess
      const dateStr = entry.slaughterDate || entry.feederDate || entry.lastSuccess;
      if (dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        b.reportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (entry.slaughterDate) {
        const d = new Date(entry.slaughterDate + 'T12:00:00');
        b.slaughterReportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      if (entry.feederDate) {
        const d = new Date(entry.feederDate + 'T12:00:00');
        b.feederReportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }

    buildBarnTable();
    console.log('[barn-data] loaded scraped prices from index.json');
  } catch (e) {
    console.warn('[barn-data] could not load index.json:', e.message, '— will fall back to CORS scraper');
  }
}

// ── CENTRAL LIVESTOCK SCRAPER (CORS fallback) ────────────────────────────────
// Falls back to scraping centrallivestock.com via CORS proxies if the
// pre-scraped data from index.json is missing or stale.
// Sets BARNS_DATA.central.dataSource = 'live' on success.
async function loadCentralLivestockData() {
  // Skip if pre-scraped data already loaded (from index.json via loadScrapedBarnData)
  if (BARNS_DATA.central.dataSource === 'live' || BARNS_DATA.central.repSales) {
    console.log('[central] skipping CORS scraper — pre-scraped data already loaded');
    return;
  }
  try {
    const url = 'https://www.centrallivestock.com/monday---cattle.html';
    // Try proxies in order — some block certain domains
    const proxies = [
      'https://corsproxy.io/?' + encodeURIComponent(url),
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
    ];
    let html = null;
    for(const proxyUrl of proxies) {
      try {
        const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        if(!r.ok) { console.warn('[central] proxy failed:', proxyUrl, r.status); continue; }
        const text = await r.text();
        if(text.length < 500) { console.warn('[central] proxy returned empty/short response:', proxyUrl); continue; }
        console.log('[central] proxy success:', proxyUrl, 'bytes:', text.length);
        html = text;
        break;
      } catch(pe) {
        console.warn('[central] proxy error:', proxyUrl, pe.message);
      }
    }
    if(!html) throw new Error('all proxies failed');

    // Parse via DOM
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cells = [...doc.querySelectorAll('td')];
    const getText = c => c.textContent.replace(/\s+/g,' ').trim();

    // Extract report date
    const dateCell = cells.find(c => /Market Report/i.test(getText(c)));
    const dateMatch = dateCell ? getText(dateCell).match(/(\d{1,2}\/\d{1,2}\/\d{4})/) : null;
    const reportDate = dateMatch ? dateMatch[1] : '';

    // Helper: given a cell index, scan forward for first price > threshold
    function nextPrice(fromIdx, minVal = 150, maxVal = 500) {
      for(let i = fromIdx + 1; i < Math.min(fromIdx + 10, cells.length); i++) {
        const v = parseFloat(getText(cells[i]));
        if(!isNaN(v) && v >= minVal && v <= maxVal) return v;
      }
      return null;
    }

    // Helper: find cell index matching text (partial, case-insensitive)
    function findIdx(text, afterIdx = 0) {
      for(let i = afterIdx; i < cells.length; i++) {
        if(getText(cells[i]).toLowerCase().includes(text.toLowerCase())) return i;
      }
      return -1;
    }

    // ── Finish prices by type ──
    const finishPrices = {};

    const beefIdx = findIdx('Finished Beef Steers');
    if(beefIdx > -1) {
      // Get the HIGHER of the two prices in the range
      const prices = [];
      for(let i = beefIdx + 1; i < Math.min(beefIdx + 10, cells.length); i++) {
        const v = parseFloat(getText(cells[i]));
        if(!isNaN(v) && v > 150 && v < 400) prices.push(v);
        if(prices.length >= 2) break;
      }
      if(prices.length) finishPrices.beef = Math.max(...prices);
    }

    const dairyXIdx = findIdx('Dairy-X') > -1 ? findIdx('Dairy-X') : findIdx('Dairy X');
    if(dairyXIdx > -1) {
      const prices = [];
      for(let i = dairyXIdx + 1; i < Math.min(dairyXIdx + 10, cells.length); i++) {
        const v = parseFloat(getText(cells[i]));
        if(!isNaN(v) && v > 150 && v < 400) prices.push(v);
        if(prices.length >= 2) break;
      }
      if(prices.length) finishPrices.crossbred = Math.max(...prices);
    }

    // Finished Dairy Steers — first price cell after "Finished Dairy Steers" label
    const dairyFinIdx = findIdx('Finished Dairy Steers');
    if(dairyFinIdx > -1) {
      const prices = [];
      for(let i = dairyFinIdx + 1; i < Math.min(dairyFinIdx + 10, cells.length); i++) {
        const v = parseFloat(getText(cells[i]));
        if(!isNaN(v) && v > 150 && v < 400) prices.push(v);
        if(prices.length >= 2) break;
      }
      if(prices.length) finishPrices.holstein = Math.max(...prices);
    }

    // ── Feeder weights ──
    const feederWeights = [];

    // Beef Steers & Bulls feeder section
    const bsIdx = findIdx('Beef Steers & Bulls');
    const bhIdx = findIdx('Beef Heifers', bsIdx > -1 ? bsIdx : 0);
    if(bsIdx > -1) {
      const sectionCells = cells.slice(bsIdx, bhIdx > bsIdx ? bhIdx : bsIdx + 25);
      sectionCells.forEach((cell, ci) => {
        const t = getText(cell);
        const wm = t.match(/^(\d{3})\s*[-–]\s*(\d{3,4})#?$/);
        if(wm) {
          const range = wm[1] + '–' + wm[2] + '#';
          const absIdx = cells.indexOf(cell);
          const price = nextPrice(absIdx, 100, 600);
          if(price) feederWeights.push({ range, price, types: ['beef','crossbred'] });
        }
      });
    }

    // Dairy Steers feeder section
    const dsFeederIdx = findIdx('Dairy Steers') > -1
      ? findIdx('Dairy Steers', findIdx('Feeder Cattle') > -1 ? findIdx('Feeder Cattle') : 0)
      : -1;
    if(dsFeederIdx > -1) {
      const sectionCells = cells.slice(dsFeederIdx, dsFeederIdx + 25);
      sectionCells.forEach(cell => {
        const t = getText(cell);
        const wm = t.match(/^(\d{3})\s*[-–]\s*(\d{3,4})#?$/);
        if(wm) {
          const range = wm[1] + '–' + wm[2] + '#';
          const absIdx = cells.indexOf(cell);
          const price = nextPrice(absIdx, 100, 600);
          if(price) feederWeights.push({ range, price, types: ['holstein'] });
        }
      });
    }

    if(!Object.keys(finishPrices).length && !feederWeights.length) throw new Error('no data parsed');

    // Store scraped data on the barn
    const b = BARNS_DATA.central;
    if(finishPrices.beef)      b.basePrice = finishPrices.beef; // update baseline
    b.finishPrices  = finishPrices;
    b.feederWeights = feederWeights.length ? feederWeights : null;
    b.dataSource    = 'live';
    if(reportDate)  b.reportDate = reportDate;

    buildBarnTable();

  } catch(e) {
    console.warn('[central] loadCentralLivestockData failed:', e.message);
    BARNS_DATA.central._scrapeError = e.message;
    buildBarnTable(); // re-render so error state shows in UI
  }
}

let selectedBarnKey = null;
let expandedBarnKey = null;

function rebuildBarnSelect() {
  const sel = document.getElementById('cattle-barn-select'); if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select auction barn…</option>';
  const keys = Object.keys(BARNS_DATA);
  const sorted = userLat
    ? keys.slice().sort((a,b) => distMiles(userLat,userLon,BARNS_DATA[a].lat,BARNS_DATA[a].lon) - distMiles(userLat,userLon,BARNS_DATA[b].lat,BARNS_DATA[b].lon))
    : keys;
  sorted.forEach(k => {
    const b = BARNS_DATA[k];
    const dist = userLat ? Math.round(distMiles(userLat,userLon,b.lat,b.lon)) : null;
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = b.name + ' — ' + b.loc + (dist!==null?' (~'+dist+' mi)':'');
    sel.appendChild(opt);
  });
  if(cur && BARNS_DATA[cur]) { sel.value = cur; }
  else if(userLat && sorted.length) {
    sel.value = sorted[0];
    onCattleBarnChange();
  }
}

function onCattleBarnChange() {
  const sel = document.getElementById('cattle-barn-select');
  const key = sel?.value || null;
  const distEl = document.getElementById('cattle-barn-dist');
  selectedBarnKey = key;
  if(key && userLat) {
    const b = BARNS_DATA[key];
    const dist = Math.round(distMiles(userLat,userLon,b.lat,b.lon));
    if(distEl) distEl.textContent = '~'+dist+' mi away';
  } else {
    if(distEl) distEl.textContent = '';
  }
  if(key) {
    highlightBarnRow(key);
    // Open this barn's drawer if not already open
    if(expandedBarnKey !== key) {
      if(expandedBarnKey) {
        const prev = document.getElementById('drawer-' + expandedBarnKey);
        const prevChev = document.getElementById('chevron-' + expandedBarnKey);
        if(prev) prev.classList.remove('barn-drawer--open');
        if(prevChev) prevChev.classList.remove('barn-chevron--open');
      }
      const drawer = document.getElementById('drawer-' + key);
      const chev   = document.getElementById('chevron-' + key);
      if(drawer) drawer.classList.add('barn-drawer--open');
      if(chev)   chev.classList.add('barn-chevron--open');
      expandedBarnKey = key;
    }
  }
}

function selectBarn(key) {
  selectedBarnKey = key;
  // Sync the Prices bar select dropdown
  const sel = document.getElementById('cattle-barn-select');
  if(sel) { sel.value = key; onCattleBarnChange(); }
  highlightBarnRow(key);
  switchSubtab('cattle');
  switchTab('cattle','prices', document.querySelector('#sub-cattle .tab'));
}
function highlightBarnRow(key) {
  document.querySelectorAll('#barn-table-body tr.barn-row').forEach(tr => tr.classList.toggle('selected', tr.dataset.key===key));
}

function toggleBarnRow(key) {
  selectedBarnKey = key;
  highlightBarnRow(key);
  // Sync dropdown
  const sel = document.getElementById('cattle-barn-select');
  if(sel) sel.value = key;

  // Close any previously open drawer
  if(expandedBarnKey && expandedBarnKey !== key) {
    const prev = document.getElementById('drawer-' + expandedBarnKey);
    const prevChev = document.getElementById('chevron-' + expandedBarnKey);
    if(prev) prev.classList.remove('barn-drawer--open');
    if(prevChev) prevChev.classList.remove('barn-chevron--open');
  }

  const drawer = document.getElementById('drawer-' + key);
  const chev   = document.getElementById('chevron-' + key);
  if(expandedBarnKey === key) {
    // Collapse
    if(drawer) drawer.classList.remove('barn-drawer--open');
    if(chev)   chev.classList.remove('barn-chevron--open');
    expandedBarnKey = null;
  } else {
    // Expand
    if(drawer) drawer.classList.add('barn-drawer--open');
    if(chev)   chev.classList.add('barn-chevron--open');
    expandedBarnKey = key;
  }
}

function barnAdjustedPrice(basePrice) {
  const disc = CATTLE_TYPE_DISCOUNTS[cattleType].discountCwt;
  return (basePrice - disc).toFixed(2);
}

function buildBarnTable() {
  const tbody = document.getElementById('barn-table-body');
  if(!tbody) return;
  const typeInfo = CATTLE_TYPE_DISCOUNTS[cattleType];
  const disc = typeInfo.discountCwt;
  const typeLabel = typeInfo.label;
  const keys = Object.keys(BARNS_DATA);
  const sorted = userLat
    ? keys.slice().sort((a,b) => distMiles(userLat,userLon,BARNS_DATA[a].lat,BARNS_DATA[a].lon) - distMiles(userLat,userLon,BARNS_DATA[b].lat,BARNS_DATA[b].lon))
    : keys;

  const fcPrice = CATTLE_DATA.fc?.price;
  const feederDisc = disc * 0.4;
  const feederAvg = fcPrice ? (fcPrice - feederDisc).toFixed(2) + '¢' : '—';

  // Feeder data source — shared across all barn rows (USDA or CME fallback)
  const feederDataSource = FEEDER_WEIGHT_DATA
    ? (FEEDER_WEIGHT_DATA.region === 'CME Index proxy' ? 'cme' : 'usda')
    : null;

  // Badge helper
  function makeBadge(src) {
    if(!src) return '';
    const cls = (src === 'live' || src === 'actual') ? 'barn-src-live' : src === 'barn' ? 'barn-src-barn' : src === 'usda' ? 'barn-src-usda' : 'barn-src-cme';
    const lbl = (src === 'live') ? 'ACTUAL' : src.toUpperCase();
    return `<span class="barn-src-badge ${cls}">${lbl}</span>`;
  }

  // Finish weight classes — grade schedule adjustments off each barn's own reported price
  const weightClasses = [
    { range: '1000–1099 lbs', adj: +2.50 },
    { range: '1100–1199 lbs', adj: +1.00 },
    { range: '1200–1299 lbs', adj:  0    },
    { range: '1300–1399 lbs', adj: -1.50 },
    { range: '1400–1499 lbs', adj: -3.50 },
  ];

  // Feeder weight buckets — real USDA data only, blank if interpolated
  const buckets = ['400-499','500-599','600-699','700-799','800-899','900-999'];
  const parsedKeys = FEEDER_WEIGHT_DATA?._parsedKeys || [];
  const feederSource = FEEDER_WEIGHT_DATA
    ? `USDA sj_ls850.txt · ${FEEDER_WEIGHT_DATA.region} · actual data only`
    : 'USDA sj_ls850.txt · loading…';

  const rows = sorted.map((key) => {
    const b = BARNS_DATA[key];

    // ── Slaughter avg: weighted average from rep sales if available ──
    const scraped = b.finishPrices && b.finishPrices[cattleType] != null;
    const repFinishAll = b.repSales && b.repSales.finishWeightAvgs;
    let adjPrice;
    if (repFinishAll && repFinishAll.length) {
      // Compute true head-weighted average from rep sales for this cattle type
      const typeRows = repFinishAll.filter(r => r.type === cattleType);
      const totalHead = typeRows.reduce((s, r) => s + r.head, 0);
      const weightedSum = typeRows.reduce((s, r) => s + r.avgPrice * r.head, 0);
      adjPrice = totalHead > 0 ? (weightedSum / totalHead).toFixed(2) : (scraped ? b.finishPrices[cattleType].toFixed(2) : barnAdjustedPrice(b.basePrice));
    } else {
      adjPrice = scraped ? b.finishPrices[cattleType].toFixed(2) : barnAdjustedPrice(b.basePrice);
    }

    const discStr = scraped
      ? '<span style="color:var(--up);font-size:11px;">actual</span>'
      : disc > 0
        ? `<span style="color:var(--down);font-size:11px;">−${disc.toFixed(2)}</span>`
        : '<span style="color:var(--up);font-size:11px;">baseline</span>';

    // ── Feeder avg: weighted average from rep sales if available ──
    const repFeederAll = b.repSales && b.repSales.feederWeightAvgs;
    let barnFeederAvg;
    let barnFeederSrc;
    if (repFeederAll && repFeederAll.length) {
      const typeRows = repFeederAll.filter(r => r.type === cattleType);
      const totalHead = typeRows.reduce((s, r) => s + r.head, 0);
      const weightedSum = typeRows.reduce((s, r) => s + r.avgPrice * r.head, 0);
      if (totalHead > 0) {
        barnFeederAvg = (weightedSum / totalHead).toFixed(2) + '¢';
        barnFeederSrc = 'live';
      } else {
        barnFeederAvg = feederAvg;
        barnFeederSrc = (b.feederWeights && b.feederWeights.length) ? 'barn' : feederDataSource;
      }
    } else if (b.feederWeights && b.feederWeights.length) {
      barnFeederAvg = feederAvg;
      barnFeederSrc = 'barn';
    } else {
      barnFeederAvg = feederAvg;
      barnFeederSrc = feederDataSource;
    }

    // ── Per-column source badges ──
    // Slaughter: LIVE if barn has scraped finishPrices, else barn's dataSource (usda/cme)
    const slaughterSrc = b.finishPrices ? 'live' : b.dataSource;
    const slaughterBadge = makeBadge(slaughterSrc);
    const feederBadge = makeBadge(barnFeederSrc);

    // ── Finish weight rows ──
    let finishRows, finishFoot;
    const repFinish = b.repSales && b.repSales.finishWeightAvgs;
    if (repFinish && repFinish.length) {
      // Use real representative sales data — actual averages by weight class
      const typeRows = repFinish.filter(r => r.type === cattleType);
      if (typeRows.length) {
        finishRows = typeRows.map(r => {
          return `<tr>
            <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${r.range} <span style="font-size:9px;opacity:.6;">${r.head} hd</span></td>
            <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${r.avgPrice.toFixed(2)}¢</td>
          </tr>`;
        }).join('');
      } else {
        finishRows = `<tr><td colspan="2" style="font-size:11px;color:var(--txt3);padding:8px;text-align:center;">No ${typeLabel} finish sales reported</td></tr>`;
      }
      finishFoot = `${b.name} · rep. sales sample avg`;
    } else {
      // Fallback: estimated weight offsets from baseline
      finishRows = weightClasses.map(w => {
        let price;
        if(scraped && b.finishPrices[cattleType] != null) {
          price = (b.finishPrices[cattleType] + w.adj).toFixed(2);
        } else if(scraped && b.finishPrices.beef != null) {
          price = (b.finishPrices.beef + w.adj - disc).toFixed(2);
        } else {
          price = (b.basePrice + w.adj - disc).toFixed(2);
        }
        const isBase = w.adj === 0;
        const srcNote = scraped && isBase ? ' <span style="font-size:9px;color:var(--up);opacity:.8;">barn reported</span>' : isBase ? ' <span style="font-size:9px;opacity:.6;">baseline</span>' : '';
        return `<tr${isBase ? ' style="background:var(--bg3);"' : ''}>
          <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${w.range}${srcNote}</td>
          <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${price}¢</td>
        </tr>`;
      }).join('');
      finishFoot = scraped
        ? `${b.name} sale report · weight estimates`
        : `${b.name} reported price · weight estimates`;
    }

    // ── Feeder weight rows ──
    // Priority: rep sales → OCR feeder weights → USDA sj_ls850.txt → blank
    let feederRows = '';
    let feederFoot = '';
    const repFeeder = b.repSales && b.repSales.feederWeightAvgs;
    if (repFeeder && repFeeder.length) {
      // Use real representative sales data
      const typeRows = repFeeder.filter(r => r.type === cattleType);
      if (typeRows.length) {
        feederRows = typeRows.map(r => {
          return `<tr>
            <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${r.range} <span style="font-size:9px;opacity:.6;">${r.head} hd</span></td>
            <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${r.avgPrice.toFixed(2)}¢</td>
          </tr>`;
        }).join('');
      } else {
        feederRows = `<tr><td colspan="2" style="font-size:11px;color:var(--txt3);padding:8px;text-align:center;">No ${typeLabel} feeder sales reported</td></tr>`;
      }
      feederFoot = `${b.name} · rep. sales sample avg`;
    } else if(b.feederWeights && b.feederWeights.length) {
      // Fallback: OCR feeder weights from summary table
      const relevantWeights = b.feederWeights.filter(w => w.types.includes(cattleType));
      if(relevantWeights.length) {
        feederRows = relevantWeights.map(w => {
          const adjP = w.price.toFixed(2);
          return `<tr>
            <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${w.range}</td>
            <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${adjP}¢</td>
          </tr>`;
        }).join('');
        feederFoot = `${b.name} sale report · price ceiling`;
      } else {
        feederRows = `<tr><td colspan="2" style="font-size:11px;color:var(--txt3);padding:8px;text-align:center;">No ${typeLabel} feeder data reported</td></tr>`;
        feederFoot = `${b.name} sale report`;
      }
    } else if(FEEDER_WEIGHT_DATA) {
      feederRows = buckets.map(bucket => {
        const rawPrice = FEEDER_WEIGHT_DATA.prices[bucket];
        const isReal = parsedKeys.includes(bucket);
        const isTarget = bucket === '700-799' || bucket === '800-899';
        const displayPrice = (rawPrice && isReal) ? (parseFloat(rawPrice) - feederDisc).toFixed(2) + '¢' : '—';
        const priceColor = (rawPrice && isReal) ? 'var(--txt1)' : 'var(--txt3)';
        const priceFw   = (rawPrice && isReal) ? '700' : '400';
        return `<tr${isTarget ? ' style="background:var(--bg3);"' : ''}>
          <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${bucket} lbs</td>
          <td style="font-size:12px;color:${priceColor};font-weight:${priceFw};padding:5px 8px;text-align:right;">${displayPrice}</td>
        </tr>`;
      }).join('');
      feederFoot = feederSource;
    } else {
      feederRows = buckets.map(bucket => `<tr>
        <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${bucket} lbs</td>
        <td style="font-size:12px;color:var(--txt3);padding:5px 8px;text-align:right;">—</td>
      </tr>`).join('');
      feederFoot = 'USDA sj_ls850.txt · loading…';
    }

    const discNote = scraped
      ? (cattleType !== 'beef' ? `<div style="font-size:10px;color:var(--txt3);padding:3px 8px 5px;border-top:1px solid var(--border);font-style:italic;">${typeLabel} · actual barn-reported price</div>` : '')
      : disc > 0
        ? `<div style="font-size:10px;color:var(--txt3);padding:3px 8px 5px;border-top:1px solid var(--border);font-style:italic;">${typeLabel} · −${disc.toFixed(2)}¢/cwt applied</div>`
        : '';

    // ── Bulls & Cows rows ──
    let bullsCowsRows = '';
    let bullsCowsFoot = '';
    const repBulls = b.repSales && b.repSales.bullsWeightAvgs;
    const repCows = b.repSales && b.repSales.cowsWeightAvgs;
    if ((repBulls && repBulls.length) || (repCows && repCows.length)) {
      if (repBulls && repBulls.length) {
        bullsCowsRows += `<tr><td colspan="2" style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--txt2);padding:5px 8px 2px;text-transform:uppercase;">Bulls</td></tr>`;
        bullsCowsRows += repBulls.map(r => `<tr>
          <td style="font-size:11px;color:var(--txt3);padding:3px 8px;">${r.range} <span style="font-size:9px;opacity:.6;">${r.head} hd</span></td>
          <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:3px 8px;text-align:right;">${r.avgPrice.toFixed(2)}¢</td>
        </tr>`).join('');
      }
      if (repCows && repCows.length) {
        bullsCowsRows += `<tr><td colspan="2" style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--txt2);padding:5px 8px 2px;text-transform:uppercase;">Cows</td></tr>`;
        bullsCowsRows += repCows.map(r => `<tr>
          <td style="font-size:11px;color:var(--txt3);padding:3px 8px;">${r.range} <span style="font-size:9px;opacity:.6;">${r.head} hd</span></td>
          <td style="font-size:12px;color:var(--txt1);font-weight:700;padding:3px 8px;text-align:right;">${r.avgPrice.toFixed(2)}¢</td>
        </tr>`).join('');
      }
      bullsCowsFoot = `${b.name} · rep. sales sample avg`;
    } else {
      bullsCowsRows = `<tr><td colspan="2" style="font-size:11px;color:var(--txt3);padding:8px;text-align:center;">No bull/cow data</td></tr>`;
      bullsCowsFoot = '';
    }

    const drawerHtml = `<tr class="barn-drawer" id="drawer-${key}">
      <td colspan="4">
        <div class="barn-detail-inner">
          <div class="barn-drawer-mini">
            <div class="barn-drawer-mini-header">Market Summary</div>
            <div style="padding:6px 8px;font-size:11px;color:var(--txt2);line-height:1.6;">
              ${(b.slaughterSaleDay && b.feederSaleDay && b.slaughterSaleDay !== b.feederSaleDay)
                ? `<div><span style="color:var(--txt3);">Slaughter:</span> ${b.slaughterSaleDay} ${b.slaughterReportDate || ''}</div><div><span style="color:var(--txt3);">Feeder:</span> ${b.feederSaleDay} ${b.feederReportDate || ''}</div>`
                : `${b.saleDay ? `<div><span style="color:var(--txt3);">Sale Day:</span> ${b.saleDay}</div>` : ''}${b.reportDate ? `<div><span style="color:var(--txt3);">Report Date:</span> ${b.reportDate}</div>` : ''}`
              }
              ${b.repSales && b.repSales.headCount ? `<div style="margin-top:4px;"><span style="color:var(--txt3);">Rep. Sales:</span> ${b.repSales.headCount.finished + b.repSales.headCount.feeder + b.repSales.headCount.bulls + (b.repSales.headCount.cows || 0)} hd reported</div><div style="padding-left:8px;font-size:10px;color:var(--txt3);">${b.repSales.headCount.finished} finished · ${b.repSales.headCount.feeder} feeder · ${b.repSales.headCount.bulls} bulls · ${b.repSales.headCount.cows || 0} cows</div>` : ''}
              ${scraped ? `<div style="margin-top:4px;"><span style="color:var(--txt3);">Slaughter:</span> ${b.finishPrices.beef != null ? b.finishPrices.beef.toFixed(2) + '¢ beef' : '—'}${b.finishPrices.crossbred != null ? ' · ' + b.finishPrices.crossbred.toFixed(2) + '¢ cross' : ''}${b.finishPrices.holstein != null ? ' · ' + b.finishPrices.holstein.toFixed(2) + '¢ holstein' : ''}</div>` : ''}
              ${b.liteTestNote ? `<div style="margin-top:4px;color:var(--corn);font-style:italic;">${b.liteTestNote}</div>` : ''}
            </div>
            <div class="barn-drawer-mini-foot">${scraped ? b.name + ' · rep. sales sample, not all transactions' : b.name + ' · estimated'}</div>
          </div>
          <div class="barn-drawer-mini">
            <div class="barn-drawer-mini-header">Finish Weights <span style="font-weight:400;color:var(--txt3);">slaughter ¢/lb</span></div>
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:left;padding:3px 8px;border-bottom:1px solid var(--border);">LBS</th>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:right;padding:3px 8px;border-bottom:1px solid var(--border);">¢/LB</th>
              </tr></thead>
              <tbody>${finishRows}</tbody>
            </table>
            ${discNote}
            <div class="barn-drawer-mini-foot">${finishFoot}</div>
          </div>
          <div class="barn-drawer-mini">
            <div class="barn-drawer-mini-header">Feeder Weights <span style="font-weight:400;color:var(--txt3);">buy price ¢/lb</span></div>
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:left;padding:3px 8px;border-bottom:1px solid var(--border);">LBS</th>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:right;padding:3px 8px;border-bottom:1px solid var(--border);">¢/LB</th>
              </tr></thead>
              <tbody>${feederRows}</tbody>
            </table>
            <div class="barn-drawer-mini-foot">${feederFoot}</div>
          </div>
          <div class="barn-drawer-mini">
            <div class="barn-drawer-mini-header">Market Bulls & Cows <span style="font-weight:400;color:var(--txt3);">¢/lb</span></div>
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:left;padding:3px 8px;border-bottom:1px solid var(--border);">LBS</th>
                <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:right;padding:3px 8px;border-bottom:1px solid var(--border);">¢/LB</th>
              </tr></thead>
              <tbody>${bullsCowsRows}</tbody>
            </table>
            ${bullsCowsFoot ? `<div class="barn-drawer-mini-foot">${bullsCowsFoot}</div>` : ''}
          </div>
        </div>
      </td>
    </tr>`;

    return `<tr class="barn-row" data-key="${key}" onclick="toggleBarnRow('${key}')">
      <td>
        <div class="elev-name-cell">${b.name} <span class="barn-chevron" id="chevron-${key}">›</span></div>
        <div class="elev-loc-cell">${b.loc} · ${b.freq}</div>
      </td>
      <td class="cash-price-cell">${adjPrice}¢ ${slaughterBadge} <span style="font-size:10px;color:var(--txt3);white-space:nowrap;">${b.slaughterReportDate ? b.slaughterReportDate + (b.slaughterSaleDay ? ' ' + b.slaughterSaleDay.slice(0,3) : '') : (b.reportDate || '')}</span>${b._scrapeError ? ` <span title="${b._scrapeError}" style="font-size:9px;color:var(--down);border:1px solid var(--down);border-radius:2px;padding:1px 4px;cursor:help;">ERR</span>` : ''}</td>
      <td class="cash-price-cell">${barnFeederAvg} ${feederBadge} <span style="font-size:10px;color:var(--txt3);white-space:nowrap;">${b.feederReportDate ? b.feederReportDate + (b.feederSaleDay ? ' ' + b.feederSaleDay.slice(0,3) : '') : (b.reportDate || '')}</span></td>
      <td>${discStr}</td>
    </tr>${drawerHtml}`;
  });

  tbody.innerHTML = rows.join('');
  if(selectedBarnKey) highlightBarnRow(selectedBarnKey);

  // Restore open drawer if one was expanded before a table rebuild
  if(expandedBarnKey) {
    const drawer = document.getElementById('drawer-' + expandedBarnKey);
    const chev   = document.getElementById('chevron-' + expandedBarnKey);
    if(drawer) drawer.classList.add('barn-drawer--open');
    if(chev)   chev.classList.add('barn-chevron--open');
  }

  const srcEl = document.getElementById('barn-price-source');
  if(srcEl) srcEl.textContent = 'Source: ' + barnPriceDate + ' · ' + typeInfo.label;
}

// ── FEED INPUT CARD PRICES ────────────────────────────────────────────────────
// Soybean meal: Stooq SM.F (CBOT futures $/ton)
// DDG & Alfalfa: USDA AMS IA/MN weekly hay/feed report PDF fallback to reasonable defaults
async function loadFeedInputPrices() {
  // Soybean meal futures via Stooq — ticker zm.f (CBOT ZM contract)
  try {
    const stooqUrl = 'https://stooq.com/q/l/?s=zmw00.f&f=sd2t2ohlcv&h&e=csv';
    const proxies = [
      'https://corsproxy.io/?' + encodeURIComponent(stooqUrl),
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(stooqUrl),
    ];
    let r;
    for (const p of proxies) {
      try { r = await fetch(p, { signal: AbortSignal.timeout(8000) }); if (r.ok) break; } catch(_) {}
    }
    if (!r || !r.ok) throw new Error('all proxies failed');
    const t = await r.text();
    const cols = t.trim().split('\n')[1]?.split(',');
    if(cols) {
      const price = parseFloat(cols[6]);
      if(!isNaN(price) && price > 50) {
        const open  = parseFloat(cols[3]);
        const change = price - open;
        const pct   = (change / open) * 100;
        const el = document.getElementById('p-sbm');
        if(el) el.textContent = '$' + price.toFixed(2);
        setBadge('b-sbm', change, pct);
        // Also sync margin calc sbm price slider
        const sbmpEl = document.getElementById('sbmp');
        const sbmpN  = document.getElementById('sbmp-n');
        if(sbmpEl) sbmpEl.value = price.toFixed(0);
        if(sbmpN)  sbmpN.value  = price.toFixed(0);
        setFieldVal('sbmp-val', '$' + price.toFixed(0));
      }
    }
  } catch(e) {
    // Fallback: show recent avg
    const el = document.getElementById('p-sbm');
    const badge = document.getElementById('b-sbm');
    if(el) el.textContent = '$302';
    if(badge) { badge.className = 'badge flat'; badge.textContent = 'Recent avg'; }
  }

  // DDG — USDA AMS publishes weekly IA/MN Livestock Feed report (no reliable JSON)
  // Use reasonable MN market defaults until a live source is confirmed
  // Typical MN DDG range: $150-220/ton depending on ethanol margins
  const ddgDefault = 175;
  const hayDefault = 210;
  const ddgEl  = document.getElementById('p-ddg');
  const hayEl  = document.getElementById('p-hay');
  const srcDdg = document.getElementById('src-ddg');
  const srcHay = document.getElementById('src-hay');
  if(ddgEl)  ddgEl.textContent  = '$' + ddgDefault;
  if(hayEl)  hayEl.textContent  = '$' + hayDefault;
  if(srcDdg) srcDdg.textContent = 'Recent avg';
  if(srcHay) srcHay.textContent = 'Recent avg';

  // Sync defaults to margin calc sliders if not already set by user
  ['ddgp','hayp'].forEach((id, i) => {
    const val = [ddgDefault, hayDefault][i];
    const slEl = document.getElementById(id);
    const nEl  = document.getElementById(id + '-n');
    if(slEl && parseFloat(slEl.value) === [180,200][i]) {
      if(slEl) slEl.value = val;
      if(nEl)  nEl.value  = val;
      setFieldVal(id + '-val', '$' + val);
    }
  });
}


// ── AUCTION BARN DATA ─────────────────────────────────────────────────────────
const BARN_DATA = [
  {
    id: 'central',
    name: 'Central Livestock Association',
    address: '44326 County 6 Blvd, Zumbrota, MN 55992',
    lat: 44.2933, lon: -92.6744,
    phone: '(507) 732-7305',
    freq: 'Mon · Tue · Wed',
    desc: 'Multiple sales weekly — feeder cattle, bred cow/heifer specials, market cows & bulls. Mon/Tue 8am, Wed 2pm.',
    links: [
      { label: 'Website ↗', url: 'https://www.centrallivestock.com' },
      { label: 'DVAuction ↗', url: 'https://www.dvauction.com' },
    ]
  },
  {
    id: 'lanesboro',
    name: 'Lanesboro Sales Commission',
    address: '402 Coffee St E, Lanesboro, MN 55949',
    lat: 43.7180, lon: -91.9802,
    phone: '(507) 467-2192',
    freq: 'Wed & Fri',
    desc: 'Wednesday 8:30am — market cows & bulls, finished cattle. Friday 9am — baby calves, feeder cattle. Online via CattleUSA.',
    links: [
      { label: 'Website ↗', url: 'https://www.lanesborosalescommission.com' },
    ]
  },
  {
    id: 'rockcreek',
    name: 'Rock Creek Livestock Market',
    address: '8175 MN-361, Pine City, MN 55063',
    lat: 45.9524, lon: -92.9577,
    phone: '(320) 629-6819',
    freq: 'Mon & Wed',
    desc: 'Cattle, hogs, sheep & goats — 8am. Feeder sales every other Tuesday. Same day payment.',
    links: [
      { label: 'Website ↗', url: 'https://rockcreeklivestockmarket.com' },
    ]
  },
  {
    id: 'sleepyeye',
    name: 'Sleepy Eye Auction Market',
    address: '411 3rd Ave NW, Sleepy Eye, MN 56085',
    lat: 44.2972, lon: -94.7244,
    phone: '(507) 794-5540',
    freq: 'Every Wednesday',
    desc: 'Family owned 75+ years. Sale 9am — feeder, finished, slaughter cattle.',
    links: [
      { label: 'Website ↗', url: 'https://sleepyeyeauctionmarket.com' },
    ]
  },
  {
    id: 'pipestone',
    name: 'Pipestone Livestock Auction',
    address: '1401 7th Ave SW, Pipestone, MN 56164',
    lat: 43.9939, lon: -96.3172,
    phone: '(507) 825-4411',
    freq: '2nd & 4th Thu',
    desc: 'Feeder cattle 11am, beef cattle noon. Online bidding via LMA Auctions.',
    links: [
      { label: 'Website ↗', url: 'https://www.pipestonelivestock.com' },
      { label: 'Bid Online ↗', url: 'https://lmaauctions.com' },
    ]
  },
];

function buildBarnDirectory() {
  const col1 = document.getElementById('barn-col-1');
  const col2 = document.getElementById('barn-col-2');
  if(!col1 || !col2) return;

  const sorted = userLat
    ? BARN_DATA.slice().sort((a,b) => distMiles(userLat,userLon,a.lat,a.lon) - distMiles(userLat,userLon,b.lat,b.lon))
    : BARN_DATA;

  col1.innerHTML = '';
  col2.innerHTML = '';

  sorted.forEach((b, idx) => {
    const dist = userLat ? Math.round(distMiles(userLat,userLon,b.lat,b.lon)) : null;
    const isNearest = idx === 0 && dist !== null;
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address)}`;

    const distBadge = dist !== null
      ? `<span style="font-size:11px;color:var(--corn);background:var(--corn-dim);padding:3px 9px;border-radius:3px;white-space:nowrap;">${dist} mi${isNearest ? ' ★' : ''}</span>`
      : '';

    const extraLinks = b.links.map(l =>
      `<a href="${l.url}" target="_blank" rel="noopener" class="auction-link">${l.label}</a>`
    ).join('');

    const borderStyle = isNearest ? 'border-color:rgba(60,185,106,.25);' : '';

    const card = `<div class="panel" style="${borderStyle}">
      <div class="auction-header" style="margin-bottom:6px;">
        <div>
          <div class="auction-name">${b.name}</div>
          <div style="font-size:11px;color:var(--cattle);margin-top:2px;font-weight:600;">${b.freq}</div>
        </div>
        <div style="flex-shrink:0;">${distBadge}</div>
      </div>
      <div class="auction-detail">📍 ${b.address}</div>
      <div class="auction-detail">📞 ${b.phone}</div>
      <div class="auction-detail" style="margin-top:6px;">${b.desc}</div>
      <div class="auction-links" style="margin-top:8px;">
        <button onclick="selectBarn('${b.id}')" class="auction-link" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;color:var(--cattle);padding:0;letter-spacing:1px;">Set as My Barn ★</button>
        ${extraLinks}
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="auction-link">Directions ↗</a>
      </div>
    </div>`;

    // Alternate between columns
    if(idx < Math.ceil(sorted.length / 2)) col1.innerHTML += card;
    else col2.innerHTML += card;
  });
}


// ── MEAT LOCKERS ─────────────────────────────────────────────────────────────
const LOCKER_DATA = [
  { id:'herdas',   name:"Herda's Meat Processing",  loc:'Faribault MN',        lat:44.2955, lon:-93.2688, phone:'507-334-5555', usda:true,  url:null,                                       note:'Custom slaughter & processing — full cutting, grinding, vacuum packing. USDA-inspected.',       hours:null },
  { id:'kreniks',  name:"Krenik's Meat Processing", loc:'Montgomery MN',        lat:44.3900, lon:-93.5600, phone:null,           usda:false, url:'https://www.kreniks.com',                   note:'Family owned since 1960. Custom beef & pork — no comingling. Retail counter, specialty smoked.', hours:null },
  { id:'lonsdale', name:'Lonsdale Country Market',  loc:'Lonsdale MN',          lat:44.4791, lon:-93.4158, phone:null,           usda:false, url:'https://www.lonsdalecountrymarket.com',     note:'Custom butchering — beef, pork, lamb, deer & wild game. Mon–Fri 10am–6pm, Sat 8:30am–3pm.',    hours:'Mon–Fri 10am–6pm · Sat 8:30am–3pm' },
  { id:'dennison', name:'Dennison Meat Locker',     loc:'Dennison MN',          lat:44.4063, lon:-92.9855, phone:null,           usda:false, url:'https://dennisonmeatlocker.com',            note:'Full custom beef processing — pricing online, smoked sausages, retail counter. Mon–Fri 8am–5pm.', hours:'Mon–Fri 8am–5pm',
    links:[{label:'Beef Pricing ↗', url:'https://dennisonmeatlocker.com/custom-prices/beef-prices/'}] },
  { id:'okeefes',  name:"O'Keefe's Meat Market",   loc:'Le Center MN',         lat:44.3922, lon:-93.7302, phone:null,           usda:false, url:'https://okeefesmeats.com',                  note:'Full-service custom slaughter & processing — retail counter, homemade sausage. Call to schedule.', hours:null },
];

function buildLockerDirectory() {
  const container = document.getElementById('locker-directory');
  if(!container) return;

  // Sort by distance if we have location
  const sorted = userLat
    ? LOCKER_DATA.slice().sort((a,b) => distMiles(userLat,userLon,a.lat,a.lon) - distMiles(userLat,userLon,b.lat,b.lon))
    : LOCKER_DATA;

  container.innerHTML = sorted.map((l, idx) => {
    const dist = userLat ? Math.round(distMiles(userLat,userLon,l.lat,l.lon)) : null;
    const isNearest = idx === 0 && dist !== null;

    const distBadge = dist !== null
      ? `<span style="font-size:11px;color:var(--corn);background:var(--corn-dim);padding:3px 9px;border-radius:3px;white-space:nowrap;">${dist} mi${isNearest ? ' ★' : ''}</span>`
      : '';

    const usdaBadge = l.usda
      ? `<span style="font-size:9px;letter-spacing:2px;padding:2px 7px;border-radius:2px;background:var(--up-dim);color:var(--up);text-transform:uppercase;font-weight:700;">USDA</span>`
      : '';

    const websiteLink = l.url
      ? `<a href="${l.url}" target="_blank" rel="noopener" class="auction-link">Website ↗</a>`
      : '';

    const extraLinks = (l.links || []).map(lk =>
      `<a href="${lk.url}" target="_blank" rel="noopener" class="auction-link">${lk.label}</a>`
    ).join('');

    const phoneHtml = l.phone
      ? `<div class="auction-detail" style="margin-top:4px;">📞 ${l.phone}</div>`
      : '';

    const borderStyle = isNearest ? 'border-color:rgba(60,185,106,.25);' : '';

    return `<div class="panel" style="${borderStyle}">
      <div class="auction-header" style="margin-bottom:6px;">
        <div>
          <div class="auction-name">${l.name}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px;">📍 ${l.loc}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
          ${distBadge}
          ${usdaBadge}
        </div>
      </div>
      ${phoneHtml}
      <div class="auction-detail" style="margin-top:6px;">${l.note}</div>
      <div class="auction-links" style="margin-top:8px;">
        ${websiteLink}${extraLinks}
        <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.lat+','+l.lon)}" target="_blank" rel="noopener" class="auction-link">Directions ↗</a>
      </div>
    </div>`;
  }).join('');
}

// ── USDA WEEKLY FEEDER PRICE BY WEIGHT CLASS ─────────────────────────────────
// Source: USDA National Feeder & Stocker Cattle Summary (sj_ls850.txt)
// Parses Upper Midwest / MN steer prices by weight range
// Updated weekly, Monday mornings

let FEEDER_WEIGHT_DATA = null; // cached parsed data
let FEEDER_REPORT_DATE = '';

async function loadFeederWeightPrices() {
  try {
    const proxy = 'https://api.allorigins.win/raw?url=' + 
      encodeURIComponent('https://www.ams.usda.gov/mnreports/sj_ls850.txt');
    const r = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
    if(!r.ok) throw new Error('fetch failed');
    const text = await r.text();

    // Extract report date
    const dateMatch = text.match(/Week Ending[:\s]+([\d\/]+)/i) ||
                      text.match(/WEEK ENDING\s+([\d\/]+)/i);
    FEEDER_REPORT_DATE = dateMatch ? dateMatch[1] : 'Recent';

    // Find Upper Midwest or MN/WI/IA/SD region
    // The report lists states — look for MINNESOTA, WISCONSIN, IOWA, SOUTH DAKOTA
    // as these are closest to our operation
    // Priority: MINNESOTA > UPPER MIDWEST aggregate
    const regions = ['MINNESOTA', 'SOUTH DAKOTA', 'IOWA', 'WISCONSIN', 'NEBRASKA'];
    let regionText = '';
    let regionName = '';
    
    // Find nearest region — each state block ends when the next ALL-CAPS state name appears
    // State blocks look like: "   MINNESOTA 1,234.  X pct... Steers: ... Heifers: ..."
    const statePattern = /\n   [A-Z]{2,}(?:\s+AND\s+[A-Z]+)?\s+[\d,]+\./g;

    for(const region of regions) {
      const searchStr = '   ' + region + ' ';
      const idx = text.indexOf(searchStr);
      if(idx === -1) continue;

      // Find the start of the NEXT state block after this one
      statePattern.lastIndex = idx + searchStr.length;
      const nextMatch = statePattern.exec(text);
      const endIdx = nextMatch ? nextMatch.index : idx + 4000;

      regionText = text.substring(idx, endIdx);
      regionName = region;
      break;
    }

    if(!regionText) throw new Error('region not found');

    // Parse all "WWW-WWW lbs (avg_wt) price" entries from the Steers section
    // The report format: 400-449 lbs (423) 506.32; 450-499 lbs (467) 502.96; ...
    const weightPattern = /(\d{3}-\d{3})\s+lbs\s+\([\d.]+\)\s+([\d.]+)/g;

    // Extract steers section (between 'Steers:' and 'Heifers:')
    const steersStart = regionText.indexOf('Steers:');
    const heifersStart = regionText.indexOf('Heifers:');
    const steersText = steersStart !== -1
      ? regionText.substring(steersStart, heifersStart > steersStart ? heifersStart : regionText.length)
      : regionText;

    // Within steers, take only Medium and Large 1 (stop before "1-2")
    const ml1Start = steersText.indexOf('Medium and Large 1');
    const ml12Start = steersText.indexOf('Medium and Large 1-2');
    const ml1Section = ml1Start !== -1
      ? steersText.substring(ml1Start, ml12Start > ml1Start ? ml12Start : steersText.length)
      : steersText;

    const weightPrices = {};
    let match;
    while((match = weightPattern.exec(ml1Section)) !== null) {
      const range = match[1];
      const price = parseFloat(match[2]);
      const low = parseInt(range.split('-')[0]);
      const bucket = Math.floor(low / 100) * 100;
      const key = bucket + '-' + (bucket + 99);
      if(!weightPrices[key]) weightPrices[key] = { sum: 0, count: 0 };
      weightPrices[key].sum += price;
      weightPrices[key].count++;
    }

    // Build clean weight class averages
    const buckets = ['400-499','500-599','600-699','700-799','800-899','900-999'];
    const parsedPrices = {};
    buckets.forEach(b => {
      if(weightPrices[b]) {
        parsedPrices[b] = (weightPrices[b].sum / weightPrices[b].count).toFixed(2);
      }
    });

    // If fewer than 3 weight classes came back, supplement missing ones using
    // CME feeder index as the 700-799 anchor and standard ¢/cwt slide
    const filledPrices = {};
    const offsets = {'400-499':120,'500-599':80,'600-699':40,'700-799':0,'800-899':-25,'900-999':-45};
    const cmeBase = CATTLE_DATA.fc ? CATTLE_DATA.fc.price : null;
    // Find an anchor from parsed data or CME
    let anchor700 = parsedPrices['700-799'] ? parseFloat(parsedPrices['700-799'])
                  : parsedPrices['600-699']  ? parseFloat(parsedPrices['600-699']) - 40
                  : parsedPrices['800-899']  ? parseFloat(parsedPrices['800-899']) + 25
                  : cmeBase;
    buckets.forEach(b => {
      if(parsedPrices[b]) {
        filledPrices[b] = parsedPrices[b]; // prefer real USDA data
      } else if(anchor700) {
        filledPrices[b] = (anchor700 + offsets[b]).toFixed(2); // fill gap with extrapolation
      }
    });

    FEEDER_WEIGHT_DATA = {
      region: regionName,
      date: FEEDER_REPORT_DATE,
      prices: filledPrices,
      sparse: Object.keys(parsedPrices).length < 3,
      _parsedKeys: Object.keys(parsedPrices)
    };

    updateFeederCard();
    buildBarnTable(); // refresh drawer feeder rows now that USDA data is loaded

  } catch(e) {
    // Fallback: use CME futures as the 700-800 lb anchor and extrapolate
    // Typical MN premiums: lighter cattle bring more per cwt
    if(CATTLE_DATA.fc) {
      const base = CATTLE_DATA.fc.price;
      FEEDER_WEIGHT_DATA = {
        region: 'CME Index proxy',
        date: 'Futures-based',
        prices: {
          '400-499': (base + 120).toFixed(2),
          '500-599': (base + 80).toFixed(2),
          '600-699': (base + 40).toFixed(2),
          '700-799': base.toFixed(2),
          '800-899': (base - 25).toFixed(2),
          '900-999': (base - 45).toFixed(2),
        },
        _parsedKeys: ['400-499','500-599','600-699','700-799','800-899','900-999']
      };
    }
    updateFeederCard();
    buildBarnTable(); // refresh drawer feeder rows with CME fallback data
  }
}

function updateFeederCard() {
  const container = document.getElementById('feeder-weight-table');
  if(!container || !FEEDER_WEIGHT_DATA) return;

  const disc = CATTLE_TYPE_DISCOUNTS[cattleType].discountCwt;
  const typeLabel = CATTLE_TYPE_DISCOUNTS[cattleType].label;
  const prices = FEEDER_WEIGHT_DATA.prices;

  // Note: discount applies to SELL price not BUY (feeder) price
  // But for Holstein/crossbred, buyers pay less for incoming feeders too
  // Use half the slaughter discount as a proxy for feeder price differential
  const feederDisc = disc * 0.4; // feeder discount is roughly 40% of slaughter discount

  const parsedPrices = FEEDER_WEIGHT_DATA.sparse ? null : null; // use sparseKeys for est. marking
  const sparseKeys = FEEDER_WEIGHT_DATA._parsedKeys || null;

  const rows = Object.entries(prices).map(([range, price], idx) => {
    const adjPrice = (parseFloat(price) - feederDisc).toFixed(2);
    const isTarget = range === '700-799' || range === '800-899';
    const isEst = FEEDER_WEIGHT_DATA.sparse && sparseKeys && !sparseKeys.includes(range);
    return `<tr style="${isTarget ? 'background:var(--bg3);' : ''}">
      <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${range} lbs${isEst ? ' <span style="font-size:9px;color:var(--txt3);opacity:.7;">est</span>' : ' <span style="font-size:9px;color:var(--txt3);opacity:.7;">actual</span>'}</td>
      <td style="font-size:13px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${adjPrice}¢</td>
    </tr>`;
  }).join('');

  const discNote = feederDisc > 0 
    ? `<div style="font-size:10px;color:var(--txt3);padding:4px 8px;border-top:1px solid var(--border);">
        ${typeLabel} · est. −${feederDisc.toFixed(2)}¢/cwt vs beef steer
      </div>`
    : '';

  // Build header — live USDA data vs CME fallback are clearly distinct
  const isUsda = FEEDER_WEIGHT_DATA.region !== 'CME Index proxy';
  const headerText = isUsda
    ? `USDA · ${FEEDER_WEIGHT_DATA.region} · WK ENDING ${FEEDER_WEIGHT_DATA.date}`
    : `CME INDEX ESTIMATE · No USDA data yet`;
  const headerColor = isUsda ? 'var(--up)' : 'var(--txt3)';
  const sourceTag  = isUsda ? 'Med/Lg #1 · USDA AMS National Feeder Summary' : 'Based on CME feeder index';

  container.innerHTML = `
    <div style="font-size:9px;letter-spacing:1px;color:${headerColor};text-transform:uppercase;padding:8px 8px 4px;font-weight:700;">
      ${headerText}
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="font-size:9px;color:var(--txt3);letter-spacing:2px;text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);">WEIGHT</th>
        <th style="font-size:9px;color:var(--txt3);letter-spacing:2px;text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);">¢/LB</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${discNote}
    <div style="font-size:9px;color:var(--txt3);padding:4px 8px;border-top:1px solid var(--border);font-style:italic;">
      ${sourceTag}
    </div>
  `;
}

// ── SLAUGHTER CATTLE WEIGHT CLASS TABLE ──────────────────────────────────────
// Pulls from USDA IA-MN weekly direct slaughter report
// Shows finished steer prices by weight, adjusted for cattle type

function updateSlaughterWeightTable() {
  const container = document.getElementById('slaughter-weight-table');
  if(!container || !CATTLE_DATA.lc) return;

  const disc = CATTLE_TYPE_DISCOUNTS[cattleType].discountCwt;
  const typeLabel = CATTLE_TYPE_DISCOUNTS[cattleType].label;
  const base = CATTLE_DATA.lc.price;

  // Weight premiums/discounts relative to the 1200-1299 lb baseline
  // Based on USDA dressed weight grade premiums — heavier = more total value
  // but lighter finish can bring premium per cwt in certain markets
  const weightClasses = [
    { range: '1000–1099 lbs', adj: +2.50,  note: 'Light finish' },
    { range: '1100–1199 lbs', adj: +1.00,  note: '' },
    { range: '1200–1299 lbs', adj:  0,     note: 'CME baseline' },
    { range: '1300–1399 lbs', adj: -1.50,  note: 'Heavy' },
    { range: '1400–1499 lbs', adj: -3.50,  note: 'Heavy discount' },
  ];

  const rows = weightClasses.map(w => {
    const price = (base + w.adj - disc).toFixed(2);
    const isBaseline = w.adj === 0;
    const adjColor = w.adj > 0 ? 'var(--up)' : w.adj < 0 ? 'var(--down)' : 'var(--txt1)';
    return `<tr style="${isBaseline ? 'background:var(--bg3);' : ''}">
      <td style="font-size:11px;color:var(--txt3);padding:5px 8px;">${w.range}${isBaseline ? ' <span style="font-size:9px;color:var(--txt3);opacity:.7;">baseline</span>' : ' <span style="font-size:9px;color:var(--txt3);opacity:.7;">est</span>'}</td>
      <td style="font-size:13px;color:var(--txt1);font-weight:700;padding:5px 8px;text-align:right;">${price}¢</td>
      <td style="font-size:10px;color:${adjColor};padding:5px 8px;text-align:right;">${w.adj > 0 ? '+' : ''}${w.adj !== 0 ? w.adj.toFixed(2) : '—'}</td>
    </tr>`;
  }).join('');

  const discNote = disc > 0
    ? `<div style="font-size:10px;color:var(--txt3);padding:4px 8px;border-top:1px solid var(--border);">
        ${typeLabel} · −${disc.toFixed(2)}¢/cwt applied
       </div>` : '';

  container.innerHTML = `
    <div style="font-size:10px;letter-spacing:2px;color:var(--txt3);text-transform:uppercase;padding:4px 8px;">
      Finish Weight Premiums
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:left;padding:3px 8px;border-bottom:1px solid var(--border);">WEIGHT</th>
        <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:right;padding:3px 8px;border-bottom:1px solid var(--border);">¢/LB</th>
        <th style="font-size:9px;color:var(--txt3);letter-spacing:1px;text-align:right;padding:3px 8px;border-bottom:1px solid var(--border);">ADJ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${discNote}
    <div style="font-size:9px;color:var(--txt3);padding:4px 8px;border-top:1px solid var(--border);">
      est · anchored to CME nearby · premiums per USDA grade schedule
    </div>
  `;
}

// ── CORN CARD — BASIS + SPREAD ────────────────────────────────────────────────
// Pulls nearest elevator basis from grain side and new crop carry from GRAIN_DATA

function updateCornCardCattle() {
  // Basis — use nearest elevator from ELEVATORS if available
  const basisEl    = document.getElementById('cn-c-basis');
  const cashEl     = document.getElementById('cn-c-cash');
  const newCropEl  = document.getElementById('cn-c-newcrop');
  const carryEl    = document.getElementById('cn-c-carry');
  const sourceEl   = document.getElementById('cn-c-source');

  if(!CATTLE_DATA.cn || !basisEl) return;

  const nearby   = CATTLE_DATA.cn.price;
  const newCrop  = GRAIN_DATA?.cn2?.price || null;

  // Find nearest elevator basis
  let basis = null;
  let elevName = 'nearest elevator';
  if(userLat && Object.keys(ELEVATORS).length > 0) {
    const sorted = Object.keys(ELEVATORS).sort((a,b) =>
      distMiles(userLat,userLon,ELEVATORS[a].lat,ELEVATORS[a].lon) -
      distMiles(userLat,userLon,ELEVATORS[b].lat,ELEVATORS[b].lon)
    );
    const nearest = ELEVATORS[sorted[0]];
    if(nearest && nearest.cornBasis !== null) {
      basis = nearest.cornBasis;
      elevName = nearest.name.split('—')[0].trim();
    }
  }

  // Basis — show elevator name in source, price in cell
  const basisLabel = document.getElementById('cn-c-basis-label');
  if(basisLabel) basisLabel.textContent = elevName;
  if(basisEl) {
    if(basis !== null) {
      basisEl.textContent = (basis >= 0 ? '+' : '') + basis.toFixed(2);
      basisEl.style.color = basis >= 0 ? 'var(--up)' : 'var(--down)';
    } else {
      basisEl.textContent = 'N/A';
      basisEl.style.color = 'var(--txt3)';
    }
  }

  // Local cash
  if(cashEl) {
    const cash = basis !== null ? nearby + basis : nearby;
    cashEl.textContent = '$' + cash.toFixed(4) + '/bu';
  }

  // New crop
  if(newCropEl && newCrop) {
    newCropEl.textContent = '$' + newCrop.toFixed(4) + '/bu';
    newCropEl.style.color = newCrop > nearby ? 'var(--up)' : 'var(--down)';
  } else if(newCropEl) {
    newCropEl.textContent = '—';
  }

  // Carry (new crop premium/discount over nearby)
  if(carryEl && newCrop) {
    const carry = newCrop - nearby;
    carryEl.textContent = (carry >= 0 ? '+' : '') + carry.toFixed(4) + '/bu';
    carryEl.style.color = carry > 0 ? 'var(--corn)' : 'var(--txt3)';
    carryEl.title = carry > 0 ? 'Market paying to store — consider selling new crop forward'
                              : 'Inverted market — sell cash, buy back if needed';
  } else if(carryEl) {
    carryEl.textContent = '—';
  }

  if(sourceEl) sourceEl.textContent = elevName + ' basis · nearby vs new crop';
}

// ── DAIRY ─────────────────────────────────────────────────────────────────────
// Grade A dairy plants serving southern MN — curated list
const DAIRY_PLANTS = {
  ampi_newulm:{name:'AMPI — New Ulm',loc:'New Ulm MN',lat:44.3117,lon:-94.4614,type:'Cooperative',products:'Cheese · Butter · Powder',phone:'(507) 354-8295',url:'https://www.ampi.com',premium:0.15,note:'Upper Midwest co-op · largest dairy co-op in MN · monthly price announcement'},
  ampi_roch:  {name:'AMPI — Rochester',loc:'Rochester MN',lat:44.0234,lon:-92.4630,type:'Cooperative',products:'Fluid Milk · Cream',phone:'(507) 289-6677',url:'https://www.ampi.com',premium:0.12,note:'Upper Midwest co-op · fluid milk processing'},
  bongards:   {name:"Bongards' Creameries",loc:'Norwood Young America MN',lat:44.7692,lon:-93.9186,type:'Cooperative',products:'Cheese · Butter',phone:'(952) 466-5521',url:'https://www.bongards.com',premium:0.18,note:'Member-owned · south-central MN · strong cheese premium'},
  lol:        {name:"Land O'Lakes",loc:'Arden Hills MN',lat:45.0900,lon:-93.1400,type:'Cooperative',products:'Butter · Cheese · Powder',phone:'(800) 328-9680',url:'https://www.landolakesinc.com',premium:0.20,note:'Major co-op · statewide MN pickup routes'},
  foremost:   {name:'Foremost Farms USA',loc:'Dresser WI',lat:45.3611,lon:-92.6347,type:'Cooperative',products:'Cheese · Butter · Powder',phone:'(800) 362-9196',url:'https://www.foremostfarms.com',premium:0.10,note:'MN/WI region co-op · monthly mailbox price'},
  dfa:        {name:'Dairy Farmers of America',loc:'Mankato MN',lat:44.1636,lon:-93.9994,type:'Cooperative',products:'Multiple Products',phone:'(816) 801-6455',url:'https://www.dfamilk.com',premium:0.14,note:'National co-op · Upper Midwest division'}
};

// USDA Order 30 (Upper Midwest) — updated monthly
// class1Diff: USDA Class 1 differential (fluid milk premium over Class 3 / Grade B)
const ORDER30 = {price: 18.45, month: 'February 2026', class1Diff: 2.10};

let DAIRY_DATA = {dc: null};  // dc = Grade B (Class 3) CME futures
let selectedDairyPlant = null;

// ── DAIRY PRICE FETCH ─────────────────────────────────────────────────────────
function updateOrd30Card() {
  const c3 = DAIRY_DATA.dc;
  if(!c3) return;
  const c3Price    = c3.price;
  const gradeAPrice = c3Price + ORDER30.class1Diff;
  const gradeAOpen  = c3.open + ORDER30.class1Diff;
  const isGradeA = dairyGradeMode === 'A';
  const displayPrice = isGradeA ? gradeAPrice : c3Price;
  const displayOpen  = isGradeA ? gradeAOpen  : c3.open;
  const displayChg   = displayPrice - displayOpen;

  // Card chrome
  const labelEl = document.getElementById('ord30-card-label');
  const nameEl  = document.getElementById('ord30-card-name');
  const unitEl  = document.getElementById('ord30-card-unit');
  if(labelEl) labelEl.textContent = isGradeA ? 'USDA · Order 30 · Class 1' : 'CME · Class 3 · Nearby';
  if(nameEl)  nameEl.textContent  = isGradeA ? 'Grade A · Upper Midwest'   : 'Grade B · Upper Midwest';
  if(unitEl)  unitEl.textContent  = isGradeA ? '$ / cwt · Grade A Class 1 est.' : '$ / cwt · Grade B Class 3';

  // Price and badge
  const o30el = document.getElementById('p-ord30');
  if(o30el) { o30el.textContent = '$'+displayPrice.toFixed(2); o30el.style.color='var(--dairy)'; }
  setBadge('b-ord30', displayChg, (displayChg/displayOpen)*100);

  // Footnote
  const dateEl = document.getElementById('dairy-blend-date');
  if(dateEl) dateEl.textContent = isGradeA
    ? 'Class 1 = Class 3 + $'+ORDER30.class1Diff.toFixed(2)+' diff · '+ORDER30.month
    : 'CME dc.f · Class 3 futures · nearby contract · '+ORDER30.month;
}

async function loadDairyPrices() {
  const fb = {dc:{price:18.45,open:18.20,high:18.70,low:18.00,change:0.25,pct:1.37}};
  async function fetchOne(sym) {
    try {
      const r = await fetch('https://stooq.com/q/l/?s='+sym+'&f=sd2t2ohlcv&h&e=csv');
      const t = await r.text();
      const cols = t.trim().split('\n')[1]?.split(',');
      if(!cols) throw 0;
      const [open,high,low,close] = [3,4,5,6].map(i=>parseFloat(cols[i]));
      if(isNaN(close)) throw 0;
      return {price:close,open,high,low,change:close-open,pct:((close-open)/open)*100};
    } catch { return null; }
  }
  const dc = await fetchOne('dc.f');
  DAIRY_DATA = {dc: dc||fb.dc};

  // Grade B (Class 3) card
  const c3 = DAIRY_DATA.dc;
  const dcEl = document.getElementById('p-dc'); if(!dcEl) return;
  dcEl.textContent = '$'+c3.price.toFixed(2);
  dcEl.style.color = c3.change>0.05?'var(--up)':c3.change<-0.05?'var(--down)':'var(--dairy)';
  const h=document.getElementById('h-dc'),l=document.getElementById('l-dc'),v=document.getElementById('v-dc');
  if(h) h.textContent=c3.high.toFixed(2); if(l) l.textContent=c3.low.toFixed(2); if(v) v.textContent=c3.open.toFixed(2);
  setBadge('b-dc', c3.change, c3.pct);

  // Grade A (Class 1) card — computed from Class 3 + Order 30 Class 1 differential
  const gradeAPrice = c3.price + ORDER30.class1Diff;
  const gradeAOpen  = c3.open  + ORDER30.class1Diff;
  const gradeAChg   = gradeAPrice - gradeAOpen;
  const dc2El = document.getElementById('p-dc2'); if(dc2El) {
    dc2El.textContent = '$'+gradeAPrice.toFixed(2);
    dc2El.style.color = gradeAChg>0.05?'var(--up)':gradeAChg<-0.05?'var(--down)':'var(--dairy)';
  }
  setBadge('b-dc2', gradeAChg, (gradeAChg/gradeAOpen)*100);
  // Repurpose meta items: CLASS 3 base | CL1 DIFF | PREV
  const hEl=document.getElementById('h-dc2'),lEl=document.getElementById('l-dc2'),vEl=document.getElementById('v-dc2');
  if(hEl) hEl.textContent='$'+c3.price.toFixed(2);
  if(lEl) lEl.textContent='+$'+ORDER30.class1Diff.toFixed(2);
  if(vEl) vEl.textContent='$'+gradeAOpen.toFixed(2);

  // Order 30 card — driven by grade selection
  updateOrd30Card();

  // Insight strip — Grade A primary
  let msg = '';
  if(c3.change>0.05) msg='<strong>Grade A (Class 1) est. $'+gradeAPrice.toFixed(2)+'/cwt</strong> — fluid milk prices moving up. Good time to review your mailbox price vs forward contracts.';
  else if(c3.change<-0.05) msg='<strong>Grade A softening</strong> — est. <strong>$'+gradeAPrice.toFixed(2)+'/cwt</strong> today. Check your DMC coverage level in the Margin Calc tab.';
  else if(c3.price<16) msg='<strong>Grade A est. below $18.00/cwt</strong> — tight margins likely. Review the Margin Calc tab and your DMC coverage.';
  else msg='Grade A (Class 1) est. <strong>$'+gradeAPrice.toFixed(2)+'/cwt</strong> · Grade B (Class 3) <strong>$'+c3.price.toFixed(2)+'/cwt</strong> · Order 30 blend <strong>$'+ORDER30.price.toFixed(2)+'/cwt</strong>';
  const ins = document.getElementById('dairy-insight'); if(ins) ins.innerHTML=msg;

  // Sync feed price display from existing data
  updateDairyFeedPrices();
  buildDairyPlantTable();
  buildDairyPlantDirectory();
  // Pre-fill margin calc milk price
  const mpSlider=document.getElementById('dmc-mp'), mpNum=document.getElementById('dmc-mp-n');
  if(mpSlider&&!mpSlider._touched){const v=ORDER30.price.toFixed(2);mpSlider.value=v;if(mpNum)mpNum.value=v;document.getElementById('dmc-mp-val').textContent='$'+v;}
  calcDairy();
}

function updateDairyFeedPrices() {
  const cornEl=document.getElementById('dairy-corn-price');
  if(cornEl&&GRAIN_DATA?.cn?.price) cornEl.textContent='$'+GRAIN_DATA.cn.price.toFixed(4)+'/bu';
  const sbmEl=document.getElementById('dairy-sbm-price');
  if(sbmEl) { const sbmVal=document.getElementById('p-sbm')?.textContent; if(sbmVal&&sbmVal!=='—') sbmEl.textContent=sbmVal+'/ton'; }
  const hayEl=document.getElementById('dairy-hay-price');
  if(hayEl) { const hayVal=document.getElementById('p-hay')?.textContent; if(hayVal&&hayVal!=='—') hayEl.textContent=hayVal+'/ton'; }
  // Also seed margin calc corn/hay/sbm from live prices
  if(GRAIN_DATA?.cn?.price) {
    const dmpSlider=document.getElementById('dmc-mp'),dmpNum=document.getElementById('dmc-mp-n');
    if(!dmpSlider?._touched) { /* leave as is — already set from Order 30 */ }
    // Update corn field in margin calc with current futures price hint
  }
}

// ── DAIRY PLANT SELECTOR ──────────────────────────────────────────────────────
function sortedDairyPlantKeys() {
  const keys = Object.keys(DAIRY_PLANTS);
  if(!userLat) return keys;
  return keys.slice().sort((a,b)=>distMiles(userLat,userLon,DAIRY_PLANTS[a].lat,DAIRY_PLANTS[a].lon)-distMiles(userLat,userLon,DAIRY_PLANTS[b].lat,DAIRY_PLANTS[b].lon));
}

function rebuildDairyPlantSelect() {
  const sel = document.getElementById('dairy-plant-select'); if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select your plant…</option>';
  sortedDairyPlantKeys().forEach(k => {
    const p = DAIRY_PLANTS[k];
    const dist = userLat ? Math.round(distMiles(userLat,userLon,p.lat,p.lon)) : null;
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = p.name + ' — ' + p.loc + (dist!==null?' (~'+dist+' mi)':'');
    sel.appendChild(opt);
  });
  if(cur && DAIRY_PLANTS[cur]) { sel.value = cur; }
  else if(userLat && sortedDairyPlantKeys().length) {
    sel.value = sortedDairyPlantKeys()[0];
    onDairyPlantChange();
  }
  buildDairyPlantTable();
  buildDairyPlantDirectory();
}

function onDairyPlantChange() {
  const key = document.getElementById('dairy-plant-select')?.value;
  const distEl = document.getElementById('dairy-plant-dist');
  const detailEl = document.getElementById('dairy-plant-detail');
  selectedDairyPlant = key || null;
  if(!key) {
    if(distEl) distEl.textContent='';
    if(detailEl) { detailEl.style.display='none'; detailEl.innerHTML=''; }
    const pmEl=document.getElementById('dairy-plant-premium'); if(pmEl) pmEl.textContent='select plant ↑';
    const mbEl=document.getElementById('dairy-plant-mailbox'); if(mbEl) mbEl.textContent='—';
    buildDairyPlantTable(); return;
  }
  const p = DAIRY_PLANTS[key];
  if(userLat&&distEl) distEl.textContent='~'+Math.round(distMiles(userLat,userLon,p.lat,p.lon))+' mi away';
  // Show premium on card
  const pmEl=document.getElementById('dairy-plant-premium');
  if(pmEl) { pmEl.textContent=(p.premium>=0?'+':'')+p.premium.toFixed(2)+' $/cwt'; pmEl.style.color=p.premium>=0?'var(--up)':'var(--down)'; }
  const c3Price    = DAIRY_DATA.dc?.price || (ORDER30.price - ORDER30.class1Diff);
  const gradeABase = c3Price + ORDER30.class1Diff;
  const isGradeA   = dairyGradeMode === 'A';
  const basePrice  = isGradeA ? gradeABase : c3Price;
  const mailbox = basePrice + p.premium;
  const mbEl=document.getElementById('dairy-plant-mailbox');
  if(mbEl) { mbEl.textContent='$'+mailbox.toFixed(2)+'/cwt ('+(isGradeA?'Grade A':'Grade B')+' est.)'; }
  // Update margin calc milk price to this plant's mailbox price
  const mpSlider=document.getElementById('dmc-mp'),mpNum=document.getElementById('dmc-mp-n'),mpVal=document.getElementById('dmc-mp-val');
  if(mpSlider){mpSlider.value=mailbox.toFixed(2);if(mpNum)mpNum.value=mailbox.toFixed(2);if(mpVal)mpVal.textContent='$'+mailbox.toFixed(2);}
  calcDairy();
  buildDairyPlantTable();
  highlightDairyTableRow(key);
}

function highlightDairyTableRow(key) {
  document.querySelectorAll('#dairy-plant-table-body tr').forEach(tr=>tr.classList.toggle('selected',tr.dataset.key===key));
}

// ── DAIRY PLANT TABLE ─────────────────────────────────────────────────────────
function buildDairyPlantTable() {
  const tbody = document.getElementById('dairy-plant-table-body'); if(!tbody) return;
  const sorted = sortedDairyPlantKeys();
  const c3Price    = DAIRY_DATA.dc?.price || (ORDER30.price - ORDER30.class1Diff);
  const gradeABase = c3Price + ORDER30.class1Diff;
  const isGradeA   = dairyGradeMode === 'A';
  const basePrice  = isGradeA ? gradeABase : c3Price;
  const gradeLabel = isGradeA ? 'Grade A' : 'Grade B';

  // Update column header and footnote dynamically
  const hdr = document.getElementById('dairy-mailbox-col-header');
  if(hdr) hdr.textContent = `Est. ${gradeLabel} Mailbox`;
  const fn = document.getElementById('dairy-table-footnote');
  if(fn) fn.textContent = isGradeA
    ? 'Grade A mailbox = Class 1 est. + plant premium · premiums estimated — verify with your plant\'s monthly announcement'
    : 'Grade B mailbox = Class 3 (CME) est. + plant premium · premiums estimated — verify with your plant\'s monthly announcement';

  const rows = sorted.map((key,idx) => {
    const p = DAIRY_PLANTS[key];
    const mailbox = (basePrice + p.premium).toFixed(2);
    const pmStr = (p.premium>=0?'+':'')+p.premium.toFixed(2);
    const pmClass = p.premium>=0?'basis-pos':'basis-neg';
    const dist = userLat ? Math.round(distMiles(userLat,userLon,p.lat,p.lon)) : null;
    const distBadge = dist!==null ? (idx===0?`<span style="color:var(--dairy);background:var(--dairy-dim);padding:2px 7px;border-radius:3px;font-size:11px;">${dist} mi ★</span>`:`<span style="font-size:12px;">${dist} mi</span>`) : '—';
    return `<tr data-key="${key}" onclick="document.getElementById('dairy-plant-select').value='${key}';onDairyPlantChange()">
      <td><div class="elev-name-cell">${p.name}</div><div class="elev-loc-cell">${p.loc} · <span style="color:var(--txt3);font-size:11px;">${p.type}</span></div></td>
      <td style="color:var(--dairy);font-weight:700;">$${mailbox}</td>
      <td class="${pmClass}">${pmStr}</td>
      <td>${distBadge}</td></tr>`;
  });
  tbody.innerHTML = rows.join('');
  if(selectedDairyPlant) highlightDairyTableRow(selectedDairyPlant);
}

// ── DAIRY PLANT DIRECTORY ─────────────────────────────────────────────────────
function buildDairyPlantDirectory() {
  const col1=document.getElementById('dairy-dir-col-1'), col2=document.getElementById('dairy-dir-col-2');
  if(!col1||!col2) return;
  col1.innerHTML=''; col2.innerHTML='';
  const sorted = sortedDairyPlantKeys();
  const c3Price    = DAIRY_DATA.dc?.price || (ORDER30.price - ORDER30.class1Diff);
  const gradeABase = c3Price + ORDER30.class1Diff;
  const isGradeA   = dairyGradeMode === 'A';
  const basePrice  = isGradeA ? gradeABase : c3Price;
  const gradeLabel = isGradeA ? 'GRADE A' : 'GRADE B';
  sorted.forEach((key,idx) => {
    const p = DAIRY_PLANTS[key];
    const dist = userLat ? Math.round(distMiles(userLat,userLon,p.lat,p.lon)) : null;
    const isNearest = idx===0&&dist!==null;
    const distBadge = dist!==null ? `<span style="font-size:11px;color:var(--dairy);background:var(--dairy-dim);padding:3px 9px;border-radius:3px;white-space:nowrap;">${dist} mi${isNearest?' ★':''}</span>` : '';
    const mailbox = basePrice + p.premium;
    const pmStr = (p.premium>=0?'+':'')+p.premium.toFixed(2);
    const borderStyle = isNearest?'border-color:rgba(74,159,212,.3);':'';
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.name+', '+p.loc)}`;
    const websiteLink = p.url?`<a href="${p.url}" target="_blank" rel="noopener" class="auction-link">Website ↗</a>`:'';
    const card = `<div class="panel" style="${borderStyle}">
      <div class="auction-header" style="margin-bottom:6px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
            <span style="font-size:9px;letter-spacing:2px;color:var(--dairy);background:var(--dairy-dim);padding:2px 8px;border-radius:3px;">${gradeLabel} · ${p.type.toUpperCase()}</span>
          </div>
          <div class="auction-name">${p.name}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">${distBadge}</div>
      </div>
      <div class="auction-detail">📍 ${p.loc}</div>
      <div class="auction-detail">📞 <a href="tel:${p.phone}" style="color:var(--txt3);text-decoration:none;">${p.phone}</a></div>
      <div class="plant-stat-row">
        <div class="plant-stat-box">
          <div class="plant-stat-label">PRODUCTS</div>
          <div class="plant-stat-val" style="font-size:12px;color:var(--txt2);">${p.products}</div>
        </div>
        <div class="plant-stat-box">
          <div class="plant-stat-label">EST. PREMIUM</div>
          <div class="plant-stat-val" style="color:${p.premium>=0?'var(--up)':'var(--down)'};">${pmStr} $/cwt</div>
        </div>
        <div class="plant-stat-box plant-stat-box--mailbox">
          <div class="plant-stat-label" style="color:var(--dairy);">EST. MAILBOX</div>
          <div class="plant-stat-val" style="color:var(--dairy);">$${mailbox.toFixed(2)}/cwt</div>
        </div>
      </div>
      ${p.note?`<div class="auction-detail" style="margin-top:8px;">${p.note}</div>`:''}
      <div class="auction-links" style="margin-top:10px;">
        <button onclick="document.getElementById('dairy-plant-select').value='${key}';onDairyPlantChange();switchSubtab('dairy');switchTab('dairy','prices',document.querySelector('#sub-dairy .tab'));" class="auction-link" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;color:var(--dairy);padding:0;letter-spacing:1px;">Set as My Plant ★</button>
        ${websiteLink}
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="auction-link">Directions ↗</a>
      </div>
    </div>`;
    if(idx < Math.ceil(sorted.length/2)) col1.innerHTML+=card;
    else col2.innerHTML+=card;
  });
}

// ── DAIRY CHARTS ──────────────────────────────────────────────────────────────
let dairyHistRange = 90;
let dairyGradeMode = 'A'; // 'A' = Grade A (Class 1), 'B' = Grade B (Class 3)

// MN Grade A seasonal index — % deviation from annual avg by month (Jan–Dec)
// Spring flush tends to soften prices; winter tightness lifts them
const DAIRY_SEASONAL = [+1.2, +0.8, +1.8, +2.4, +1.6, -0.6, -1.8, -2.4, -2.0, -1.2, +0.2, +0.8];

function setDairyRange(r, btn) {
  dairyHistRange = r;
  // Only clear active on range buttons (not grade buttons)
  document.querySelectorAll('#dairy-charts .hist-controls .hist-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDairyCharts();
}

function setDairyGrade(grade, btn) {
  dairyGradeMode = grade;
  // Toggle active state on grade buttons only
  document.getElementById('dairy-grade-a-btn')?.classList.toggle('active', grade === 'A');
  document.getElementById('dairy-grade-b-btn')?.classList.toggle('active', grade === 'B');
  // Update insight strip based on grade selection
  const c3 = DAIRY_DATA.dc;
  const ins = document.getElementById('dairy-insight');
  if(ins && c3) {
    const c3Price    = c3.price;
    const gradeAPrice = c3Price + ORDER30.class1Diff;
    if(grade === 'A') {
      ins.innerHTML = '<strong>Grade A (Class 1)</strong> selected — fluid milk standard. Est. <strong>$'+gradeAPrice.toFixed(2)+'/cwt</strong> · Order 30 Class 1 differential +$'+ORDER30.class1Diff.toFixed(2)+' above Class 3.';
    } else {
      ins.innerHTML = '<strong>Grade B (Class 3)</strong> selected — manufacturing milk. Tracks CME Class 3 futures directly at est. <strong>$'+c3Price.toFixed(2)+'/cwt</strong>.';
    }
  }
  // Update Order 30 card chrome + price
  updateOrd30Card();
  // Rebuild table and directory with new grade base price
  buildDairyPlantTable();
  buildDairyPlantDirectory();
  // Re-run plant change to update mailbox card with correct grade
  if(selectedDairyPlant) onDairyPlantChange();
  // Update charts
  renderDairyCharts();
}

function renderDairyCharts() {
  const c3Price    = DAIRY_DATA.dc?.price || (ORDER30.price - ORDER30.class1Diff);
  const gradeABase = c3Price + ORDER30.class1Diff;
  const isGradeA   = dairyGradeMode === 'A';
  const basePrice  = isGradeA ? gradeABase : c3Price;
  const gradeLabel = isGradeA ? 'Grade A (Class 1)' : 'Grade B (Class 3)';
  const days       = dairyHistRange;
  const labs       = genLabels(days);

  // Update plant badge
  const badge = document.getElementById('dairy-chart-plant-badge');
  if(badge) {
    const p = selectedDairyPlant ? DAIRY_PLANTS[selectedDairyPlant] : null;
    badge.textContent = p ? p.name : 'No plant selected — showing market';
  }

  // Update dynamic labels
  const mainTitle = document.getElementById('dairy-main-title');
  if(mainTitle) mainTitle.textContent = `${gradeLabel} Mailbox — Your Plant vs Others ($/cwt)`;
  const premTitle = document.getElementById('dairy-prem-title');
  if(premTitle) premTitle.textContent = `Your Plant Premium Over ${gradeLabel} ($/cwt)`;
  const premSub = document.getElementById('dairy-prem-sub');
  if(premSub) premSub.textContent = `Rolling 13 months · monthly · shaded band = premium vs ${gradeLabel} base`;
  const legendBase = document.getElementById('dairy-legend-base');
  if(legendBase) legendBase.textContent = isGradeA ? 'Grade A base' : 'Grade B base';

  // ── Generate base history directly from basePrice (no Grade B derivation)
  const baseHist = genHistory(basePrice, days, 0.008);

  const plantKeys = Object.keys(DAIRY_PLANTS);
  const myKey     = selectedDairyPlant || plantKeys[0];
  const myPlant   = DAIRY_PLANTS[myKey];
  const myMailboxHist = baseHist.map(v => parseFloat((v + myPlant.premium).toFixed(2)));

  // Other plants — faint lines (all relative to same base)
  const otherDatasets = plantKeys
    .filter(k => k !== myKey)
    .map(k => {
      const op = DAIRY_PLANTS[k];
      return {
        label: op.name,
        data: baseHist.map(v => parseFloat((v + op.premium).toFixed(2))),
        borderColor: 'rgba(74,159,212,0.18)',
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        hitRadius: 0,
      };
    });

  // ── MAIN CHART — Your mailbox (bold) + other plants (faint) + selected grade base (dashed)
  if(charts['dairy-hist-main']) charts['dairy-hist-main'].destroy();
  const mainCtx = document.getElementById('dairy-hist-main');
  if(mainCtx) {
    charts['dairy-hist-main'] = new Chart(mainCtx, {
      type: 'line',
      data: {
        labels: labs,
        datasets: [
          // Grade base — dashed reference line
          {
            label: gradeLabel + ' base',
            data: baseHist,
            borderColor: 'rgba(200,200,200,0.35)',
            borderWidth: 1.5,
            borderDash: [4,4],
            fill: false,
            pointRadius: 0,
          },
          // Other plants — faint
          ...otherDatasets,
          // Shaded band fill between grade base and my mailbox
          {
            label: 'Premium band',
            data: myMailboxHist,
            borderColor: 'transparent',
            backgroundColor: 'rgba(74,159,212,0.08)',
            fill: '-' + (otherDatasets.length + 1), // fill down to base dataset
            pointRadius: 0,
            hitRadius: 0,
          },
          // My plant — bold primary
          {
            label: myPlant.name,
            data: myMailboxHist,
            borderColor: '#4a9fd4',
            borderWidth: 2.5,
            fill: false,
            pointRadius: 0,
            hitRadius: 12,
          },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: {
              label: c => {
                if(c.dataset.label === 'Premium band') return null;
                return c.dataset.label + ': $' + c.raw.toFixed(2) + '/cwt';
              }
            }
          }
        },
        scales: {
          x: { ticks: { color:'#5e6369', font:{size:11}, maxTicksLimit:8, maxRotation:0 }, grid:{color:'#252a31'} },
          y: { ticks: { color:'#5e6369', font:{size:11}, callback: v=>'$'+v.toFixed(2) }, grid:{color:'#252a31'} }
        },
        elements: { point:{radius:0,hitRadius:12}, line:{tension:0.3} }
      }
    });
  }

  // ── PREMIUM BAND CHART — Rolling 13 months, monthly x-axis, independent of range selector
  const premMonthLabels = genMonthlyLabels(13);
  const premMonthData   = genMonthlyHistory(myPlant.premium, 13, 0.04);
  if(charts['dairy-hist-premium']) charts['dairy-hist-premium'].destroy();
  const premCtx = document.getElementById('dairy-hist-premium');
  if(premCtx) {
    charts['dairy-hist-premium'] = new Chart(premCtx, {
      type: 'line',
      data: {
        labels: premMonthLabels,
        datasets: [{
          label: 'Your Plant Premium',
          data: premMonthData,
          borderColor: '#4a9fd4',
          borderWidth: 2,
          backgroundColor: 'rgba(74,159,212,0.10)',
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#4a9fd4',
          hitRadius: 12,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode:'index', intersect:false, callbacks:{ label: c=>'Premium over '+gradeLabel+': $'+c.raw.toFixed(3)+'/cwt' } }
        },
        scales: {
          x: { ticks:{color:'#5e6369',font:{size:11},maxRotation:0}, grid:{color:'#252a31'} },
          y: { ticks:{color:'#5e6369',font:{size:11},callback:v=>'$'+v.toFixed(3)}, grid:{color:'#252a31'} }
        },
        elements: { line:{tension:0.3} }
      }
    });
  }

  // ── SEASONAL CHART — MN Grade A monthly pattern
  if(charts['dairy-seasonal']) charts['dairy-seasonal'].destroy();
  const seasCtx = document.getElementById('dairy-seasonal');
  if(seasCtx) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const curMonth = new Date().getMonth();
    const colors = DAIRY_SEASONAL.map((v,i) =>
      i === curMonth ? '#4a9fd4'
      : v >= 0 ? 'rgba(60,185,106,0.55)'
      : 'rgba(224,80,80,0.50)'
    );
    charts['dairy-seasonal'] = new Chart(seasCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{ data: DAIRY_SEASONAL, backgroundColor: colors, borderRadius: 3 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => (c.raw>=0?'+':'')+c.raw+'% vs annual avg' } }
        },
        scales: {
          x: { ticks:{color:'#5e6369',font:{size:11}}, grid:{display:false} },
          y: { ticks:{color:'#5e6369',font:{size:11},callback:v=>(v>=0?'+':'')+v+'%'}, grid:{color:'#252a31'} }
        }
      }
    });
  }
}

// ── DAIRY MARGIN CALC ─────────────────────────────────────────────────────────
function syncDMCField(id,val,prefix,dec) {
  const v=parseFloat(val)||0;
  const slider=document.getElementById(id), num=document.getElementById(id+'-n'), disp=document.getElementById(id+'-val');
  if(slider)slider.value=v; if(num)num.value=v;
  if(disp)disp.textContent=(prefix||'')+(dec===0?Math.round(v):v.toFixed(dec));
  if(id==='dmc-mp'&&slider)slider._touched=true;
}

function calcDairy() {
  const mp   = parseFloat(document.getElementById('dmc-mp')?.value)||18;   // $/cwt milk price
  const prod = parseFloat(document.getElementById('dmc-prod')?.value)||75;  // lbs/cow/day
  const corn = parseFloat(document.getElementById('dmc-corn')?.value)||0.20;// bu/cow/day
  const hay  = parseFloat(document.getElementById('dmc-hay')?.value)||30;   // lb/cow/day
  const sbm  = parseFloat(document.getElementById('dmc-sbm')?.value)||4;    // lb/cow/day
  const other= parseFloat(document.getElementById('dmc-other')?.value)||1.0;// $/cow/day
  const cows = parseFloat(document.getElementById('dmc-cows')?.value)||100;

  // Feed costs using live prices where available, else fallback
  const cornPx  = GRAIN_DATA?.cn?.price || 4.35;           // $/bu
  const sbmPx   = parseFloat(document.getElementById('p-sbm')?.textContent)||330; // $/ton
  const hayPx   = parseFloat(document.getElementById('p-hay')?.textContent)||210;  // $/ton

  const cornCost  = corn * cornPx;                   // $/cow/day
  const hayCost   = (hay / 2000) * hayPx;            // $/cow/day (lb→ton)
  const sbmCost   = (sbm / 2000) * sbmPx;            // $/cow/day (lb→ton)
  const feedTotal = cornCost + hayCost + sbmCost + other;
  const rev       = (prod / 100) * mp;               // $/cow/day (cwt = 100lbs)
  const margin    = rev - feedTotal;                  // $/cow/day
  const marginCwt = (prod>0) ? (margin / (prod/100)) : 0;
  const be        = (prod>0) ? (feedTotal / (prod/100)) : 0;

  function fmt(v,d=2){return(v<0?'-$':'$')+Math.abs(v).toFixed(d);}
  function setEl(id,txt,color){const el=document.getElementById(id);if(el){el.textContent=txt;if(color)el.style.color=color;}}

  setEl('dmc-r-corn',  fmt(cornCost)+'/day');
  setEl('dmc-r-hay',   fmt(hayCost)+'/day');
  setEl('dmc-r-sbm',   fmt(sbmCost)+'/day');
  setEl('dmc-r-other', fmt(other)+'/day');
  setEl('dmc-r-feedtotal', fmt(feedTotal)+'/day', 'var(--down)');
  setEl('dmc-r-rev',   fmt(rev)+'/day', 'var(--dairy)');
  setEl('dmc-r-margin',fmt(margin)+'/day', margin>=0?'var(--up)':'var(--down)');
  setEl('dmc-r-margin-cwt', fmt(marginCwt)+'/cwt', margin>=0?'var(--up)':'var(--down)');
  setEl('dmc-r-be',    fmt(be)+'/cwt');

  const mRow=document.getElementById('dmc-margin-row');
  if(mRow)mRow.style.background=margin>=0?'rgba(60,185,106,.06)':'rgba(224,80,80,.06)';

  // Full herd
  const dayHerd=margin*cows, moHerd=dayHerd*30, yrHerd=dayHerd*365, annualMilk=prod*cows*365;
  function fmtK(v){return(v<0?'-$':'$')+Math.abs(v>=1000?Math.round(v/1000)+'k':Math.round(v));}
  setEl('dmc-herd-day',  fmtK(dayHerd), dayHerd>=0?'var(--up)':'var(--down)');
  setEl('dmc-herd-mo',   fmtK(moHerd),  moHerd>=0?'var(--up)':'var(--down)');
  setEl('dmc-herd-yr',   fmtK(yrHerd),  yrHerd>=0?'var(--up)':'var(--down)');
  setEl('dmc-herd-milk', Math.round(annualMilk/1000)+'k lbs');

  // Verdict
  const v=document.getElementById('dmc-verdict');
  if(v){
    if(margin>=3)       {v.textContent='Strong margin — well above feed costs.';v.className='verdict up';}
    else if(margin>=1)  {v.textContent='Positive margin — covering feed costs with room.';v.className='verdict up';}
    else if(margin>=0)  {v.textContent='Tight margin — covering feed but little cushion.';v.className='verdict neutral';}
    else if(marginCwt>=-2){v.textContent='Margin negative — review feed efficiency or forward price milk.';v.className='verdict down';}
    else                {v.textContent='Margin well below feed cost — consider DMC coverage level.';v.className='verdict down';}
  }
}
