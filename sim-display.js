"use strict";

// Display preferences affect the layout only. Results and team identities
// continue to be managed by Simulator, including clicks on standings rows.
(() => {
  const storageKey="matchpoint.singapore.display.v1";
  const labels={
    bestOf:"显示 BO", teamStandings:"显示队伍排名", abbrev:"队名缩写",
    matchOnly:"只看比赛", hideEliminated:"隐藏已淘汰队", shortNames:"短队名",
    seed:"初始种子", vrs:"赛前 VRS"
  };
  const fields={
    minimal:["bestOf","teamStandings","abbrev","matchOnly","shortNames","seed","vrs"],
    bracket:["bestOf","teamStandings","abbrev","matchOnly","shortNames","seed","vrs"],
    classic:["matchOnly","hideEliminated","shortNames","seed","vrs"]
  };
  const defaults={bestOf:true,teamStandings:true,abbrev:false,matchOnly:false,
    hideEliminated:true,shortNames:true,seed:false,vrs:false};
  let saved={};
  try {
    const data=JSON.parse(localStorage.getItem(storageKey));
    if (data && typeof data==="object") saved=data;
  } catch {}
  function options(mode) {
    const prefs={...defaults};
    for (const key of fields[mode]) {
      if (typeof saved[mode]?.[key]==="boolean") prefs[key]=saved[mode][key];
    }
    return prefs;
  }
  function controls(mode) {
    if (!fields[mode]) return "";
    const prefs=options(mode);
    return '<fieldset class="sd-options" data-sd-mode="'+mode+'"><legend>显示选项</legend>'+
      fields[mode].map(key=>'<label><input type="checkbox" data-sd-opt="'+key+'" '+
        (prefs[key]?'checked ':'')+(key==="shortNames" && prefs.abbrev?'disabled ':'')+'>'+labels[key]+'</label>').join("")+'</fieldset>';
  }
  function esc(value) {
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function decorateButton(btn,t,prefs,rank,mode) {
    if (!t) return;
    const label=btn.querySelector(":scope > span:not(.sim-monogram)");
    if (!label) return;
    const name=prefs.abbrev?(t.code||t.short||t.id).toUpperCase():
      prefs.shortNames?(t.short||t.id):(t.name||t.id);
    label.textContent=name;
    label.classList.add("sd-team-name");
    const bits=[];
    if (mode!=="classic" && prefs.teamStandings && rank) bits.push("#"+rank);
    if (prefs.seed) bits.push("S"+t.seed);
    if (prefs.vrs && t.vrs) bits.push("VRS "+t.vrs);
    if (bits.length) {
      const small=document.createElement("small");
      small.className="sd-team-info";
      small.textContent=bits.join(" · ");
      btn.append(small);
    }
    btn.setAttribute("aria-label",name+(bits.length?"，"+bits.join("，"):"")+
      (btn.dataset.sim==="winner"?"，选择本场胜者":"，查看排名详情"));
  }
  function rankList(c,r,prefs,mode,classicButtons) {
    const ordered=classicButtons?.length?
      classicButtons.map(btn=>r.standings.find(t=>t.id===btn.dataset.id)).filter(Boolean):r.standings;
    const rows=ordered.filter(t=>!(mode==="classic" && prefs.hideEliminated && t.losses>=3));
    const block=document.createElement(mode==="classic"?"section":"details");
    block.className="sd-ranks";
    const header=mode==="classic"?"h4":"summary";
    block.innerHTML='<'+header+'>轮后排名 <span>'+rows.length+' 队</span></'+header+'>'+
      '<table><thead><tr><th scope="col">队伍</th><th scope="col">战绩</th><th scope="col"><abbr title="Buchholz">BH</abbr></th></tr></thead><tbody>'+
      rows.map(t=>{
        const rank=r.standings.indexOf(t)+1;
        return '<tr><td><small>'+rank+'</small><button type="button" data-sim="team" data-id="'+esc(t.id)+'" data-path="'+esc(t.id)+
          '" data-round="'+r.round+'">'+c.badge(t.id)+'<span>'+esc(t.short||t.id)+'</span></button></td><td>'+
          t.wins+'–'+t.losses+'</td><td>'+esc(t.buchholz>0?"+"+t.buchholz:t.buchholz)+'</td></tr>';
      }).join("")+'</tbody></table>';
    return block;
  }
  function apply(root,c,mode) {
    if (!fields[mode] || !root) return;
    const prefs=options(mode), swiss=c.stage!==4;
    root.classList.add("sd-"+mode);
    root.classList.toggle("sd-only",prefs.matchOnly);
    root.classList.toggle("sd-hide-out",mode==="classic" && prefs.hideEliminated && swiss);
    root.classList.toggle("sd-long",!prefs.abbrev && !prefs.shortNames);
    root.querySelectorAll(".sd-team-info,.sd-ranks").forEach(n=>n.remove());
    const columns=root.querySelectorAll(mode==="classic"?".sim-classic > div":
      mode==="bracket"?".sim-bracket-col":".sim-grid > .sim-round:not(.sim-finish)");
    c.rounds.forEach((r,i)=>{
      const col=columns[i];
      if (!col) return;
      const matches=new Map(r.matches.map(m=>[m.key,m]));
      const beforeRank=new Map((r.before||[]).map((t,i)=>[t.id,i+1]));
      for (const card of col.querySelectorAll(".sim-match")) {
        const m=matches.get(card.dataset.pair);
        if (!m) continue;
        for (const btn of card.querySelectorAll(".sim-side")) {
          const t=c.index.get(btn.dataset.path);
          decorateButton(btn,t,prefs,beforeRank.get(t?.id)??t?.seed,mode);
        }
        const footer=card.querySelector(".sim-match-foot b");
        if (footer) {
          if (!footer.hasAttribute("data-sd-original")) footer.dataset.sdOriginal=footer.textContent.trim();
          const value=footer.dataset.sdOriginal;
          const score=value.startsWith("BO")?"":value;
          footer.textContent=[score,prefs.bestOf?"BO"+m.bo:""].filter(Boolean).join(" · ");
        }
      }
      const existing=col.querySelector(".sim-classic-rank");
      if (swiss && !prefs.matchOnly && (mode==="classic" || prefs.teamStandings)) {
        const ranking=rankList(c,r,prefs,mode,existing?[...existing.querySelectorAll("button")]:null);
        if (existing) existing.after(ranking);
        else col.append(ranking);
      }
    });
    for (const b of root.querySelectorAll(".sim-result [data-id],.sd-ranks [data-id]")) {
      decorateButton(b,c.index.get(b.dataset.id),prefs,null,mode);
    }
  }
  document.addEventListener("change",e=>{
    const input=e.target.closest?.("#simulator input[data-sd-opt]");
    if (!input) return;
    const mode=input.closest("[data-sd-mode]")?.dataset.sdMode, key=input.dataset.sdOpt;
    if (!fields[mode]?.includes(key)) return;
    saved[mode]={...options(mode),[key]:input.checked};
    try {localStorage.setItem(storageKey,JSON.stringify(saved));} catch {}
    render();
    document.querySelector('#simulator input[data-sd-opt="'+key+'"]')?.focus({preventScroll:true});
  });
  globalThis.SimDisplay=Object.freeze({controls,apply});
})();
