"use strict";

(() => {
  // Bracket A: 1/8 vs 4/5. Bracket B: 2/7 vs 3/6. The two losing
  // semifinalists play Singapore's separate best-of-three bronze match.
  const seeds=[[1,8],[4,5],[2,7],[3,6]];
  const samePair=(m,a,b)=>m && ((m.a===a && m.b===b) || (m.b===a && m.a===b));

  function simulate(teams, {picks={},official=[],auto=false}={}) {
    if (teams.length!==8 || teams.some(t=>!t.id) || new Set(teams.map(t=>t.id)).size!==8) {
      throw new Error("淘汰赛需要依排名排好的八支晋级队");
    }
    const seeding=new Map(teams.map((t,i)=>[t.id,i+1]));
    function match(key,round,a,b) {
      const m={key,round,a,b,bo:key==="F"?5:3,official:null,winner:null,loser:null,source:null};
      if (!a || !b) return m;
      m.official=official.find(game=>samePair(game,a,b) && (!game.key || game.key===key)) || null;
      const decision=picks[key];
      const picked=typeof decision==="object" ? (samePair(decision,a,b) && decision.winner) : decision;
      if (picked===a || picked===b) {
        m.winner=picked; m.source="pick";
      } else if (m.official && (m.official.winner===a || m.official.winner===b)) {
        m.winner=m.official.winner; m.source="official";
      } else if (auto) {
        const result=typeof auto==="function" ? auto(m) : seeding.get(a)<seeding.get(b) ? a : b;
        if (result===a || result===b) {m.winner=result; m.source="auto";}
      }
      if (m.winner) m.loser=m.winner===a ? b : a;
      return m;
    }
    const quarters=seeds.map(([a,b],i)=>match("QF"+(i+1),1,teams[a-1].id,teams[b-1].id));
    const semis=[0,2].map((i,n)=>match("SF"+(n+1),2,quarters[i].winner,quarters[i+1].winner));
    const final=match("F",3,semis[0].winner,semis[1].winner);
    const bronze=match("BR",3,semis[0].loser,semis[1].loser);
    const places=new Map();
    for (const q of quarters) if (q.loser) places.set(q.loser,5);
    if (final.winner) {places.set(final.winner,1); places.set(final.loser,2);}
    if (bronze.winner) {places.set(bronze.winner,3); places.set(bronze.loser,4);}
    const standings=teams.map(t=>({...t, seed:seeding.get(t.id), place:places.get(t.id)??null}));
    standings.sort((a,b)=>(a.place??0)-(b.place??0) || a.seed-b.seed);
    const rounds=[{round:1,matches:quarters}, {round:2,matches:semis}, {round:3,matches:[final,bronze]}];
    return {rounds,standings,complete:Boolean(final.winner && bronze.winner),winner:final.winner};
  }
  globalThis.SimFinals=Object.freeze({simulate});
})();
