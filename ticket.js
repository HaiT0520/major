"use strict";
const ticketEditor = (() => {
  const groups = [
    {key:"perfect", label:"3–0", count:2, offset:0},
    {key:"ordinary", label:"3–1 / 3–2", count:6, offset:2},
    {key:"winless", label:"0–3", count:2, offset:8}
  ];
  const storageKey = "matchpoint-singapore-2026-stage"+Phases.fromURL()+"-ticket";
  let draft = Array(10).fill(null), selected = null, target = null, drag = null, pressed = null;
  let result = null, error = "", version = 0, busy = false, snapshotKey, controller=null, queryMode="";
  function init(feed) {
    if (snapshotKey === undefined) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        const ids = new Set(feed.teams.map(t => t.id));
        if (Array.isArray(saved) && saved.length===10) {
          draft = saved.map(id => ids.delete(id) ? id : null);
        }
      } catch {}
    }
    if (snapshotKey !== feed.key) {
      invalidate();
      snapshotKey = feed.key;
    }
  }
  function invalidate() { version++;controller?.abort();controller=null;busy=false;result=null;error="";queryMode=""; }
  function save() {
    invalidate();
    selected=null; target=null;
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch {}
    repaint();
  }
  function place(id, index) {
    if (!state.data.teams.some(t=>t.id===id) || !Number.isInteger(index) || index<0 || index>=10) return;
    const from=draft.indexOf(id);
    if (from>=0) draft[from]=draft[index];
    draft[index]=id; save();
  }
  function slot(group, pos) {
    const i=group.offset+pos, id=draft[i], title=group.label+" 第 "+(pos+1)+" 格";
    return '<div class="slot-wrap" data-drop="'+i+'"><button type="button" class="ticket-slot '+(id?'filled ':'')+(target===i?'chosen':'')+'" data-slot="'+i+'" aria-label="'+escaped(title+'，'+(id?name(id):'空'))+'" '+(id?'draggable="true" data-drag="'+escaped(id)+'"':'')+'>'+
      (id?logo(id)+'<span>'+escaped(name(id))+'</span>':'<i aria-hidden="true">＋</i><span>待选</span>')+'</button>'+
      (id?'<button type="button" class="remove-slot" data-remove="'+i+'" aria-label="移除 '+escaped(name(id))+'">×</button>':'')+'</div>';
  }
  function resultView() {
    if (error) return '<p class="query-error" role="alert">'+escaped(error)+'</p>';
    if (!result) return '';
    const settled=result.kind==="settled";
    const approximate=!settled && result.approximate===true;
    const delta=(result.passProbability-state.data.pickem.passProbability)*100;
    const comparison=settled?'最终实际命中 '+result.expectedHits+' 格':approximate?
      '较推荐单参考值'+(delta>=0?'高':'低')+'约 '+Math.abs(delta).toFixed(1)+' 个百分点（含抽样误差）':
      Math.abs(delta)<0.005?'与推荐单过关率相同':(delta>0?'高于':'低于')+'推荐单 '+Math.abs(delta).toFixed(2)+' 个百分点';
    const peak=Math.max(...result.hitProbabilities,0.001);
    const bars=result.hitProbabilities.map((p,i)=>'<div class="hit-bin '+(i>=5?'pass':'')+'" title="命中 '+i+' 格 · '+pct(p,3)+'"><span class="bin-value">'+pct(p,1)+'</span><i style="height:'+Math.max(0,p/peak*48)+'px"></i><span>'+i+'</span></div>').join('');
    return (approximate?'<p class="query-notice" role="status">后端未连接，已使用浏览器小样本估计。相近填法的概率差可能来自抽样误差。</p>':'')+
      '<div class="ticket-result" aria-live="polite"><div><div class="result-label">'+(settled?'竞猜结算':approximate?'我的过关率 · 近似估计':'我的过关率')+'</div><strong>'+(settled?(result.passProbability?'已过关':'未过关'):pct(result.passProbability,approximate?1:2))+'</strong><p>'+comparison+'</p></div>'+
      (settled?'':'<div class="distribution"><div class="dist-title"><b>命中格数分布</b><span>平均 '+result.expectedHits.toFixed(2)+' 格</span></div><div class="hit-bars">'+bars+'</div></div>')+'</div>'+
      (settled?'':'<p class="query-foot">'+(approximate?'浏览器小样本':'后端完整样本')+' · '+(result.samples/10000).toLocaleString("zh-CN")+' 万次检验 · 过关率的 95% 模拟抽样区间 '+pct(result.interval95[0],2)+' – '+pct(result.interval95[1],2)+'</p>');
  }
  function content() {
    const feed=state.data;
    init(feed);
    const count=draft.filter(Boolean).length;
    const palette=feed.teams.map(t=>{
      const picked=draft.includes(t.id);
      return '<button type="button" class="palette-team '+(picked?'used ':'')+(selected===t.id?'chosen':'')+'" draggable="true" data-drag="'+escaped(t.id)+'" data-pick-team="'+escaped(t.id)+'" aria-pressed="'+(selected===t.id)+'" aria-label="'+escaped(t.name+(picked?'，已入选':''))+'">'+logo(t.id)+'<span>'+escaped(t.short)+'</span>'+(picked?'<i aria-hidden="true">✓</i>':'')+'</button>';
    }).join('');
    const slots=groups.map(g=>'<fieldset class="draft-group '+g.key+'"><legend>'+g.label+'</legend><div class="slot-grid">'+Array.from({length:g.count},(_,i)=>slot(g,i)).join('')+'</div></fieldset>').join('');
    const hint=selected?'已选 '+name(selected)+'，点击目标格':target!==null?'已选目标格，点击队标填入':'拖动队标入格，或依次点击队标和格子。';
    return heading("我的竞猜单",'<span class="filled-count">'+count+' / 10 格</span>')+
      '<div class="draft-body"><div class="draft-tools"><p id="draft-hint">'+escaped(hint)+'</p><div><button data-draft-action="copy">套用推荐</button><button data-draft-action="clear">清空</button></div></div>'+
      '<div class="palette" data-bank aria-label="可选队伍">'+palette+'</div><div class="draft-groups">'+slots+'</div>'+
      '<div class="query-actions"><span>至少命中 <b>5</b> 格过关</span><button class="query-button" data-draft-action="query" '+(count===10&&!busy&&location.protocol!=="file:"?'':'disabled')+'>'+(busy?'计算中…':'查询我的过关率')+'</button></div>'+
      (busy?'<p class="query-progress" role="status">'+(queryMode==="browser"?'后端未连接，正在下载小样本并计算近似概率…':queryMode==="settled"?'正在核对实际赛果…':'正在向后端查询完整样本…')+'</p>':'')+
      (location.protocol==="file:"?'<p class="query-foot">自选查询需要<a href="http://127.0.0.1:8764/#picks">打开本机服务</a>。</p>':'')+resultView()+'</div>';
  }
  function html(feed) { init(feed); return '<section class="panel draft-editor" id="draft-editor">'+content()+'</section>'; }
  function repaint() {
    const node=el('draft-editor'); if(!node)return;
    const active=document.activeElement, attr=["data-pick-team","data-slot","data-draft-action","data-remove"].find(k=>node.contains(active)&&active.hasAttribute(k));
    const value=attr?active.getAttribute(attr):null;
    node.innerHTML=content();
    if(attr)node.querySelector('['+attr+'="'+CSS.escape(value)+'"]')?.focus({preventScroll:true});
  }
  async function query() {
    if (busy || draft.some(id=>!id)) return;
    const id=++version, key=snapshotKey;
    controller=new AbortController();
    busy=true; error=""; result=null;queryMode="server"; repaint();
    const card=Object.fromEntries(groups.map(g=>[g.key,draft.slice(g.offset,g.offset+g.count)]));
    try {
      const data=await PublicTicket.evaluate(state.data,card,{signal:controller.signal,
        onStatus:mode=>{if(id===version){queryMode=mode;repaint();}}});
      if (id===version && key===state.data.key && data.snapshotKey===key) result=data;
    } catch(e){ if (id===version) error=e.message||"查询失败，请重试。"; }
    finally { if (id===version){controller=null;busy=false;repaint();} }
  }
  function handleClick(e) {
    const b=e.target.closest("#draft-editor button");
    if(!b) return;
    if (b.dataset.remove!==undefined) { draft[Number(b.dataset.remove)]=null; save(); }
    else if (b.dataset.pickTeam) {
      const id=b.dataset.pickTeam;
      if (target!==null) {place(id,target);return;}
      selected=selected===id?null:id; repaint();
    } else if (b.dataset.slot!==undefined) {
      const i=Number(b.dataset.slot);
      if (selected) {place(selected,i);return;}
      if (target!==null && target!==i && draft[target]) {place(draft[target],i); return;}
      target=target===i?null:i; repaint();
    } else if (b.dataset.draftAction==="copy") { draft=groups.flatMap(g=>state.data.pickem[g.key]);save(); }
    else if (b.dataset.draftAction==="clear") {draft=Array(10).fill(null);save();}
    else if (b.dataset.draftAction==="query") query();
  }
  document.addEventListener("click",handleClick);
  document.addEventListener("pointerdown",e=>{
    pressed=e.target.closest("#draft-editor [data-drag]")?.dataset.drag || null;
  });
  document.addEventListener("pointerup",()=>{pressed=null;});
  document.addEventListener("dragstart",e=>{
    const chip=e.target.closest("#draft-editor [data-drag]");
    if (!chip) return;
    // Scrolling the page during a drag can move another chip under the pointer.
    drag=pressed||chip.dataset.drag; e.dataTransfer.setData("text/plain",drag); e.dataTransfer.effectAllowed="move";
  });
  const dropSite=e=>e.target.closest("#draft-editor [data-drop], #draft-editor [data-bank]");
  document.addEventListener("dragover",e=>{
    const site=dropSite(e); if(!site||!drag)return;
    e.preventDefault(); e.dataTransfer.dropEffect="move"; site.classList.add("drag-over");
  });
  document.addEventListener("dragleave",e=>{
    const site=dropSite(e); if(site && !site.contains(e.relatedTarget)) site.classList.remove("drag-over");
  });
  document.addEventListener("drop",e=>{
    const site=dropSite(e); if(!site||!drag)return;
    e.preventDefault(); site.classList.remove("drag-over"); const team=drag; drag=null;
    if (site.dataset.drop!==undefined) place(team,Number(site.dataset.drop));
    else if (draft.includes(team)) {draft[draft.indexOf(team)]=null;save();}
  });
  document.addEventListener("dragend",()=>{drag=null;pressed=null;document.querySelectorAll(".drag-over").forEach(n=>n.classList.remove("drag-over"));});
  return {html};
})();
