"use strict";
const RoundOdds = (() => {
  // Frozen CT-round rates from live/roundscore/roundscore.py, including its pooled fallback.
  const ctRates = {ancient:0.5068033324773887, anubis:0.5162842810840497, cache:0.44802033731795204,
    dust2:0.512176303781434, inferno:0.534446764091858, mirage:0.5254686448844524,
    nuke:0.5068862292015958, other:0.5087347803070408};
  const calibrations = new Map();

  // Distribution of round wins for two stretches with different per-round probabilities.
  function distribution(n, p, m, q) {
    const mass = new Float64Array(n+m+1);
    mass[0]=1;
    for (let i=0;i<n+m;i++) {
      const chance=i<n?p:q;
      for(let k=i+1;k>=1;k--) mass[k]=mass[k]*(1-chance)+mass[k-1]*chance;
      mass[0]*=1-chance;
    }
    return mass;
  }
  function block(a,b,early,late,half,ot) {
    const first=Math.max(0,half-a-b);
    const mass=distribution(first,early,2*half-a-b-first,late);
    const tied=half-a;
    let win=mass[tied]*ot;
    for(let k=tied+1;k<mass.length;k++) win+=mass[k];
    return win;
  }
  function calibrate(prior,ct) {
    const key=prior+"/"+ct;
    if(calibrations.has(key)) return calibrations.get(key);
    const bias=Math.log(ct/(1-ct));
    let lo=-15,hi=15,rates;
    for(let i=0;i<50;i++) {
      const z=(lo+hi)/2, p=1/(1+Math.exp(-z-bias)), q=1/(1+Math.exp(-z+bias));
      const overtime=distribution(3,p,3,q);
      const ot=(overtime[4]+overtime[5]+overtime[6])/(1-overtime[3]);
      rates={p,q,ot};
      if(block(0,0,p,q,12,ot)<prior)lo=z;else hi=z;
    }
    if(calibrations.size>=512)calibrations.delete(calibrations.keys().next().value);
    calibrations.set(key,rates);
    return rates;
  }
  function roundState(scoreA,scoreB) {
    if(![scoreA,scoreB].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
    let a=scoreA,b=scoreB,half=12,switched=false;
    if(Math.min(a,b)>=12) {
      const blocks=Math.floor((Math.min(a,b)-12)/3), offset=12+3*blocks;
      a-=offset;b-=offset;half=3;switched=blocks%2===0;
    }
    if(Math.max(a,b)>half+1 || Math.max(a,b)===half+1 && Math.min(a,b)>=half)return null;
    return {a,b,half,switched,finished:Math.max(a,b)===half+1};
  }
  function mapProbability(prior,scoreA,scoreB,mapName) {
    const state=roundState(scoreA,scoreB);
    if(!state || !(prior>0 && prior<1))return null;
    const {a,b,half,switched,finished}=state;
    if(finished)return Number(a>b);
    if(half===12 && a+b===0)return prior;
    const name=String(mapName||"").toLowerCase().replace(/^de_/,"").replace("dust ii","dust2");
    const {p,q,ot}=calibrate(prior,Object.hasOwn(ctRates,name)?ctRates[name]:ctRates.other);
    const first=Math.min(half,a+b);
    let weighted=0,total=0;
    for(const startsCT of [true,false]){
      const [early,late]=startsCT!==switched?[p,q]:[q,p];
      const evidence=distribution(first,early,a+b-first,late)[a];
      total+=evidence;weighted+=evidence*block(a,b,early,late,half,ot);
    }
    return weighted/total;
  }
  function seriesTail(w,l,target,q) {
    if(w===target || l===target)return Number(w===target);
    return q*seriesTail(w+1,l,target,q)+(1-q)*seriesTail(w,l+1,target,q);
  }
  function mapPrior(prior,target) {
    if(target===1)return prior;
    let lo=0,hi=1;
    for(let i=0;i<50;i++){
      const q=(lo+hi)/2;
      if(seriesTail(0,0,target,q)<prior)lo=q;else hi=q;
    }
    return (lo+hi)/2;
  }
  // Map slots are one-based in the PGL feed. Keep their numbers even when an entry is missing.
  function live(match) {
    const {prePA,bo}=match;
    if(![1,3,5].includes(bo) || !(prePA>0 && prePA<1))return null;
    const needed=Math.ceil(bo/2);
    const w=bo===1?0:match.scoreA, l=bo===1?0:match.scoreB;
    if(![w,l].every(n=>Number.isInteger(n)&&n>=0&&n<needed))return null;
    const maps=match.maps||[], current=w+l+1;
    let entry=null, won=0,lost=0, consistent=true;
    for(let i=0;i<maps.length;i++) {
      const m=maps[i], slot=m.number??i+1;
      if(slot===current){entry=m;continue;}
      if(!(m.scoreA || m.scoreB))continue;
      const state=roundState(m.scoreA,m.scoreB);
      if(slot>current || !state?.finished){consistent=false;continue;}
      if(m.scoreA>m.scoreB)won++;else lost++;
    }
    if(!consistent || won>w || lost>l)entry=null;
    const q=mapPrior(prePA,needed);
    let mp=entry?mapProbability(q,entry.scoreA,entry.scoreB,entry.map):null;
    if(mp===null){
      if(bo===1 || w+l===0)return null;
      return {livePA:seriesTail(w,l,needed,q),liveKind:"series_maps",map:null,mapScoreA:null,mapScoreB:null};
    }
    return {livePA:mp*seriesTail(w+1,l,needed,q)+(1-mp)*seriesTail(w,l+1,needed,q),
      liveKind:"rounds",map:entry.map,mapScoreA:entry.scoreA,mapScoreB:entry.scoreB};
  }
  return {live,mapProbability,roundState,ctRates};
})();
