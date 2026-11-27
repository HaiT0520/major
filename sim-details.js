"use strict";

(() => {
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const signed=n=>n>0?"+"+n:String(n);
  const labels={QF1:"八强赛 1",QF2:"八强赛 2",QF3:"八强赛 3",QF4:"八强赛 4",SF1:"半决赛 1",SF2:"半决赛 2",F:"总决赛",BR:"季军赛"};
  let active=null;

  const getRound=(ctx,value)=>typeof value==="object" ? value : ctx.rounds.find(r=>r.round===Number(value));
  function teamName(ctx,id) {
    const team=ctx.teams.find(t=>t.id===id);
    return team?.short || team?.name || id || "待定";
  }
  function team(ctx,id) {
    return '<span class="simd-team">'+(id?ctx.badge(id):"")+'<span>'+esc(teamName(ctx,id))+'</span></span>';
  }
  function teamLink(ctx,id) {
    return '<button type="button" class="simd-link" data-simd-team="'+esc(id)+'">'+team(ctx,id)+'</button>';
  }
  function phaseButtons(phase) {
    return '<div class="simd-switch">'+[["before","轮前"],["standings","轮后"]].map(([key,name])=>
      '<button data-simd-phase="'+key+'" aria-pressed="'+(phase===key)+'">'+name+'</button>').join("")+'</div>';
  }
  function scoreLine(official,item,match) {
    if (!Number.isInteger(item.scoreA) || !Number.isInteger(item.scoreB)) return "—";
    return official.a===match.a ? item.scoreA+" : "+item.scoreB : item.scoreB+" : "+item.scoreA;
  }
  function officialBlock(ctx,m) {
    const official=m.official;
    if (!official) return "";
    const status={finished:"已结束",live:"进行中",upcoming:"未开始"}[official.status] || "";
    const rows=(Array.isArray(official.maps)?official.maps:[]).filter(row=>row.map).map(row=>
      '<li><span>'+esc(row.map)+'</span><strong>'+scoreLine(official,row,m)+'</strong></li>').join("");
    const lines='<div class="simd-score">'+team(ctx,m.a)+'<b>'+scoreLine(official,official,m)+'</b>'+team(ctx,m.b)+'</div>';
    return '<section><h3>实际赛况 <small>'+esc(status)+'</small></h3>'+lines+
      (rows?'<ul class="simd-maps">'+rows+'</ul>':'')+'</section>';
  }
  function match(ctx,round,m) {
    const r=getRound(ctx,round);
    if (!r || !m) return;
    active={ctx,r,m,phase:"before",screen:"match",id:null};
    const playoff=Boolean(labels[m.key]);
    const phase=playoff?labels[m.key]:"第 "+r.round+" 轮 · "+m.wins+"–"+m.losses+" 组";
    const selection={pick:"你选择的胜者",official:"实际胜者",auto:"模拟胜者"}[m.source] || "尚未选择胜者";
    let body='<div class="simd"><p class="simd-sub">'+esc(phase)+' · BO'+esc(m.bo)+'</p>'+
      '<div class="simd-pick"><span>'+selection+'</span>'+(m.winner?team(ctx,m.winner):'')+'</div>'+
      officialBlock(ctx,m);
    if (!playoff && Array.isArray(r.before)) {
      body+='<section><h3>本场轮前排名</h3><table><thead><tr><th>队伍</th><th>排名</th><th>战绩</th><th>Buchholz</th><th>种子</th></tr></thead><tbody>';
      for (const id of [m.a,m.b]) {
        const idx=r.before.findIndex(t=>t.id===id);
        if (idx<0) continue;
        const t=r.before[idx];
        body+='<tr><td>'+teamLink(ctx,id)+'</td><td>'+(idx+1)+'</td><td>'+t.wins+'–'+t.losses+'</td><td>'+signed(t.buchholz)+'</td><td>'+t.seed+'</td></tr>';
      }
      body+='</tbody></table><button class="simd-back" data-simd-rank>查看本轮完整排名</button></section>';
    }
    showDialog(teamName(ctx,m.a)+" vs "+teamName(ctx,m.b),body+'</div>');
  }
  function ranking(ctx,r,id,phase,m=null) {
    const rows=r[phase];
    if (!Array.isArray(rows)) return;
    const t=rows.find(team=>team.id===id);
    active={ctx,r,m,phase,screen:t?"team":"rank",id:t?.id??null};
    const when=phase==="before"?"轮前":"轮后";
    let body='<div class="simd"><div class="simd-context"><span>第 '+r.round+' 轮</span>'+phaseButtons(phase)+'</div>';
    if (t) {
      const rank=rows.indexOf(t)+1;
      body+='<div class="simd-metrics">'+[["排名","#"+rank],["战绩",t.wins+"–"+t.losses],["Buchholz",signed(t.buchholz)],["初始种子","#"+t.seed]]
        .map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join("")+'</div>';
      if (t.opponents.length) {
        body+='<h3>对手的 Buchholz 贡献</h3><table><thead><tr><th>交手对手</th><th>该对手战绩</th><th>贡献</th></tr></thead><tbody>';
        for (const opp of new Set(t.opponents)) {
          const o=rows.find(team=>team.id===opp);
          if (o) body+='<tr><td>'+teamLink(ctx,opp)+'</td><td>'+o.wins+'–'+o.losses+'</td><td>'+signed(o.wins-o.losses)+'</td></tr>';
        }
        body+='</tbody></table>';
      } else body+='<p>此时还没有已结算的对手，Buchholz 为 0。</p>';
      body+='<button type="button" class="simd-back" data-simd-rank>← 全部队伍排名</button>';
    } else {
      body+='<table><thead><tr><th>排名 / 队伍</th><th>战绩</th><th>Buchholz</th><th>种子</th></tr></thead><tbody>'+
        rows.map((t,i)=>'<tr><td><span class="simd-num">'+(i+1)+'</span>'+teamLink(ctx,t.id)+'</td><td>'+t.wins+'–'+t.losses+'</td><td>'+signed(t.buchholz)+'</td><td>'+t.seed+'</td></tr>').join("")+'</tbody></table>';
    }
    if (phase==="standings" && r.matches.some(game=>!game.winner)) body+='<p class="simd-sub">本轮仍有未选场次，表中只计入当前已确定的结果。</p>';
    if (m) body+='<button type="button" class="simd-back" data-simd-match>← 返回本场对阵</button>';
    showDialog(t?teamName(ctx,t.id)+" · "+when+"种子与对手":when+"排名",body+'</div>');
  }
  function table(ctx,round,id) {
    const r=getRound(ctx,round||1);
    if (!r) return;
    if (!r.before) {
      active=null;
      const rows=ctx.standings??[];
      showDialog("淘汰赛名次",'<div class="simd"><table><thead><tr><th>队伍</th><th>名次</th><th>种子</th></tr></thead><tbody>'+
        rows.map(t=>'<tr><td>'+team(ctx,t.id)+'</td><td>'+(t.place===5?"5–8":t.place??"待定")+'</td><td>'+esc(t.seed)+'</td></tr>').join("")+'</tbody></table></div>');
      return;
    }
    ranking(ctx,r,id,round===0?"before":"standings");
  }
  function help() {
    active=null;
    showDialog("流程模拟说明",'<div class="simd"><section><h3>选择比赛结果</h3><p>未选场次默认由本阶段初始种子较高的队伍胜出。正在进行的多图系列赛优先采用地图比分领先方。点队标可以改判，后续轮次会重新配对。实际比分保留在比赛详情里。</p><p>前面各轮已完赛或已锁定后，点当前胜者即可锁定本场。随机洗牌跳过实绩与锁定场次。解锁或改判已锁定的早期比赛，会同时解除后面轮次的锁定。勾选「从零推演」可以改写实绩。</p></section>'+
      '<section><h3>瑞士轮怎样配对</h3><p>每阶段 16 队。首轮按 1 对 9 至 8 对 16 配对。此后同战绩交手，依次用 Buchholz 和本阶段初始种子排序，优先避免重赛。第四、五轮按 Valve 的六队配对表取首个符合条件的组合。</p>'+
      '<p>Buchholz 是交手对手当前胜场数减负场数的总和。在轮次排名中点击队伍，可以逐项核对这个数字。</p></section>'+
      '<section><h3>晋级与淘汰</h3><p>三胜晋级、三负出局。前两阶段的晋级战和淘汰战为 BO3，其余为 BO1。第三阶段全程 BO3。晋级队按上一阶段的最终排名排为下一阶段的 9–16 号种子。</p></section>'+
      '<section><h3>淘汰赛</h3><p>第三阶段前八名进入固定淘汰赛对阵。八强赛、半决赛和季军赛为 BO3，总决赛为 BO5。</p></section></div>');
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest("#dialog-body .simd button");
    if (!button || !active) return;
    const {ctx,r,m,phase,id}=active;
    if (button.dataset.simdTeam) ranking(ctx,r,button.dataset.simdTeam,phase,m);
    else if (button.dataset.simdPhase) ranking(ctx,r,id,button.dataset.simdPhase,m);
    else if (button.hasAttribute("data-simd-rank")) ranking(ctx,r,null,phase,m);
    else if (button.hasAttribute("data-simd-match")) match(ctx,r,m);
  });
  globalThis.SimDetails=Object.freeze({match,table,help});
})();
