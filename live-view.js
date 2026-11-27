"use strict";
const liveView = (() => {
  let payload=null, pending=false, timer=null, failed=false;
  let matchById=new Map(), openMatch=null, openTeam=null;
  const online=location.port==="8764" && ["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  function isCurrent() { return state.phase===1 && state.data?.kind!=="final" && state.data?.key===state.latest?.key; }
  function stageOverlay(base) {
    if(state.phase===1 || base.status==="finished")return null;
    const rows=SwissEvent.matches(state.phase,state.data,{historical:false});
    return rows.find(m=>m.bo===base.bo && m.round===base.round &&
      (base.a && base.b ? ((m.a===base.a&&m.b===base.b)||(m.a===base.b&&m.b===base.a))
        : !base.a && !base.b && m.id===base.id));
  }
  function archived(base) {
    const frozen=base.pKind==="archived" || (base.status==="upcoming" && Number.isFinite(base.pA));
    return {...base,prePA:base.prePA??(frozen?base.pA:null),preAt:base.preAt??base.forecastAsOf,
      livePA:base.livePA??(base.status==="live" && base.pKind==="in_play"?base.pA:null)};
  }
  function match(base) {
    const m=archived(base);
    const v=stageOverlay(base) || (isCurrent() && payload?.feedKey===state.data.key && matchById.get(String(m.id)));
    if(!v) return m;
    const flipped=m.a && m.b && m.a===v.b && m.b===v.a;
    if(m.a && v.a && !flipped && (m.a!==v.a || m.b!==v.b)) return m;
    const withSide=(left,right)=>flipped?[right,left]:[left,right];
    const oriented=p=>Number.isFinite(p)?(flipped?1-p:p):null;
    const pre=oriented(v.prePA);
    if(pre!==null){m.prePA=pre;m.preAt=v.preAt;m.preKind=v.preKind;}
    if(m.status==="finished")return m;
    if (!m.a && v.a && v.b) {m.a=v.a;m.b=v.b;}
    if(state.phase>1 && !Number.isFinite(m.prePA) && (v.status==="upcoming" || Date.parse(state.data.asOf)<Date.parse(v.startAt))){
      const previous=state.data.potential?.find(x=>x.round===m.round && x.bo===m.bo &&
        ((x.a===m.a && x.b===m.b)||(x.a===m.b && x.b===m.a)));
      if(Number.isFinite(previous?.pA)){
        m.prePA=previous.a===m.a?previous.pA:1-previous.pA;m.pA=m.prePA;
        m.preAt=state.data.asOf;m.preKind="conditional";
      }
    }
    if (v.startAt) m.startAt=v.startAt;
    const rank={upcoming:0,live:1,finished:2};
    if(!(v.status in rank) || rank[v.status]<rank[m.status])return m;
    if(v.status==="upcoming"){if(v.map && m.bo===1)m.map=v.map;return m;}
    if(v.status==="live" && (Date.parse(v.scoreAt)||0)<(Date.parse(m.scoreAt)||0))return m;
    const [sa,sb]=withSide(v.scoreA,v.scoreB);
    const [ma,mb]=withSide(v.mapScoreA,v.mapScoreB);
    // A browser response can lag a newly published scoreboard.
    if(state.phase>1 && SwissEvent.behind(m,v,flipped))return m;
    m.status=v.status;m.winner=v.winner??m.winner;
    if(v.map || state.phase>1)m.map=v.map??null;
    if((sa!=null && sb!=null) || (m.status==="finished" && m.bo===1)){m.scoreA=sa??null;m.scoreB=sb??null;}
    m.mapScoreA=ma;m.mapScoreB=mb;
    if (Array.isArray(v.maps) && (v.maps.length || state.phase>1)) m.maps=v.maps.map(row=>{
      const [scoreA,scoreB]=withSide(row.scoreA,row.scoreB);
      return {...row,scoreA,scoreB};
    });
    else if (v.status==="finished" && m.bo===1 && sa!=null) m.maps=[{map:m.map||"最终比分",scoreA:sa,scoreB:sb}];
    if(v.scoreAt)m.scoreAt=v.scoreAt;
    if(state.phase>1 && v.status==="live"){
      const odds=RoundOdds.live(m);
      if(odds)Object.assign(m,odds);
      else Object.assign(m,{livePA:null,liveKind:null,mapScoreA:null,mapScoreB:null});
    }else{
      m.livePA=oriented(v.livePA) ?? ((sa===base.scoreA && sb===base.scoreB && v.map===base.map)?m.livePA:null);
      m.liveKind=v.liveKind??m.liveKind;
    }
    m.scoreSource=v.scoreSource??v.source;m.scoreStale=v.scoreStale;
    return m;
  }
  function statusText() {
    if(!state.data)return "";
    if(state.data.kind==="final"||state.data.status==="final")return "阶段已结束";
    if(state.phase>1){
      const updated=SwissEvent.lastSuccess(state.phase);
      if(updated)return (Date.now()-updated<120000?"PGL 赛况 ":"PGL 最近赛况 ")+clock(updated);
    }
    if(!isCurrent()||!online)return state.data.status==="pending"?"等待晋级名单":"跟随后台发布";
    if(!payload)return failed?"赛况连接暂不可用":"正在获取实时赛况";
    const known=new Set(state.data.matches.filter(m=>m.status==="finished").map(m=>String(m.id)));
    const due=payload.finishedIds?.some(id=>!known.has(String(id)));
    if(due)return "新赛果已确认 · 等待模型发布";
    if(failed || payload.stale)return "赛况待同步"+(payload.asOf?" · "+clock(payload.asOf):"");
    return payload.asOf?"赛况 "+clock(payload.asOf):"正在同步赛况";
  }
  function indicator() { const node=el("live-status"); if(node)node.textContent=statusText(); }
  function arm(ms) { clearTimeout(timer); if(!document.hidden && online && isCurrent())timer=setTimeout(poll,ms); }
  async function poll() {
    if(pending || document.hidden || !online || !isCurrent())return;
    pending=true;
    try {
      const r=await fetch("api/live",{cache:"no-store",signal:AbortSignal.timeout(14000)});
      if(!r.ok)throw Error();
      const next=await r.json();
      if(!Array.isArray(next.matches))throw Error();
      if(next.feedKey!==state.latest?.key)return;
      const changed=JSON.stringify(next.matches)!==JSON.stringify(payload?.matches);
      payload=next;failed=false;matchById=new Map(next.matches.map(m=>[String(m.id),m]));
      if(isCurrent()){
        if(changed && location.hash!=="#picks" && state.data)render();
        if(changed && openMatch!==null && el("dialog").open)matchDialog(openMatch);
        if(changed && openTeam!==null && el("dialog").open)teamDialog(openTeam);
      }
    } catch { failed=true; }
    finally {pending=false;indicator();arm(payload?.refreshing && payload.stale?3000:15000);}
  }
  function onFeed(){
    indicator();
    if(state.phase>1 && state.data?.status!=="final" && !document.hidden){
      const feed=state.data;
      SwissEvent.refresh(state.phase,feed,{historical:false}).then(changed=>{
        indicator();
        if(changed && state.data===feed){
          if(!["#simulator","#picks"].includes(location.hash))render();
          if(openMatch!==null && el("dialog").open)matchDialog(openMatch);
          if(openTeam!==null && el("dialog").open)teamDialog(openTeam);
        }
      }).catch(()=>{});
    }
    if(online && isCurrent() && !pending){clearTimeout(timer);void poll();}
  }
  function lines(m,detail=false) {
    if(!m.a||!m.b)return "";
    function line(label,p,live=false) {
      if(!Number.isFinite(p)){
        return '<span class="prob-line waiting"><small>'+label+'</small><span>'+(live?'等待有效局分':'暂无赛前归档')+'</span></span>';
      }
      return '<span class="prob-line '+(live?'live-line':'')+'"><small>'+label+'</small><b>'+pct(p)+'</b>'+track(p)+'<b>'+pct(1-p)+'</b></span>';
    }
    if(m.status==="live")return '<span class="prob-block">'+line("赛前",m.prePA)+line("实时",m.livePA,true)+'</span>';
    if(m.status==="finished" && !detail)return "";
    return '<span class="prob-block">'+line(m.status==="finished"?"赛前":"预测",m.status==="finished"?m.prePA:(m.pA??m.prePA))+'</span>';
  }
  document.addEventListener("visibilitychange",()=>{if(document.hidden)clearTimeout(timer);else onFeed();});
  function standings(games) {
    const record=new Map(state.data.teams.map(t=>[t.id,{wins:0,losses:0}]));
    for (const m of games) {
      if(m.status!=="finished" || !m.winner || !record.has(m.a) || !record.has(m.b))continue;
      record.get(m.winner).wins++; record.get(m.winner===m.a?m.b:m.a).losses++;
    }
    return record;
  }
  return {match,lines,onFeed,indicator,standings,
    trackDialog:id=>{openMatch=id;openTeam=null;},trackTeam:id=>{openMatch=null;openTeam=id;}};
})();
