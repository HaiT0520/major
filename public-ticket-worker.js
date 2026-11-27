"use strict";

const directory = "data/tickets/";
const popcount = new Uint8Array(65536);
for(let i=1; i<popcount.length; i++) popcount[i]=popcount[i>>1]+(i&1);

async function addBlock(name, masks, hist) {
  if (!/^[a-f0-9]{32}\.gz$/.test(name)) throw Error("样本清单损坏");
  const response=await fetch(directory+name);
  if(!response.ok) throw Error("当前样本下载失败，请重试");
  let bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===31 && bytes[1]===139) {
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const n=data.getUint32(0,true);
  if(bytes.length!==4+10*n) throw Error("样本块长度异常");
  let perfect=0, ordinary=0, winless=0;
  for(let i=0;i<n;i++) {
    const offset=4+2*i;
    perfect=(perfect+data.getUint16(offset,true))&65535;
    ordinary=(ordinary+data.getUint16(offset+2*n,true))&65535;
    winless=(winless+data.getUint16(offset+4*n,true))&65535;
    const hits=popcount[perfect&masks[0]]+popcount[ordinary&masks[1]]+popcount[winless&masks[2]];
    hist[hits]+=data.getUint32(4+6*n+4*i,true);
  }
}

function summarize(key, groups, settled) {
  const hitCounts=Array(11).fill(0);
  const hitProbabilities=Array(11).fill(0);
  const total=groups.reduce((sum,g)=>sum+g.hist.reduce((a,b)=>a+b,0),0);
  const weights=groups.map(g=>Number.isFinite(g.weight)?g.weight:g.hist.reduce((a,b)=>a+b,0)/total);
  const weightTotal=weights.reduce((a,b)=>a+b,0);
  if(!(weightTotal>0))throw Error("样本权重异常");
  let samples=0, passed=0, weightedHits=0, low=0, high=0;
  for(const [index,{hist}] of groups.entries()) {
    const n=hist.reduce((a,b)=>a+b,0), wins=hist.slice(5).reduce((a,b)=>a+b,0);
    if(!(n>0) || !(weights[index]>0))throw Error("样本数量或权重异常");
    const weight=weights[index]/weightTotal;
    const q=wins/n, z=1.959963984540054, d=1+z*z/n;
    const center=(q+z*z/(2*n))/d, half=z*Math.sqrt(q*(1-q)/n+z*z/(4*n*n))/d;
    low+=(weight*(q-center+half))**2;
    high+=(weight*(center+half-q))**2;
    samples+=n;
    passed+=weight*q;
    hist.forEach((v,i)=>{hitCounts[i]+=v;hitProbabilities[i]+=weight*v/n;weightedHits+=weight*i*v/n;});
  }
  const p=passed;
  return {snapshotKey:key,samples,hitCounts,expectedHits:weightedHits,
    passProbability:p,hitProbabilities,
    kind:settled?"settled":"forecast", interval95:settled?[p,p]:
    [Math.max(0,p-Math.sqrt(low)),Math.min(1,p+Math.sqrt(high))]};
}

async function score({key,teams,card,settled}) {
  const ordered=[...teams].sort((a,b)=>a.seed-b.seed);
  const buckets=[card.perfect,card.ordinary,card.winless];
  if(ordered.length!==16 || buckets.some((g,i)=>!Array.isArray(g) || g.length!==[2,6,2][i])
     || new Set(buckets.flat()).size!==10) throw Error("请完整填写十格且队伍不重复");
  const ids=ordered.map(t=>t.id);
  const masks=buckets.map(g=>g.reduce((m,id)=>{
    const i=ids.indexOf(id);
    if(i<0) throw Error("该队伍未参加当前阶段");
    return m|(1<<i);
  },0));
  if(settled) {
    let hits=0;
    for(let i=0;i<16;i++) {
      const {wins,losses}=ordered[i];
      const group=wins===3?(losses===0?0:1):wins===0&&losses===3?2:-1;
      if(group>=0 && (masks[group]&(1<<i))) hits++;
    }
    const hist=Array(11).fill(0); hist[hits]=1;
    return summarize(key,[{hist,weight:1}],true);
  }
  const response=await fetch(directory+"index.json?snapshot="+encodeURIComponent(key),{cache:"no-cache"});
  if(!response.ok) throw Error("竞猜样本暂未同步");
  const entry=(await response.json())[key];
  if(!entry || JSON.stringify(entry.teams)!==JSON.stringify(ids)) throw Error("该阶段样本尚未同步");
  if(entry.groups.reduce((sum,g)=>sum+g.samples,0)>200000)throw Error("轻量查询样本正在同步，请稍后重试");
  const groups=[];
  for(const group of entry.groups) {
    const hist=Array(11).fill(0);
    // Bound temporary decoding memory while overlapping CDN round trips.
    for(let i=0;i<group.blocks.length;i+=3) {
      await Promise.all(group.blocks.slice(i,i+3).map(block=>addBlock(block,masks,hist)));
    }
    if(hist.reduce((a,b)=>a+b,0)!==group.samples) throw Error("样本数量与快照不符");
    groups.push({hist,weight:group.weight});
  }
  return {...summarize(key,groups,false),approximate:entry.approximate===true,
    sourceSamples:entry.sourceSamples||entry.samples,sampling:entry.sampling};
}
self.onmessage=async({data})=>{
  try { self.postMessage({result:await score(data)}); }
  catch(e) { self.postMessage({error:e.message||"查询失败，请重试"}); }
};
