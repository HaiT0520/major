"use strict";

// Browser counterpart of engine/swiss.cpp. Team identities stay stable if a draw
// is regenerated, including when the official feed lists the sides in reverse.
(() => {
  const sixTeamPairings = [
    [1,6,2,5,3,4], [1,6,2,4,3,5], [1,5,2,6,3,4],
    [1,5,2,4,3,6], [1,4,2,6,3,5], [1,4,2,5,3,6],
    [1,6,2,3,4,5], [1,5,2,3,4,6], [1,3,2,6,4,5],
    [1,3,2,5,4,6], [1,4,2,3,5,6], [1,3,2,4,5,6],
    [1,2,3,6,4,5], [1,2,3,5,4,6], [1,2,3,4,5,6]
  ];

  function matchKey(round, a, b) {
    return round + ":" + [a,b].sort().map(encodeURIComponent).join("|");
  }

  function sixTeamDraw(group) {
    let best = null, minimum = 4;
    for (const order of sixTeamPairings) {
      const pairs = [];
      let repeats = 0;
      for (let i=0; i<order.length; i+=2) {
        const a=group[order[i]-1], b=group[order[i+1]-1];
        if (a.opponents.includes(b.id)) repeats++;
        pairs.push([a,b]);
      }
      if (repeats < minimum) {
        best=pairs; minimum=repeats;
        if (minimum===0) break;
      }
    }
    return best;
  }

  function earlyDraw(group) {
    if (!group.length) return [];
    const top=group[0];
    for (let j=group.length-1; j>0; j--) {
      const opponent=group[j];
      if (top.opponents.includes(opponent.id)) continue;
      const rest=earlyDraw(group.slice(1,j).concat(group.slice(j+1)));
      if (rest) return [[top,opponent], ...rest];
    }
    return null;
  }

  function standings(records) {
    const rows=Array.from(records.values(), team => {
      // The same opponent counts once, matching the model's opponent mask.
      const buchholz=[...new Set(team.opponents)].reduce((sum, id) => {
        const opponent=records.get(id);
        return sum+opponent.wins-opponent.losses;
      }, 0);
      return {...team, buchholz, opponents:team.opponents.slice()};
    });
    return rows.sort((a,b)=>b.wins-a.wins || a.losses-b.losses ||
      b.buchholz-a.buchholz || a.seed-b.seed);
  }

  function drawRound(round, ranked) {
    if (round===1) return ranked.slice(0,8).map((team,i)=>[team,ranked[i+8]]);
    const pairs=[];
    for (let wins=2; wins>=0; wins--) {
      const group=ranked.filter(t=>t.wins===wins && t.losses<3);
      if (!group.length) continue;
      const draw=round>=4 ? sixTeamDraw(group) : earlyDraw(group);
      if (!draw) throw new Error("本轮没有合法的瑞士轮配对");
      pairs.push(...draw);
    }
    return pairs;
  }

  function simulate(teams, {official=[], picks={}, auto=false, allBo3=false}={}) {
    if (!Array.isArray(teams) || teams.length!==16 ||
        new Set(teams.map(t=>t.id)).size!==16 ||
        new Set(teams.map(t=>t.seed)).size!==16 ||
        teams.some(t=>!t.id || !Number.isInteger(t.seed) || t.seed<1 || t.seed>16)) {
      throw new Error("瑞士轮需要 16 支队伍以及完整的 1–16 号种子");
    }
    const records=new Map(teams.map(t=>[t.id, {...t, wins:0, losses:0, opponents:[]}]));
    const officialByPair=new Map();
    for (const m of official) {
      if (records.has(m.a) && records.has(m.b)) officialByPair.set(matchKey(m.round,m.a,m.b),m);
    }
    const rounds=[];
    let ranked=standings(records), complete=false;
    for (let round=1; round<=5; round++) {
      const before=ranked;
      const matches=drawRound(round,before).map(([left,right])=>{
        const a=left.id, b=right.id;
        const key=matchKey(round,a,b);
        const observed=officialByPair.get(key) || null;
        const bo=allBo3 || left.wins===2 || left.losses===2 ? 3 : 1;
        const match={key, round, a, b, bo, wins:left.wins, losses:left.losses,
          winner:null, source:null, official:observed};
        const picked=picks[key];
        if (picked===a || picked===b) {
          match.winner=picked; match.source="pick";
        } else if (observed && (observed.winner===a || observed.winner===b)) {
          match.winner=observed.winner; match.source="official";
        } else if (auto) {
          const selected=typeof auto==="function" ? auto(match) : a;
          if (selected===a || selected===b) { match.winner=selected; match.source="auto"; }
        }
        return match;
      });
      for (const m of matches) {
        if (!m.winner) continue;
        records.get(m.winner).wins++;
        records.get(m.winner===m.a ? m.b : m.a).losses++;
        records.get(m.a).opponents.push(m.b);
        records.get(m.b).opponents.push(m.a);
      }
      ranked=standings(records);
      rounds.push({round,matches,before,standings:ranked});
      if (matches.some(m=>!m.winner)) break;
      complete=round===5;
    }
    return {rounds,standings:ranked,complete};
  }

  globalThis.SwissEngine=Object.freeze({matchKey,simulate});
})();
