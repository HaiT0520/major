"use strict";
const $ = (selector, root=document) => root.querySelector(selector);
const el = (id) => document.getElementById(id);
const views = ["schedule", "swiss", "simulator", "teams", "picks"];
const metrics = Phases.metricSet;
const state = {phase:Phases.fromURL(),stageOne:null,data:null,latest:null,selection:"",day:1,group:null,rank:"pAdvance",ascending:false,pairLimit:10};
const escaped = (v) => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pct = (v,n=1) => Number.isFinite(v) ? (v*100).toFixed(n)+"%" : "—";
const name = (id) => state.data.teams.find(t=>t.id===id)?.short || id || "待定";
const dateFmt = (s,options) => s? new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hourCycle:"h23",...options}).format(new Date(s)):"—";
const clock = (s) => dateFmt(s,{hour:"2-digit",minute:"2-digit"});
const stamp = (s) => dateFmt(s,{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const safeURL = (v) => {try{const u=new URL(v);return /^https?:$/.test(u.protocol)?escaped(u.href):"#";}catch{return "#";}};
const logo = (id) => id ? '<img class="logo" alt="" src="assets/'+encodeURIComponent(id)+'.webp">' : "";
const heading = (title,extra="") => '<div class="section-head"><div class="title-wrap"><i class="accent-dash"></i><h2>'+title+'</h2></div>'+extra+'</div>';
const linkSource=(u,title)=>'<a href="'+safeURL(u)+'" target="_blank" rel="noopener noreferrer">'+escaped(title)+'</a>';
const modelNote=d=>escaped((d.modelNote||"").replace('进行中小分仅供查看','竞猜概率根据已完赛赛果重算，实时单场胜率另随局分更新'));
const rounds=["","第一轮","第二轮","第三轮","第四轮","第五轮"];
const groups=[[[0,0]],[[1,0],[0,1]],[[2,0],[1,1],[0,2]],[[2,1],[1,2]],[[2,2]]];
const statusNames={finished:"已结束",live:"进行中",upcoming:"未开始"};
let requestId=0, retryTimer=null;

function showDialog(title,html){
  liveView.trackDialog(null);
  el("dialog-title").textContent=title;el("dialog-body").innerHTML=html;
  if(!el("dialog").open) el("dialog").showModal();
}
function info(){
  const d=state.data;
  showDialog("数据与来源",'<p>北京时间显示赛程。'+(state.phase===4?'八强单败淘汰，决赛 BO5。':state.phase===3?'第三阶段全程 BO3，三胜晋级、三负淘汰。':'本阶段有 16 队，三胜晋级，三负淘汰。决定晋级或淘汰的场次采用 BO3。')+'</p><p>页面自动检查最新发布的数据。已归档的胜率取自对应时点，比赛详情可查看比分和来源。</p>'+
    (d?'<p>'+modelNote(d)+'</p><p>'+d.sources.map(s=>linkSource(s.url,s.label)).join(' · ')+'</p>':'')+
    '<p>流程模拟的视图和交互参考 '+linkSource('https://majors.im/2026/singapore','Majors.im 的新加坡 Major 模拟器')+'。第一阶段队徽来自 BO3.gg，其余队徽来自 PGL。</p>'+
    '<p>封面摄影：Ralff Nestor Nacor，'+linkSource('https://commons.wikimedia.org/wiki/File:Merlion_%26_Marina_Bay_Sands,_Singapore_at_Night.jpg','滨海湾夜景')+'，'+linkSource('https://creativecommons.org/licenses/by-sa/4.0/','CC BY-SA 4.0')+'。页面作裁切与色彩叠加。</p>');
}
function teamDialog(id){
  const t=state.data.teams.find(v=>v.id===id);if(!t)return;
  const games=state.data.matches.map(liveView.match);
  const played=games.filter(m=>m.a===id||m.b===id), record=liveView.standings(games).get(id);
  const stats=Object.entries(metrics()).filter(([key])=>key!=="pOrdinary").map(([key,label])=>[label,t[key]]);
  showDialog(t.name,'<p>'+(t.seed?'种子 #'+t.seed+'　·　':'')+'当前战绩 '+record.wins+'–'+record.losses+'</p><div class="stats">'+stats.map(([k,v])=>'<div><span>'+k+'</span><strong>'+pct(v)+'</strong></div>').join("")+'</div><h3>已公布对阵</h3>'+
    (played.length?played.map(m=>'<p>'+Phases.formatRound(m)+'　'+escaped(name(m.a))+' '+(m.scoreA==null?'vs':m.scoreA+'–'+m.scoreB)+' '+escaped(name(m.b))+'　<small>'+statusNames[m.status]+'</small></p>').join(""):'<p>等待公布。</p>'));
  liveView.trackTeam(id);
}
function matchDialog(id){
  const raw=state.data.matches.find(x=>String(x.id)===String(id));if(!raw)return;
  const m=liveView.match(raw);
  const known=m.a&&m.b;
  const mapLines=(m.maps||[]).map(x=>'<p>'+escaped(x.map)+(x.scoreA!=null?'　'+x.scoreA+'–'+x.scoreB:'')+'</p>').join("");
  showDialog(name(m.a)+" vs "+name(m.b),'<p>'+Phases.formatRound(m)+' · BO'+m.bo+' · '+stamp(m.startAt)+'　'+statusNames[m.status]+'</p>'+
    (m.winner?'<p><b>'+escaped(name(m.winner))+' 获胜</b></p>':'')+
    (mapLines|| (m.map?'<p>'+escaped(m.map)+'</p>':''))+
    (m.scoreAt?'<p>局分采集于 '+stamp(m.scoreAt)+'。</p>':'')+
    (known?'<div class="dialog-odds"><div class="dialog-opponents"><b>'+escaped(name(m.a))+'</b><b>'+escaped(name(m.b))+'</b></div>'+liveView.lines(m,true)+'</div>':state.phase===4?'<p>等待八强签位或前序比赛结果确定参赛队。</p>':'<p>对阵时段待公布。瑞士轮页可查看已确定的配对和可能的交手组合。</p>')+
    (m.status!=="upcoming"&&m.preAt?'<p>'+(m.preKind==="prestage"?'赛前预测采用阶段开赛前的基线':m.preKind==="conditional"?'赛前预测取此前快照中两队交手的条件胜率':'赛前预测归档')+' · '+stamp(m.preAt)+'。</p>':'')+
    (m.status==="live"?'<p>'+(m.liveKind==="series_maps"?'当前系列赛胜率按已打完的地图估计，等待下一张图的有效局分。':'实时胜率按已取得的比分估计，数据源可能有延迟。')+'</p>':'')+
    ((m.scoreSource||m.source)?'<p>'+linkSource(m.scoreSource||m.source,'查看赛况来源 ↗')+'</p>':''));
  liveView.trackDialog(id);
}
function track(p){return '<span class="track" aria-hidden="true"><i style="width:'+Math.min(100,Math.max(0,100*(p||0)))+'%"></i></span>';}
function matchRow(m){
  const hasScore=m.scoreA!=null&&m.scoreB!=null;
  const aWon=m.winner===m.a,bWon=m.winner===m.b;
  const score=hasScore?'<span class="'+(bWon?"loser":"winner")+'">'+m.scoreA+'</span><span class="score-sep">:</span><span class="'+(aWon?"loser":"winner")+'">'+m.scoreB+'</span>':'<span class="versus">'+(m.status==="finished"?'待确认比分':'VS')+'</span>';
  const tag=m.a&&m.b?statusNames[m.status]:"待配对";
  const mapScore=m.status==="live" && m.bo>1 && m.mapScoreA!=null && m.mapScoreB!=null?' '+m.mapScoreA+'–'+m.mapScoreB:'';
  return '<button class="match" type="button" data-match="'+escaped(m.id)+'"><span class="kick">'+clock(m.startAt)+'<small>BO'+m.bo+'</small></span><span class="op left"><label>'+escaped(name(m.a))+'</label>'+logo(m.a)+'</span><span class="result">'+score+(m.map?'<small>'+escaped(m.map)+mapScore+'</small>':'')+'</span><span class="op">'+logo(m.b)+'<label>'+escaped(name(m.b))+'</label></span><span class="state '+(m.status==='live'?'live':m.status==='finished'?'':'fut')+'">'+tag+'</span>'+liveView.lines(m)+(m.status==='live' && m.scoreStale && m.scoreAt?'<small class="stale-score">最近局分 '+clock(m.scoreAt)+' · 等待更新</small>':'')+'</button>';
}
function rankBox(){
  if(!Phases.available(state.data))return Phases.field(state.data);
  const rows=[...state.data.teams].sort((a,b)=>b[state.rank]-a[state.rank]||a.seed-b.seed).slice(0,8);
  return '<section class="panel rankbox">'+heading("队伍概率",'<span class="eyebrow">TOP 08</span>')+
    '<div class="rank-tools"><div class="segment">'+Object.keys(metrics()).filter(k=>k!=="pOrdinary").map(k=>'<button type="button" data-metric="'+k+'" class="'+(state.rank===k?'on':'')+'" aria-pressed="'+(state.rank===k)+'">'+metrics()[k]+'</button>').join("")+'</div><span class="eyebrow">概率</span></div>'+
    '<div class="rank-list">'+rows.map((t,i)=>'<button class="rank-row" data-team="'+escaped(t.id)+'"><em>'+String(i+1).padStart(2,"0")+'</em>'+logo(t.id)+'<strong>'+escaped(t.short)+'</strong>'+track(t[state.rank])+'<span class="pct">'+pct(t[state.rank])+'</span></button>').join("")+'</div><a class="rank-footer" href="#teams"><span>查看全部队伍</span><span>→</span></a></section>';
}
function schedule(){
  const d=state.data,day=d.days.find(x=>x.day===state.day)||d.days[0];
  if(!day)return '<div class="layout">'+Phases.empty("比赛日程",d.matches.length?"赛程时间待公布。":Phases.note(d))+'<aside>'+rankBox()+'</aside></div>';
  const games=d.matches.filter(m=>m.day===day.day).map(liveView.match);
  const tabs=d.days.map((t,i)=>'<button class="date-tab '+(t.day===day.day?'on':'')+'" aria-pressed="'+(t.day===day.day)+'" data-day="'+t.day+'"><strong>'+t.date.slice(5).replace("-",".")+'</strong><span>'+dateFmt(t.date+"T12:00:00+08:00",{weekday:"long"})+'</span></button>').join("");
  const rows=day.rounds.map(r=>'<div class="round-head"><span>'+(state.phase===4?["","四分之一决赛","半决赛","决赛日"][r]||"淘汰赛":rounds[r])+'</span><small>ROUND '+String(r).padStart(2,"0")+'</small></div>'+games.filter(m=>m.round===r).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt)).map(matchRow).join("")).join("");
  const pick=d.pickem;
  return '<div class="layout"><section class="panel">'+heading("比赛日程",'<span class="schedule-meta">已结束 '+games.filter(m=>m.status==="finished").length+' / '+day.total+' 场</span>')+'<div class="date-tabs" aria-label="选择比赛日">'+tabs+'</div>'+Phases.pairedWaiting(d,day)+rows+'<p class="schedule-foot">胜率按左、右队顺序显示。点击比赛可查看地图、比分与预测时间。</p></section><aside class="aside">'+rankBox()+
    '<section class="panel mini-card"><div><h3>阶段竞猜</h3><p>'+(!pick?(state.phase===4?"整条签表全中":"预计过关率"):pick.kind==="settled"?'赛前推荐最终命中':'至少命中五格')+'</p></div><div><div class="value">'+(!pick?(state.phase===4&&d.brackets?.length?pct(d.brackets[0].probability):"待公布"):pick.kind==="settled"?escaped(pick.hits)+'/10':pct(pick.passProbability))+'</div><a href="#picks">查看竞猜单 →</a></div></section><div class="aside-note">'+modelNote(d)+'</div></aside></div>';
}
function swiss(){
  const d=state.data;
  if(state.phase===4)return Phases.playoffDraw(d);
  const games=d.matches.map(liveView.match);
  if(!state.group){
    const pending=games.find(m=>m.status!=="finished"&&m.a&&m.b);
    const prior=pending && liveView.standings(games.filter(m=>m.round<pending.round)).get(pending.a);
    state.group=pending?[pending.round,pending.wins??prior.wins,pending.losses??prior.losses]:[1,0,0];
  }
  const [r,w,l]=state.group;
  const columns=groups.map((group,i)=>{
    const round=i+1, selected=round===r;
    const roundTitle='第 <span class="path-round-num">'+String(round).padStart(2,"0")+'</span> 轮';
    const tiles=group.map(([wins,loss])=>{
      const active=selected&&wins===w&&loss===l;
      const kind=wins===2&&loss===2?"决胜战":wins===2?"晋级战":loss===2?"淘汰战":"常规赛";
      return '<button type="button" class="path-group" data-group="'+[round,wins,loss].join(",")+'" aria-pressed="'+active+'" aria-label="'+rounds[round]+'，'+wins+' 胜 '+loss+' 负，'+kind+'"><strong>'+wins+'–'+loss+'</strong><span>'+kind+'<small>BO'+(state.phase===3||wins===2||loss===2?3:1)+'</small></span></button>';
    }).join("");
    return '<section class="path-round'+(selected?' is-selected':'')+'"><h3 class="path-round-name">'+roundTitle+'</h3><button type="button" class="path-round-tab" data-group="'+[round,...(selected?[w,l]:group[0])].join(",")+'" aria-pressed="'+selected+'">'+rounds[round]+'</button><div class="path-groups">'+tiles+'</div></section>';
  }).join("");
  const before=liveView.standings(games.filter(m=>m.round<r));
  const official=games.filter(m=>m.a&&m.b && m.round===r && (m.wins??before.get(m.a).wins)===w && (m.losses??before.get(m.a).losses)===l);
  const paired=new Set(official.map(m=>[m.a,m.b].sort().join("|")));
  const deduced=d.potential.filter(p=>p.round===r&&p.wins===w&&p.losses===l&&p.locked&&!paired.has([p.a,p.b].sort().join("|")));
  const assigned=new Set(official.flatMap(m=>[m.a,m.b]));
  const possible=d.potential.filter(p=>p.round===r&&p.wins===w&&p.losses===l&&!p.locked&&!assigned.has(p.a)&&!assigned.has(p.b)).sort((a,b)=>b.pMeet-a.pMeet);
  const team=id=>'<span class="path-team">'+logo(id)+'<b>'+escaped(name(id))+'</b></span>';
  function pairCard(p){
    const left=escaped(name(p.a)), right=escaped(name(p.b));
    const rightOdds=Number.isFinite(p.pA)?pct(1-p.pA):"—";
    return '<article class="path-pair"><div class="path-pair-names">'+team(p.a)+'<i>vs</i>'+team(p.b)+'</div>'+
      (p.locked?'':'<div class="path-meet"><span>交手机率</span><b>'+pct(p.pMeet)+'</b></div>')+
      '<div class="path-odds" aria-label="'+left+' 胜率 '+pct(p.pA)+'，'+right+' 胜率 '+rightOdds+'"><b>'+pct(p.pA)+'</b><span>交手胜率</span><b>'+rightOdds+'</b></div></article>';
  }
  function block(title,items,kind){
    return items.length?'<section class="path-block"><h4>'+title+'</h4><div class="'+kind+'">'+items.join("")+'</div></section>':"";
  }
  return '<div class="swiss-path"><section class="panel path-selector">'+heading("瑞士轮路径",'<a class="path-sim-link" href="#simulator">手动推演赛果 <span aria-hidden="true">↗</span></a>')+'<div class="path-rounds" aria-label="选择轮次及战绩组">'+columns+'</div></section>'+
    '<section class="panel path-matches"><header class="path-detail-head"><b>'+w+'–'+l+'</b><h3>'+rounds[r]+'战绩组</h3></header>'+
    block("已公布对阵",official.map(matchRow),"path-fixtures")+
    block("已确定配对 · 排期待公布",deduced.map(pairCard),"path-pairs")+
    block("可能交手",possible.slice(0,state.pairLimit).map(pairCard),"path-pairs")+
    (!official.length&&!deduced.length&&!possible.length?'<p class="path-empty">当前快照尚无该组的对阵预测。</p>':'')+
    (possible.length>state.pairLimit?'<button class="path-more" data-more>显示更多交手组合（共 '+possible.length+' 组） ↓</button>':'')+'</section></div>';
}
function teams(){
  if(!Phases.available(state.data))return Phases.field(state.data);
  const records=liveView.standings(state.data.matches.map(liveView.match));
  const rows=state.data.teams.map(t=>({...t,...records.get(t.id)})).sort((a,b)=>(state.ascending?1:-1)*(a[state.rank]-b[state.rank])||a.seed-b.seed);
  return '<section class="panel">'+heading("队伍概率",'<span class="eyebrow">'+rows.length+' TEAMS</span>')+'<p class="page-note">点击表头按概率排序；点击队名查看该队的战绩和赛程。</p><div class="scroll"><table class="teamtable"><thead><tr><th>队伍</th><th>战绩</th>'+Object.entries(metrics()).map(([k,v])=>'<th><button data-sort="'+k+'" class="'+(k===state.rank?'on':'')+'">'+v+(k===state.rank?(state.ascending?' ↑':' ↓'):'')+'</button></th>').join("")+'</tr></thead><tbody>'+
    rows.map(t=>'<tr><td><button data-team="'+escaped(t.id)+'">'+logo(t.id)+escaped(t.name)+'</button></td><td>'+t.wins+'–'+t.losses+'</td>'+Object.keys(metrics()).map(k=>'<td>'+pct(t[k])+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
}
function picks(){
  const d=state.data,p=d.pickem;
  if(state.phase===4)return Phases.bracketPicks(d);
  if(!p?.perfect?.length)return Phases.empty("本阶段竞猜",Phases.note(d));
  const final=p.hits!=null;
  return '<section class="panel best-ticket">'+heading(final?"推荐单结算":"模型推荐竞猜单",'<span class="eyebrow">PICK’EM</span>')+
    '<div class="picks-top"><strong>'+(final?p.hits+'/10':pct(p.passProbability,2))+'</strong><span>'+(final?'赛前冻结推荐单实际命中':'至少命中 5 格的模型概率')+'</span></div><div class="pick-groups">'+[["perfect","3–0"],["ordinary","3–1 / 3–2"],["winless","0–3"]].map(([k,title])=>'<div class="pick-group"><h3>'+title+'</h3><div class="best-members">'+p[k].map(id=>'<button class="pick-member" data-team="'+escaped(id)+'">'+logo(id)+escaped(name(id))+'</button>').join("")+'</div></div>').join("")+'</div></section>'+Phases.picksComparison(d)+ticketEditor.html(d);
}
function render(){
  const d=state.data;if(!d)return;
  const nav=views.includes(location.hash.slice(1))?location.hash.slice(1):"schedule";
  document.querySelectorAll(".head-inner nav a").forEach(link=>{if(link.hash==="#"+nav)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");});
  const refs=state.latest?.history||[];
  el("snapshot").innerHTML='<option value="">最新快照</option>'+refs.filter(x=>x.key!==state.latest.key || x.key===state.selection).slice().reverse().map(x=>'<option value="'+escaped(x.key)+'">'+escaped(x.label)+'</option>').join("");
  el("snapshot").value=state.selection;
  el("update-time").textContent=(state.selection?"历史快照 ":"模型 ")+stamp(d.asOf);
  liveView.indicator();
  const scrolls=new Map();
  if(nav==="simulator"){
    el("view").querySelectorAll("[data-sim-stage]").forEach(a=>scrolls.set(a.dataset.simStage,a.querySelector(".sim-scroll")?.scrollLeft||0));
  }
  Phases.chrome();
  el("view").innerHTML=({schedule,swiss,teams,picks,simulator:()=>Simulator.html(state.phase===1?d:state.stageOne)})[nav]();
  if(nav==="simulator")Simulator.applyDisplay(el("view"));
  if(nav==="simulator")el("view").querySelectorAll(":not(.mode-simple) > [data-sim-stage]").forEach(a=>{
    const x=scrolls.get(a.dataset.simStage);if(x)a.querySelector(".sim-scroll")?.scrollTo(x,0);
  });
}
function use(data,reset){
  if(!data||!Array.isArray(data.matches)||!Array.isArray(data.teams)||(state.phase===1&&(data.version!==1||data.teams.length!==16)))throw Error("数据文件不完整");
  state.data=data;
  if(reset){state.day=data.day||1;state.group=null;state.pairLimit=10;}
  el("problem").hidden=true;render();liveView.onFeed();
}
// Load local files with a script tag as browsers disallow fetching sibling JSON from file URLs.
async function loadData(path){
  if(!/^data\/(?:stages\/)?[a-zA-Z0-9_-]+\.json$/.test(path))throw Error("无效快照路径");
  if(location.protocol!=="file:"){
    const res=await fetch(path,{cache:"no-store"});if(!res.ok)throw Error(String(res.status));return res.json();
  }
  return new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src=path.replace(/\.json$/,".js")+"?v="+Date.now();
    script.onload=()=>{const data=window.MAJOR_DATA;script.remove();resolve(data);};
    script.onerror=()=>{script.remove();reject(Error("无法读取快照"));};
    document.head.append(script);
  });
}
async function refresh(key=state.selection,manual=false){
  clearTimeout(retryTimer);
  const id=++requestId;
  try{
    const phase=state.phase;
    const [first,manifest]=await Promise.all([loadData("data/latest.json"),loadData("data/stages.json").catch(()=>null)]);
    if(id!==requestId)return;
    state.stageOne=first;
    const manifestChanged=manifest && Phases.timestamp()!==manifest.updatedAt;
    if(manifest)Phases.store(manifest);
    const latest=phase===1?first:Phases.get(phase);
    if(!latest)throw Error("阶段数据暂不可用");
    const newRelease=manifestChanged || latest.key!==state.latest?.key || latest.asOf!==state.latest?.asOf;
    state.latest=latest;
    if(key&&!(latest.history||[]).some(h=>h.key===key))key="";
    const raw=key?await loadData(latest.history.find(x=>x.key===key).path):latest;
    const active=phase===1?Phases.stageOneResult(raw):Phases.prepare(raw);
    if(id!==requestId)return;
    const changed=state.data?.key!==active.key || state.data?.asOf!==active.asOf;
    const reset=manual||!state.data||(!key&&changed&&state.day===state.data?.day);
    state.selection=key;
    if(changed||manual||newRelease||!state.data)use(active,reset);else {
      el("problem").hidden=true;
      if(state.phase>1)liveView.onFeed();
    }
  }catch(e){if(id===requestId){el("problem").textContent="读取快照失败。"+(state.data?"当前仍显示上一份数据。":"正在重试。");el("problem").hidden=false;
    if(!document.hidden && !state.data)retryTimer=setTimeout(()=>refresh(key,manual),3000);
  }}
}
el("info").onclick=info;el("close-dialog").onclick=()=>el("dialog").close();
el("dialog").addEventListener("click",e=>{if(e.target===el("dialog"))el("dialog").close();});
el("snapshot").onchange=e=>{
  const u=new URL(location.href);
  if(e.target.value)u.searchParams.set("snapshot",e.target.value);else u.searchParams.delete("snapshot");
  u.searchParams.delete("simSnapshot");history.replaceState(null,"",u);refresh(e.target.value,true);
};
el("view").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.team){teamDialog(b.dataset.team);return;}
  if(b.dataset.match){matchDialog(b.dataset.match);return;}
  if(b.dataset.day)state.day=Number(b.dataset.day);
  else if(b.dataset.metric){state.rank=b.dataset.metric;state.ascending=false;}
  else if(b.dataset.sort){state.ascending=b.dataset.sort===state.rank?!state.ascending:false;state.rank=b.dataset.sort;}
  else if(b.dataset.group){state.group=b.dataset.group.split(",").map(Number);state.pairLimit=10;}
  else if(b.hasAttribute("data-more"))state.pairLimit+=20;
  else return;
  render();
});
window.addEventListener("hashchange",render);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
Phases.chrome();
state.rank=state.phase===4?"pChampion":"pAdvance";
const q=new URLSearchParams(location.search);
refresh(q.get("snapshot") || (location.hash==="#simulator"?q.get("simSnapshot"):"") || "");setInterval(()=>{if(!document.hidden)refresh();},20000);
