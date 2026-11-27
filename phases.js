"use strict";
const Phases = (() => {
  const titles = ["", "第一阶段", "第二阶段", "第三阶段", "淘汰赛"];
  const labels = ["", "STAGE 01", "STAGE 02", "STAGE 03", "PLAYOFFS"];
  const dates = ["", "11.24 — 11.27", "11.28 — 12.01", "12.02 — 12.06", "12.10 — 12.13"];
  const swissMetrics = {pAdvance:"晋级", p30:"3–0", pOrdinary:"普通晋级", p03:"0–3"};
  const playoffMetrics = {pChampion:"夺冠", pFinal:"进决赛", pSemifinal:"进四强"};
  let catalogue = {}, updatedAt = null;
  const fromURL = () => {
    const q = new URLSearchParams(location.search);
    const id = Number(q.get("stage") || (location.hash==="#simulator" && q.get("simStage")));
    return [1,2,3,4].includes(id) ? id : 1;
  };
  function url(id) {
    const u = new URL(location.href);
    u.searchParams.set("stage", id);
    for (const key of ["snapshot","sim","simStage","simSnapshot"]) u.searchParams.delete(key);
    return u.pathname + u.search + (u.hash || "#schedule");
  }
  function chrome() {
    const id = state.phase;
    const selected = catalogue[id];
    el("phase-bar").innerHTML = titles.slice(1).map((txt,i) => {
      const stage=i+1;
      return '<a href="'+escaped(url(stage))+'" data-phase="'+stage+'" '+(stage===id?'aria-current="page"':'')+'><small>'+labels[stage]+'</small><b>'+txt+'</b><span>'+dates[stage]+'</span></a>';
    }).join("");
    $(".hero-meta strong").textContent = (id===4?"单败淘汰":"瑞士轮")+" · "+titles[id];
    $(".hero-meta").lastChild.textContent=dates[id];
    $(".hero").setAttribute("aria-label","新加坡 Major 2026 "+titles[id]);
    const pathLink=$('.head-inner a[href="#swiss"]');
    pathLink.textContent=id===4?"淘汰对阵":"瑞士轮";
    document.title=titles[id]+" · 新加坡 Major 2026";
    return selected;
  }
  function formatRound(match) {
    if (state.phase!==4) return rounds[match.round] || "待定轮次";
    if (match.playoffSlot==="BR" || match.key==="BR" || match.id==="BR" || /third.place/i.test(match.id)) return "季军赛";
    return ["","四分之一决赛","半决赛","决赛"][match.round] || "待定轮次";
  }
  function metricSet() { return state.phase===4 ? playoffMetrics : swissMetrics; }
  function available(d) {return d.teams?.some(t=>Object.keys(metricSet()).some(k=>Number.isFinite(t[k])));}
  function note(d) {
    return escaped(d.reason || (state.phase===4?"八强及签位确定后，公布夺冠概率和淘汰赛预测。":"参赛队伍及首轮对阵确定后，公布本阶段模型预测。"));
  }
  function empty(title,description) {
    return '<section class="panel">'+heading(title)+'<p class="phase-empty">'+description+'</p></section>';
  }
  const dateOf=s=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(s));
  function prepare(raw) {
    const d={...raw};
    d.matches=(d.matches||[]).map(m=>({...m,id:String(m.id??m.key)}));
    d.teams=d.teams||[];d.history=d.history||[];d.potential=d.potential||[];
    d.modelNote=d.modelNote||"";d.sources=d.sources||[];
    if(!d.days?.length){
      const dates=[...new Set(d.matches.filter(m=>m.startAt).map(m=>dateOf(m.startAt)))].sort();
      d.days=dates.map((date,i)=>{
        const matches=d.matches.filter(m=>m.startAt && dateOf(m.startAt)===date);
        for(const m of matches)m.day=i+1;
        return {day:i+1,date,total:matches.length,rounds:[...new Set(matches.map(m=>m.round))].sort((a,b)=>a-b)};
      });
    }
    if(!d.day){d.day=d.matches.find(m=>m.status==="live")?.day || d.matches.find(m=>m.status==="upcoming")?.day || d.days.at(-1)?.day || 1;}
    return d;
  }
  function store(data) { catalogue=data.stages||{};updatedAt=data.updatedAt; }
  const get=id=>catalogue[id];
  function stageOneResult(feed) {
    const original = get(1)?.alternativesBySnapshot?.prematch?.[0];
    if (feed.kind !== "final" || !Number.isInteger(original?.actualHits)) return feed;
    const previous = feed.pickem?.hits;
    const trailing = Number.isInteger(previous) ? " 最后一场前更新的推荐单命中 "+previous+"/10 格。" : "";
    return {...feed, pickem:{...original,kind:"settled",hits:original.actualHits},
      modelNote:"赛前冻结推荐单最终命中 "+original.actualHits+"/10 格。"+trailing};
  }
  function field(d) {
    return '<section class="panel">'+heading("已确定参赛队",'<span class="eyebrow">'+d.teams.length+' TEAMS</span>')+
      (d.teams.length?'<div class="phase-field">'+d.teams.map(t=>'<button data-team="'+escaped(t.id)+'">'+logo(t.id)+'<span>'+escaped(t.short||t.name||t.id)+'</span></button>').join("")+'</div>':'')+
      '<p class="phase-empty">'+note(d)+'</p></section>';
  }
  function playoffDraw(d) {
    const played=d.matches.filter(m=>m.a||m.b||m.startAt);
    if(!played.length)return empty("淘汰赛对阵",note(d));
    const groups=new Map();
    for (const m of played){const k=formatRound(m);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(m);}
    return '<section class="panel">'+heading("淘汰赛对阵")+'<div class="phase-knockout">'+[...groups].map(([r,rows])=>'<section><h3>'+escaped(r)+'</h3>'+rows.map(matchRow).join("")+'</section>').join("")+'</div></section>';
  }
  function picksComparison(d) {
    const snapshots = get(1)?.alternativesBySnapshot || {};
    let list = d.alternatives || (state.phase===1 && snapshots[d.key]);
    let title="相近填法";
    if (!list?.length && state.phase===1 && d.kind==="final") {
      list=snapshots.prematch;
      title="阶段开赛前的备选单";
    }
    if (!list?.length || list.length<2) return "";
    const groups=[["perfect","3–0"],["ordinary","普通晋级"],["winless","0–3"]];
    const first=list[0];
    const entries=[first,...list.slice(1).sort((a,b)=>b.passProbability-a.passProbability)].slice(0,5);
    const names=ids=>ids.map(id=>escaped(name(id))).join("、");
    const shares=(x,n)=>Number.isFinite(x)?pct(x,n):"待公布";
    const alternatives=entries.map((card,i)=>{
      const swaps=groups.flatMap(([key,label])=>{
        const old=first[key]||[], next=card[key]||[];
        const added=next.filter(t=>!old.includes(t));
        return added.length?['<li><b>'+label+'</b><span>'+names(old.filter(t=>!next.includes(t)))+' → '+names(added)+'</span></li>']:[];
      });
      const lose=(first.passProbability-card.passProbability)*100;
      const fallback=groups.flatMap(([key,label])=>{
        const added=(card[key]||[]).filter(t=>!(first[key]||[]).includes(t));
        return added.length?[names(added)+' '+label]:[];
      }).join(" · ");
      const chips=groups.map(([k,label])=>'<div><b>'+label+'</b><span>'+names(card[k]||[])+'</span></div>').join("");
      const hits=d.kind==="final" && Number.isInteger(card.actualHits)?' · 实际 '+card.actualHits+'/10 格':'';
      return '<details class="variant" '+(i===1?'open':'')+'><summary><span class="variant-rank">'+String(i+1).padStart(2,"0")+'</span><b>'+(i===0?'模型首选':'备选 '+i)+hits+'</b><span class="variant-brief">'+fallback+'</span><strong>'+shares(card.passProbability,2)+'</strong><small>'+(i===0?"过关率":(Math.abs(lose)<0.005?"与首选持平":"较首选 "+(lose>0?"低 ":"高 ")+Math.abs(lose).toFixed(2)+" 个百分点"))+'</small></summary><div class="variant-body">'+
        (swaps.length?'<ul class="variant-swaps">'+swaps.join("")+'</ul>':'')+
        '<p>'+escaped(card.recommendation||card.description||(i===0?'按模型过关率选择这张单。':''))+
        (!card.recommendation&&!card.description&&i?'更看好 '+fallback+' 时可选。':'')+'</p><div class="variant-groups">'+chips+'</div></div></details>';
    }).join("");
    return '<section class="panel variant-panel">'+heading(title)+'<div class="variant-list">'+alternatives+'</div></section>';
  }
  function pairedWaiting(d,day) {
    const rounds=new Set(day.rounds);
    const published=new Set(d.matches.filter(m=>m.a&&m.b).map(m=>m.round+":"+[m.a,m.b].sort().join("|")));
    const pairs=(d.potential||[]).filter(p=>p.locked && rounds.has(p.round) && !published.has(p.round+":"+[p.a,p.b].sort().join("|")));
    if(!pairs.length)return "";
    const details=pairs.map(p=>'<div><span>'+logo(p.a)+escaped(name(p.a))+'</span><b>vs</b><span>'+logo(p.b)+escaped(name(p.b))+'</span></div>').join("");
    return '<section class="waiting-draw"><header><h3>已确定对阵</h3><span>具体时段待公布</span></header><div class="waiting-pairs">'+details+'</div><a href="#swiss">查看交手胜率 ↗</a></section>';
  }
  function bracketPicks(d) {
    if(!d.brackets?.length) return empty("淘汰赛竞猜",note(d));
    const names=ids=>(ids||[]).map(id=>escaped(name(id))).join("、");
    return '<section class="panel">'+heading("淘汰赛竞猜")+'<div class="variant-list">'+d.brackets.slice(0,5).map((b,i)=>
      '<details class="variant" '+(!i?'open':'')+'><summary><b>'+(i?'备选 '+i:'模型首选')+'</b><strong>'+pct(b.probability,2)+'</strong><small>整条签表全中</small></summary><div class="variant-body"><div class="variant-groups"><div><b>四强</b><span>'+names(b.quarters)+'</span></div><div><b>决赛</b><span>'+names(b.semis)+'</span></div><div><b>冠军</b><span>'+escaped(name(b.champion))+'</span></div></div><p>'+escaped(b.description||'')+'</p></div></details>'
    ).join("")+'</div></section>';
  }
  return {titles,dates,fromURL,url,chrome,formatRound,metricSet,available,note,empty,prepare,stageOneResult,store,get,field,playoffDraw,picksComparison,bracketPicks,pairedWaiting,
    timestamp:()=>updatedAt};
})();
