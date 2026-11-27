"use strict";
const Simulator = (() => {
  const modes={full:"全赛事",simple:"单阶段",minimal:"简洁",bracket:"对阵",classic:"经典"};
  const defaultMode="bracket";
  const titles=["","第一阶段","第二阶段","第三阶段","淘汰赛"];
  const roundsCS=["","八强赛","半决赛","决赛"];
  const storage="matchpoint.singapore.sim.v1.";
  const readingRound=new Map();
  let current=1, mode=defaultMode, replay=false, lowFirst=false, sessions=[{},{},{},{},{}];
  let context=null, namespace=null, undo=[], imported=false, watched=null, notice="";
  const params=()=>new URLSearchParams(location.search);
  const esc=v=>escaped(v);
  const btn=(key,text,extra="")=>'<button type="button" data-sim="'+key+'" '+extra+'>'+text+'</button>';
  function restore(value) {
    if(!value||typeof value!=="object")return;
    current=[1,2,3,4].includes(value.stage)?value.stage:1;
    mode=Object.hasOwn(modes,value.mode)?value.mode:defaultMode;
    replay=value.replay===true;lowFirst=value.lowFirst===true;
    sessions=[{},{},{},{},{}];
    for(let stage=1;stage<=4;stage++){
      const src=value.sessions?.[stage]; if(!Array.isArray(src))continue;
      for(const row of src.slice(0,160)){
        if(!Array.isArray(row)||row.length<5||row.length>6)continue;
        const [key,a,b,winner,lock,override]=row;
        if([key,a,b,winner].some(x=>typeof x!=="string"||x.length>110)||key==="__proto__"||!(winner===a||winner===b))continue;
        sessions[stage][key]={a,b,winner,lock:lock===true,override:override===true};
      }
    }
  }
  function bundle(){
    return {stage:current,mode,replay,lowFirst,sessions:sessions.map(s=>Object.entries(s).map(([k,v])=>[k,v.a,v.b,v.winner,v.lock,!!v.override]))};
  }
  function persist(){try{localStorage.setItem(storage+namespace,JSON.stringify(bundle()));}catch{}}
  function init(){
    const key=(state.phase===1?"":"s"+state.phase+"-")+"latest";
    if(key===namespace)return;
    namespace=key;undo=[];notice="";readingRound.clear();restore({});
    try{restore(JSON.parse(localStorage.getItem(storage+key)));}catch{}
    if(!imported){
      imported=true;
      mode=defaultMode;
      const q=params(), v=q.get("sim");
      if(v&&v.length<60000){try{restore(JSON.parse(v));}catch{}}
      if([1,2,3,4].includes(Number(q.get("simStage"))))current=Number(q.get("simStage"));
      if(q.has("stage") || !q.has("sim")&&!q.has("simStage"))current=state.phase;
    }
  }
  function checkpoint(){undo.push(bundle());if(undo.length>30)undo.shift();}
  function shareUrl(){
    const u=new URL(location.href);
    const shared=bundle();
    // Keep confirmed winners in the shared scenario for offline reproduction.
    for(const c of context.slice(1)){
      for(const m of c.rounds.flatMap(r=>r.matches)){
        if(m.source==="official" || (m.source==="auto" && m.official?.status==="live" && !replay)){
          shared.sessions[c.stage]=shared.sessions[c.stage].filter(row=>row[0]!==m.key);
          shared.sessions[c.stage].push([m.key,m.a,m.b,m.winner,m.source==="official"]);
        }
      }
    }
    u.searchParams.set("sim",JSON.stringify(shared));
    u.searchParams.set("stage",current);
    for(const key of ["simPick","simStage","snapshot","simSnapshot"])u.searchParams.delete(key);
    u.hash="simulator";return u;
  }
  function badge(team){
    if(!team)return "";
    if(team.logo) return '<img src="'+esc(team.logo)+'" alt="" draggable="false" class="logo">';
    return '<span class="sim-monogram">'+esc((team.short||team.id).slice(0,2))+'</span>';
  }
  function contexts(feed) {
    const result=[];
    let advanced=[];
    for(let stage=1;stage<=4;stage++){
      const published=stage===state.phase?state.data:Phases.get(stage);
      const knownField=stage>1 && stage<=state.phase && published?.teams?.length===(stage===4?8:16) && published.teams.every(t=>t.seed);
      const teams=knownField?published.teams.map(t=>({...SwissEvent.catalogue.find(team=>team.id===t.id),...t})).sort((a,b)=>a.seed-b.seed):
        stage===4?advanced.map((t,i)=>({...t,seed:i+1})):SwissEvent.teams(stage,feed,advanced.map(t=>t.id));
      const index=new Map(teams.map(t=>[t.id,t]));
      let games=SwissEvent.matches(stage,feed,{historical:false})||[];
      if(stage>1 && stage<=state.phase && published?.matches && !games.length)games=published.matches;
      if(stage===4)games=games.map(g=>({...g,key:g.playoffSlot||g.key}));
      const official=replay?[]:games;
      const inputPicks={};
      for(const [key,v] of Object.entries(sessions[stage])){
        const confirmed=official.find(g=>g.winner && (stage===4?g.key===key:SwissEngine.matchKey(g.round,g.a,g.b)===key));
        if(!confirmed||v.override)inputPicks[key]=stage===4?v:v.winner;
      }
      const auto=m=>{
        const o=m.official;
        if(o?.status==="live" && m.bo>1 && o.scoreA!=null && o.scoreB!=null && o.scoreA!==o.scoreB)return o.scoreA>o.scoreB?o.a:o.b;
        return index.get(m.a).seed<index.get(m.b).seed?m.a:m.b;
      };
      const options={picks:inputPicks,official,allBo3:stage===3,auto};
      const engine=stage===4?SimFinals:SwissEngine;
      const simulation=engine.simulate(teams,options);
      const locked={};
      for(const round of simulation.rounds){
        for(const m of round.matches){
          if(replay)m.official=games.find(g=>g.round===m.round && ((g.a===m.a&&g.b===m.b)||(g.a===m.b&&g.b===m.a)))||null;
          if(m.source==="pick" && sessions[stage][m.key]?.lock)locked[m.key]=m.winner;
        }
      }
      result[stage]={...simulation,stage,teams,locked,index,badge:id=>badge(index.get(id))};
      advanced=simulation.standings.slice(0,8);
    }
    return result;
  }
  function drawFeed(){
    if(document.hidden || location.hash!=="#simulator")return;
    const stages=[2,3,4].filter(stage=>mode==="full"||stage<=current);
    for(const stage of stages){
      if(stage===1)continue;
      Promise.resolve(SwissEvent.refresh(stage,state.data,{historical:false})).then(changed=>{
        if(changed && location.hash==="#simulator")render();
      }).catch(()=>{});
    }
  }
  function label(c,id){return esc(c.index.get(id)?.short||id||"待定");}
  function side(c,m,id,score){
    const win=m.winner===id, locked=!!c.locked[m.key], real=m.source==="official";
    const before=c.rounds[m.round-1].before, row=before?.find(t=>t.id===id);
    const hint=row?' · 种子 #'+row.seed+' · Buchholz '+row.buchholz+(row.opponents.length?'（'+row.opponents.map(i=>{const o=before.find(t=>t.id===i);return i+' '+(o.wins-o.losses);}).join('，')+'）':''):'';
    const value=Number.isInteger(score)?'<b class="sim-side-score">'+score+'</b>':'';
    return btn("winner",c.badge(id)+'<span>'+label(c,id)+'</span>'+value,
      'class="sim-side '+(win?'selected ':'')+(real?'real ':'')+'" data-path="'+esc(id)+'" data-winner="'+esc(id)+'" data-key="'+esc(m.key)+'" aria-pressed="'+win+'" title="'+
      esc((c.index.get(id)?.name||id)+(real?(win?' · 查看实绩':' · 假设本队获胜'):locked?' · 更改或解锁':' · 选择胜者，再点锁定')+hint)+'"');
  }
  function card(c,m){
    const o=m.official;
    let tag=c.locked[m.key]?"锁定":m.source==="official"?"实绩":m.source==="pick"?(o?.winner&&!replay?"改判":"手选"):"推演";
    let score="";
    if(o && o.scoreA!=null && o.scoreB!=null && !replay && !(o.winner && m.source==="pick")){
      score=(o.a===m.a?o.scoreA+' : '+o.scoreB:o.scoreB+' : '+o.scoreA);
    }else if(o?.status==="upcoming"&&!replay && o.startAt){
      const minutes=Math.ceil((Date.parse(o.startAt)-Date.now())/60000);
      if(minutes>0)score=minutes>=1440?Math.floor(minutes/1440)+'天 '+Math.floor(minutes%1440/60)+'时':minutes>=60?Math.floor(minutes/60)+'时 '+minutes%60+'分':minutes+'分';
    }
    if(!replay && o?.status==="live" && m.source!=="pick")tag="直播";
    const hasScore=Boolean(o&&!replay&&o.scoreA!=null&&o.scoreB!=null&&!(o.winner&&m.source==="pick"));
    const left=hasScore?(o.a===m.a?o.scoreA:o.scoreB):null;
    const right=hasScore?(o.a===m.a?o.scoreB:o.scoreA):null;
    return '<div class="sim-match '+(m.source==="official"?'confirmed':'')+(c.locked[m.key]?' locked':'')+'" data-pair="'+esc(m.key)+'">'+side(c,m,m.a,left)+side(c,m,m.b,right)+
      btn("detail",'<span>'+tag+'</span><b>'+esc(mode==="simple"&&hasScore?'BO'+m.bo:score||'BO'+m.bo)+'</b>', 'class="sim-match-foot" data-key="'+esc(m.key)+'" title="查看对阵与种子详情"')+'</div>';
  }
  function teamButton(c,row,r){
    return btn("team",c.badge(row.id)+'<span>'+label(c,row.id)+'</span>','data-round="'+r+'" data-path="'+esc(row.id)+'" data-id="'+esc(row.id)+'"');
  }
  function resultGroup(c,title,rows,type,round){
    return '<div class="sim-result '+type+'"><h4>'+title+'</h4>'+rows.map(row=>teamButton(c,row,round)).join("")+'</div>';
  }
  function roundName(c,r){return c.stage===4?roundsCS[r]:'第 '+r+' 轮';}
  function roundPage(c,rd){
    const pools=new Map(),cup=c.stage===4;
    for(const m of rd.matches){
      const record=cup?(m.key==="BR"?"季军赛":m.key==="F"?"冠军赛":roundName(c,rd.round)):m.wins+'–'+m.losses;
      if(!pools.has(record))pools.set(record,[]);
      pools.get(record).push(m);
    }
    const lanes=Array.from(pools,([record,games])=>{
      const m=games[0], goal=cup?"":m.wins===2&&m.losses===2?"决胜战":m.wins===2?"晋级战":m.losses===2?"淘汰战":"常规赛";
      const tone=m.wins===2?"advance":m.losses===2?"out":"regular";
      return '<section class="sim-pool '+tone+'"><div class="sim-pool-head"><strong>'+record+'</strong><span>'+goal+'</span></div>'+
        '<div class="sim-pool-games">'+games.map(g=>card(c,g)).join('')+'</div></section>';
    }).join('');
    const count=rd.matches.filter(m=>m.source==="official").length;
    return '<section class="sim-round" data-round-page="'+rd.round+'"><div class="sim-round-title"><h3>'+roundName(c,rd.round)+'</h3><span class="round-progress">'+count+' / '+rd.matches.length+' 场实绩</span>'+
      btn("shuffle-round","随机本轮",'data-round="'+rd.round+'"')+'</div><div class="sim-pools" style="--pools:'+pools.size+'">'+lanes+'</div>'+
      (cup?'':btn("rank","查看本轮排名 ↗",'class="sim-rank-link" data-round="'+rd.round+'"'))+'</section>';
  }
  function roundResults(c){
    const last=c.rounds.length;
    if(c.stage===4)return finish(c).replace('class="sim-round sim-finish"','class="sim-round sim-finish" data-round-page="'+(last+1)+'"');
    const group=(w,l)=>resultGroup(c,w+'–'+l,c.standings.filter(t=>t.wins===w&&t.losses===l),w===3?'advance':'out',last);
    return '<section class="sim-round sim-finish" data-round-page="'+(last+1)+'"><div class="sim-round-title"><h3>阶段结果</h3>'+
      btn("rank","完整排名 ↗",'class="sim-rank-link" data-round="'+last+'"')+'</div><div class="sim-outcomes">'+
      '<section><h4>晋级</h4>'+[0,1,2].map(l=>group(3,l)).join('')+'</section><section><h4>淘汰</h4>'+[2,1,0].map(w=>group(w,3)).join('')+'</section></div></section>';
  }
  function selectedRound(c){
    return readingRound.get(c.stage)??c.rounds.find(r=>r.matches.some(m=>m.source!=="official"))?.round??(c.rounds.length+1);
  }
  function roundTabs(c){
    const active=selectedRound(c);
    const pages=[...c.rounds.map(r=>roundName(c,r.round)),"阶段结果"];
    return '<div class="sim-round-tabs" role="group" aria-label="查看轮次">'+pages.map((s,i)=>
      btn("page",s,'data-page="'+(i+1)+'" aria-pressed="'+(active===i+1)+'"')).join('')+'</div>';
  }
  function column(c,r){
    const elim=c.stage===4, rd=c.rounds[r-1], sorted=[...rd.matches];
    if(lowFirst && mode==="classic")sorted.reverse();
    let body="",lastGroup="";
    if(!elim && r>=4){
      const rr=r-1;
      body+=resultGroup(c,'晋级 · 3–'+(rr-3),rd.before.filter(t=>t.wins===3&&t.losses===rr-3),'advance',rr);
    }
    for(const m of sorted){
      const group=elim?(m.key==="BR"?"季军赛":m.key==="F"?"冠军赛":""):(m.wins+'–'+m.losses);
      if(group && group!==lastGroup){body+='<div class="sim-group">'+group+'</div>';lastGroup=group;}
      body+=card(c,m);
    }
    if(!elim && r>=4)body+=resultGroup(c,'淘汰 · '+(r-4)+'–3',rd.before.filter(t=>t.losses===3&&t.wins===r-4),'out',r-1);
    return '<section class="sim-round"><div class="sim-round-title"><h3>'+roundName(c,r)+'</h3>'+
      btn("shuffle-round","⤨",'aria-label="随机推演'+roundName(c,r)+'" title="随机本轮未锁定的比赛" data-round="'+r+'"')+'</div>'+body+
      (!elim?btn("rank","本轮排名 ↗",'class="sim-rank-link" data-round="'+r+'"'):'')+'</section>';
  }
  function finish(c){
    let groups;
    if(c.stage===4)groups=[["冠军","advance",1],["亚军","",2],["季军","",3],["第四名","out",4]].map(([l,k,i])=>resultGroup(c,l,c.standings.filter(t=>t.place===i),k,3));
    else groups=[resultGroup(c,"晋级 · 3–2",c.standings.filter(t=>t.wins===3&&t.losses===2),"advance",5),resultGroup(c,"淘汰 · 2–3",c.standings.filter(t=>t.losses===3&&t.wins===2),"out",5)];
    return '<section class="sim-round sim-finish"><div class="sim-round-title"><h3>最终结果</h3></div>'+groups.join("")+
      btn("rank","完整排名 ↗",'class="sim-rank-link" data-round="'+c.rounds.length+'"')+'</section>';
  }
  function classic(c){
    return '<div class="sim-classic">'+c.rounds.map(rd=>{
      const ranks=rd.standings||c.standings;
      return '<div><div class="sim-round-title"><h3>'+roundName(c,rd.round)+'</h3>'+btn("shuffle-round","⤨",'data-round="'+rd.round+'" title="随机本轮"')+'</div>'+
        '<div class="sim-classic-games">'+(lowFirst?[...rd.matches].reverse():rd.matches).map(m=>card(c,m)).join("")+'</div>'+
        (c.stage<4?'<div class="sim-classic-rank">'+(lowFirst?[...ranks].reverse():ranks).map(t=>teamButton(c,t,rd.round)).join('')+'</div>':'')+'</div>';
    }).join("")+finish(c)+'</div>';
  }
  function bracket(c){
    const group=(r,tag,ms)=>'<div class="sim-record"><h4>'+tag+'</h4>'+ms.map(m=>card(c,m)).join("")+'</div>';
    return '<div class="sim-bracket" style="--cols:'+(c.rounds.length+1)+'">'+c.rounds.map(rd=>{
      const grouped=new Map();for(const m of rd.matches){const tag=c.stage===4?(m.key==="BR"?"季军赛":roundName(c,rd.round)):m.wins+'–'+m.losses; if(!grouped.has(tag))grouped.set(tag,[]);grouped.get(tag).push(m);}
      return '<section class="sim-bracket-col"><div class="sim-round-title"><h3>'+roundName(c,rd.round)+'</h3>'+btn("shuffle-round","⤨",'data-round="'+rd.round+'" title="随机本轮"')+'</div>'+[...grouped].map(([tag,ms])=>group(rd.round,tag,ms)).join('')+
        btn("rank","本轮排名 ↗",'class="sim-rank-link" data-round="'+rd.round+'"')+'</section>';
    }).join("")+finish(c)+'</div>';
  }
  function board(c){
    const n=c.rounds.flatMap(r=>r.matches).filter(m=>m.source==="official").length;
    const stage=c.stage, size=c.stage===4?8:33;
    let content;
    if(mode==="simple")content='<div class="sim-round-pages">'+c.rounds.map(r=>roundPage(c,r)).join('')+roundResults(c)+'</div>';
    else if(mode==="classic")content=classic(c);
    else if(mode==="bracket")content=bracket(c);
    else content='<div class="sim-grid" style="--cols:'+(c.rounds.length+1)+'">'+c.rounds.map(r=>column(c,r.round)).join('')+finish(c)+'</div>';
    return '<article class="sim-stage" data-sim-stage="'+stage+'" id="sim-stage-'+stage+'"><div class="sim-stage-head"><div><span class="sim-kicker">'+(stage===4?'PLAYOFFS':'SWISS / 0'+stage)+'</span><h3>'+titles[stage]+'</h3></div><p>'+
      (replay?'自由推演':n+' / '+size+' 场采用实绩')+' · '+(stage===3?'全程 BO3':stage===4?'决赛 BO5':'晋级与淘汰战 BO3')+'</p>'+
      '<div class="sim-tools">'+btn("rank",stage===4?'名次':'种子与排名','data-round="0"')+btn("shuffle","随机本阶段")+'</div></div>'+
      (mode==="simple"?roundTabs(c):'')+'<div class="sim-scroll">'+content+'</div></article>';
  }
  function html(feed){
    init();context=contexts(feed);
    const options=Object.entries(modes).map(([k,n])=>'<option value="'+k+'" '+(k===mode?'selected':'')+'>'+n+'</option>').join('');
    const notes='绿色为实绩，橙色为推演。点队标改判；前序轮次确定后，点当前胜者锁定，再点解锁。';
    queueMicrotask(drawFeed);
    return '<section id="simulator" class="panel sim-panel mode-'+mode+'">'+heading(state.phase===4?'淘汰赛流程模拟':'瑞士轮流程模拟',btn("help","规则与操作 ↗",'class="sim-help"'))+
      '<div class="sim-toolbar"><label>视图 <select id="sim-mode">'+options+'</select></label></div>'+
      (state.phase>1 && state.data.status==="pending"?'<p class="sim-guide">本阶段仍有待定席位，推演中由前一阶段的模拟晋级队补齐。</p>':'')+
      '<div class="sim-controls"><label><input type="checkbox" id="sim-replay" '+(replay?'checked':'')+'> 从零推演</label>'+
      (mode==="classic"?'<label><input type="checkbox" id="sim-low" '+(lowFirst?'checked':'')+'> 低种子在前</label>':'')+
      btn("undo","撤销",undo.length?'':'disabled')+btn("reset","恢复实绩")+btn("share","分享推演")+'</div>'+SimDisplay.controls(mode)+'<p class="sim-guide">'+notes+'</p><p class="sim-notice" role="status" '+(notice?'':'hidden')+'>'+esc(notice)+'</p>'+
      (mode==="full"?[1,2,3,4]:[current]).map(s=>board(context[s])).join("")+'</section>';
  }
  function choose(c,m,winner){
    if(m.source==="official" && m.winner===winner){SimDetails.match(c,m.round,m);return;}
    const last=sessions[c.stage][m.key];
    const same=m.winner===winner;
    const lock=same&&!last?.lock;
    if(lock && c.rounds.some(r=>r.round<m.round && r.matches.some(g=>g.source!=="official"&&!c.locked[g.key]))){
      notice="锁定第 "+m.round+" 轮前，请先锁定前面各轮尚未完赛的对阵。";render();return;
    }
    checkpoint();notice="";
    if(last?.lock && !lock){
      for(const [key,pick] of Object.entries(sessions[c.stage])){
        const round=c.stage===4?(key.startsWith("QF")?1:key.startsWith("SF")?2:3):Number(key.split(":")[0]);
        if(round>m.round)pick.lock=false;
      }
    }
    if(!replay && m.official?.winner===winner && m.source==="pick")delete sessions[c.stage][m.key];
    else sessions[c.stage][m.key]={a:m.a,b:m.b,winner,lock,override:!replay&&!!m.official?.winner};
    commit();
  }
  function commit(){
    persist();
    if(params().has("sim")){
      const u=new URL(location.href);u.searchParams.delete("sim");u.searchParams.delete("simStage");
      history.replaceState(history.state,"",u);
    }
    render();
  }
  function shuffle(stage,round){
    checkpoint();notice="";
    for(const rd of context[stage].rounds){
      if(round && round!==rd.round)continue;
      const c=contexts(state.phase===1?state.data:state.stageOne)[stage];
      for(const m of c.rounds[rd.round-1].matches){
        if(!m.a||!m.b||m.source==="official"||c.locked[m.key])continue;
        sessions[stage][m.key]={a:m.a,b:m.b,winner:Math.random()<.5?m.a:m.b,lock:false};
      }
    }
    commit();
  }
  function handle(e){
    if(!e.target.closest("#simulator")||!context)return;
    const stage=Number(e.target.closest("[data-sim-stage]")?.dataset.simStage||current), c=context[stage];
    const b=e.target.closest("button[data-sim]");
    if(e.type==="change"){
      if(e.target.id==="sim-mode"){mode=e.target.value;commit();}
      if(e.target.id==="sim-replay"){checkpoint();replay=e.target.checked;commit();}
      if(e.target.id==="sim-low"){lowFirst=e.target.checked;commit();}
      return;
    }
    if(!b)return;
    const round=Number(b.dataset.round)||0, action=b.dataset.sim;
    const m=b.dataset.key&&c.rounds.flatMap(rd=>rd.matches).find(g=>g.key===b.dataset.key);
    notice="";
    if(action==="page"){
      goToRound(b.closest(".sim-stage"),Number(b.dataset.page));return;
    }
    const owner=b.closest("[data-round-page]");if(owner)readingRound.set(stage,Number(owner.dataset.roundPage));
    if(action==="stage"){
      current=Number(b.dataset.stage);
      if(mode==="full"){persist();render();el("sim-stage-"+current)?.scrollIntoView({block:"start"});}else commit();
    }else if(action==="winner" && m)choose(c,m,b.dataset.winner);
    else if(action==="detail" && m)SimDetails.match(c,m.round,m);
    else if(action==="team" || action==="rank")SimDetails.table(c,round,b.dataset.id);
    else if(action==="help")SimDetails.help();
    else if(action==="shuffle"||action==="shuffle-round")shuffle(stage,round);
    else if(action==="undo" && undo.length){restore(undo.pop());commit();}
    else if(action==="reset"){checkpoint();replay=false;sessions=[{},{},{},{},{}];commit();}
    else if(action==="share"){
      const url=shareUrl().href;
      showDialog("分享本次推演",'<p>链接保留当前赛果选择、锁定和视图。在本机服务上生成的链接只适用于有同一看板的本机环境。</p><input class="sim-url" aria-label="推演链接" readonly value="'+esc(url)+'"><button type="button" id="sim-copy">复制链接</button>');
      el("sim-copy").onclick=async()=>{const input=$(".sim-url");input.select();try{await navigator.clipboard.writeText(url);el("sim-copy").textContent="已复制";}catch{el("sim-copy").textContent="已选中，可手动复制";}};
    }
  }
  document.addEventListener("click",handle);document.addEventListener("change",handle);
  setInterval(drawFeed,60000);document.addEventListener("visibilitychange",drawFeed);
  function highlight(id){
    if(watched===id)return;watched=id;
    document.querySelectorAll("#simulator [data-path]").forEach(x=>x.classList.toggle("sim-highlight",!!id && x.dataset.path===id));
  }
  document.addEventListener("pointerover",e=>highlight(e.target.closest?.("#simulator [data-path]")?.dataset.path));
  function markRound(article,page){
    readingRound.set(Number(article.dataset.simStage),page);
    article.querySelectorAll("[data-sim=page]").forEach(b=>b.setAttribute("aria-pressed",String(Number(b.dataset.page)===page)));
    article.querySelectorAll("[data-round-page]").forEach(s=>{
      const active=Number(s.dataset.roundPage)===page;
      s.classList.toggle("round-in-view",active);
      s.inert=!active;
    });
  }
  function goToRound(article,page){
    const lane=article.querySelector(".sim-scroll");
    lane.scrollLeft=(page-1)*lane.clientWidth;
    markRound(article,page);
  }
  window.addEventListener("resize",()=>{
    document.querySelectorAll(".mode-simple .sim-stage").forEach(a=>goToRound(a,selectedRound(context[Number(a.dataset.simStage)])));
  });
  function applyDisplay(root){
    root.querySelectorAll("[data-sim-stage]").forEach(article=>{
      const c=context[Number(article.dataset.simStage)];
      SimDisplay.apply(article,c,mode);
      if(mode!=="simple")return;
      goToRound(article,selectedRound(c));
      const lane=article.querySelector(".sim-scroll");
      lane.addEventListener("scroll",()=>{
        if(lane.isConnected && lane.clientWidth)markRound(article,Math.round(lane.scrollLeft/lane.clientWidth)+1);
      },{passive:true});
    });
  }
  return {html,shareUrl,applyDisplay};
})();
window.Simulator=Simulator;
