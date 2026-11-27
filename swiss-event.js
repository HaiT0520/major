"use strict";

// Teams and entry seeds come from PGL's Singapore draw. The 9–16 seeds in a
// later Swiss stage come from the previous stage's final Valve standings.
(() => {
  const stages = {
    1: {name:"第一阶段", start:"2026-11-24", end:"2026-11-27", allBo3:false},
    2: {name:"第二阶段", start:"2026-11-28", end:"2026-12-01", allBo3:false},
    3: {name:"第三阶段", start:"2026-12-02", end:"2026-12-06", allBo3:true},
    4: {name:"冠军赛", start:"2026-12-10", end:"2026-12-13"}
  };
  // id, display name, PGL key, region, pre-event VRS rank, reference site code
  const entries = [
    ["NIP","Ninjas in Pyjamas","ninjas_in_pyjamas","EU",15,"nip"],
    ["PVISION","PVISION","pvision","EU",16,"pv"],
    ["HEROIC","HEROIC","heroic","EU",18,"hero"],
    ["FaZe","FaZe Clan","faze_clan","EU",20,"faze"],
    ["Liquid","Team Liquid","liquid","AM",21,"liqu"],
    ["EF","Eternal Fire","eternal_fire","EU",22,"ef"],
    ["100T","100 Thieves","100_thieves","EU",23,"100t"],
    ["9z","9z Team","9z_globant","AM",24,"9z"],
    ["M80","M80","m80","AM",25,"m80"],
    ["DENDELE","DENDELE","dendele","AM",29,"dend"],
    ["Imperial","Imperial Esports","imperial_esports","AM",35,"impe"],
    ["Wildcard","Wildcard","wildcard","AM",38,"wild"],
    ["GOSH","GOSH","gosh","AP",45,"bc.g"],
    ["FlyQuest","FlyQuest","flyquest","AP",48,"fly"],
    ["CW","Chinggis Warriors","chinggis_warriors","AP",55,"cw"],
    ["LVG","Lynn Vision Gaming","lynn_vision_gaming","AP",56,"lvg"],
    ["FUT","FUT Esports","fut_esports","EU",8,"fut"],
    ["Nemiga","Nemiga Gaming","nemiga","EU",10,"nemi"],
    ["G2","G2 Esports","g2_esports","EU",11,"g2"],
    ["TheOne","The One","1win","EU",12,"1win"],
    ["NAVI","Natus Vincere","natus_vincere","EU",13,"navi"],
    ["Astralis","Astralis","astralis","EU",14,"astr"],
    ["MongolZ","The MongolZ","the_mongolz","AP",17,"mong"],
    ["MIBR","MIBR","mibr","AM",19,"mibr"],
    ["MOUZ","MOUZ","mouz","EU",1,"mouz"],
    ["Vitality","Team Vitality","vitality","EU",2,"vita"],
    ["FURIA","FURIA","furia","AM",3,"furi"],
    ["Aurora","Aurora Gaming","aurora_gaming","EU",4,"auro"],
    ["Spirit","Team Spirit","spirit","EU",5,"spir"],
    ["BBTeam","BB Team","betboom_team","EU",6,"betb"],
    ["Falcons","Team Falcons","falcons","EU",7,"falc"],
    ["Legacy","Legacy","legacy","AM",9,"lega"]
  ];
  const catalogue = entries.map(([id,name,pgl,region,vrs,code],i)=>({
    id, name, short:({"TheOne":"The One","BBTeam":"BB Team","MongolZ":"The MongolZ"})[id] || id,
    pgl,region,vrs,code,entryStage:i<16?1:i<24?2:3,logo:"assets/"+id+".webp"
  }));
  const byId = new Map(catalogue.map(t=>[t.id,t]));
  const byKey = new Map(catalogue.map(t=>[t.pgl,t.id]));
  for (const [key,id] of Object.entries({parivision:"PVISION",imperial:"Imperial",bc_game_esport:"GOSH",the_one:"TheOne",bb_team:"BBTeam"})) byKey.set(key,id);

  function teams(stage, feed, qualifiedIds=[]) {
    stage=Number(stage);
    if (stage===1) {
      return (feed?.teams || []).map(t=>({...byId.get(t.id),...t})).sort((a,b)=>a.seed-b.seed);
    }
    const invited=catalogue.filter(team=>team.entryStage===stage);
    const qualifiers=qualifiedIds.map(id=>byId.get(typeof id==="string"?id:id.id));
    const complete=qualifiers.length===8 && new Set(qualifiers).size===8 &&
      qualifiers.every(team=>team && team.entryStage<stage);
    const list=complete?invited.concat(qualifiers):invited;
    return list.map((t,i)=>({...t,seed:i+1}));
  }

  const playoffSlots = {
    "quarter final match 1":"QF1","quarter final match 2":"QF2",
    "quarter final match 3":"QF3","quarter final match 4":"QF4",
    "semi-final match 1":"SF1","semi-final match 2":"SF2",
    "third place decider":"BR","final":"F"
  };
  const mapNames={dust2:"Dust II",ancient:"Ancient",inferno:"Inferno",nuke:"Nuke",
    anubis:"Anubis",mirage:"Mirage",cache:"Cache"};
  const pglPage="https://www.pglesports.com/cs2/pgl-major-singapore-2026/";
  function endpoint(stage) {
    return "https://news.pglesports.com/api/"+(stage===4?"playoffsEndpoint":"groupStageEndpoint?stage="+stage);
  }
  function pglMatch(row,stage,index) {
    const a=byKey.get(row.leftTeamKey), b=byKey.get(row.rightTeamKey);
    if (!a || !b || a===b) return null;
    const label=row.round.trim().toLowerCase(), playoffSlot=playoffSlots[label];
    const round=stage===4?(playoffSlot?.startsWith("QF")?1:playoffSlot?.startsWith("SF")?2:playoffSlot?3:null):
      (label.startsWith("opening round")?1:Number(/^round (\d)/.exec(label)?.[1]));
    if (!round || stage!==4 && round>5) return null;
    const bo=Number(row.format.toUpperCase().replace("BO",""));
    if (![1,3,5].includes(bo)) return null;
    const scores=[row.leftScore,row.rightScore], need=Math.ceil(bo/2);
    const valid=scores.every(x=>Number.isInteger(x) && x>=0 && x<=need);
    const done=row.status==="end" && valid && Math.max(...scores)===need && scores[0]!==scores[1];
    const status=done?"finished":row.status==="live"?"live":"upcoming";
    const maps=(row.maps||[]).map((mp,i)=>{
      const raw=(mp.map||"").replace(/^de_/,"").toLowerCase();
      if (!raw || !byKey.has(mp.leftTeamKey) || !byKey.has(mp.rightTeamKey)) return null;
      const left=byKey.get(mp.leftTeamKey), right=byKey.get(mp.rightTeamKey);
      if (!((left===a&&right===b)||(left===b&&right===a))) return null;
      const map=mapNames[raw]||raw;
      const rounds=RoundOdds.roundState(mp.leftScore,mp.rightScore);
      const started=status!=="upcoming" && (mp.leftScore+mp.rightScore>0 ||
        status==="live" && valid && i===(bo===1?0:scores[0]+scores[1]));
      if(!rounds || !started)return {map,number:i+1,scoreA:null,scoreB:null};
      return {map,number:i+1,scoreA:left===a?mp.leftScore:mp.rightScore,scoreB:left===a?mp.rightScore:mp.leftScore};
    }).filter(Boolean);
    const dated=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row.date);
    const startAt=dated && /^\d\d:\d\d$/.test(row.time)?
      dated[3]+"-"+dated[2]+"-"+dated[1]+"T"+row.time+":00+08:00":null;
    const activeNumber=bo===1?1:valid?scores[0]+scores[1]+(done?0:1):null;
    const active=maps.find(m=>m.number===activeNumber);
    return {id:"s"+stage+"-"+(index+1),round,playoffSlot,a,b,status,bo,startAt,
      winner:done?(scores[0]>scores[1]?a:b):null, map:active?.map||null,maps,
      mapScoreA:active?.scoreA??null,mapScoreB:active?.scoreB??null,
      scoreA:bo===1?active?.scoreA??null:status!=="upcoming"&&valid?scores[0]:null,
      scoreB:bo===1?active?.scoreB??null:status!=="upcoming"&&valid?scores[1]:null,
      source:pglPage,stream:row.stream||null};
  }

  function behind(previous,next,flipped=false) {
    if(previous.status!=="live" || next.status!=="live")return false;
    const [sa,sb]=flipped?[next.scoreB,next.scoreA]:[next.scoreA,next.scoreB];
    const [ma,mb]=flipped?[next.mapScoreB,next.mapScoreA]:[next.mapScoreA,next.mapScoreB];
    const regresses=(a,b,x,y)=>Number.isInteger(a)&&Number.isInteger(b) &&
      (!Number.isInteger(x)||!Number.isInteger(y)||x<a||y<b);
    return regresses(previous.scoreA,previous.scoreB,sa,sb) ||
      sa===previous.scoreA && sb===previous.scoreB && next.map===previous.map &&
      regresses(previous.mapScoreA,previous.mapScoreB,ma,mb);
  }
  const cache=new Map(), lastCheck=new Map(), lastSuccess=new Map(), pending=new Set();
  // Later-stage feeds are separate from the pinned Stage 1 probability snapshot.
  // Requests for a historical view always read only that snapshot's own data.
  function matches(stage,feed,{historical=true}={}) {
    stage=Number(stage);
    if (stage===1) return (feed?.matches||[]).map(m=>!historical&&typeof liveView!=="undefined"?liveView.match(m):m);
    return historical?[]:cache.get(stage)||[];
  }
  async function refresh(stage,feed,{historical=true}={}) {
    stage=Number(stage);
    if (historical || !feed || ![2,3,4].includes(stage) || pending.has(stage)) return false;
    const now=Date.now(), start=Date.parse(stages[stage].start+"T00:00:00+08:00");
    if (now<start-86400000 || now-(lastCheck.get(stage)||0)<60000) return false;
    pending.add(stage); lastCheck.set(stage,now);
    try {
      const res=await fetch(endpoint(stage),{cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(9000)});
      if (!res.ok) return false;
      const data=await res.json();
      if (!Array.isArray(data) || data.length!==(stage===4?8:33)) return false;
      lastSuccess.set(stage,now);
      const previous=cache.get(stage)||[], ledger=new Map(previous.map(row=>[row.id,row]));
      // PGL can briefly return unfilled slots while refreshing its scoreboard.
      // Accept corrected final results, but retain a confirmed result through a blank poll.
      for (const [index,item] of data.entries()) {
        const row=pglMatch(item,stage,index);
        if (!row) continue;
        const old=ledger.get(row.id);
        const same=old?.round===row.round && ((old.a===row.a && old.b===row.b)||(old.b===row.a && old.a===row.b));
        if (same && old.status==="finished" && row.status!=="finished") continue;
        if (same && old.status==="live" && row.status==="upcoming") continue;
        if (same && behind(old,row,old.a===row.b))continue;
        if (row.status!=="upcoming") {
          const {scoreAt,...previousRow}=old||{};
          row.scoreAt=scoreAt && JSON.stringify(previousRow)===JSON.stringify(row)?scoreAt:new Date(now).toISOString();
        }
        ledger.set(row.id,row);
      }
      const rows=[...ledger.values()];
      if (JSON.stringify(rows)===JSON.stringify(previous)) return false;
      cache.set(stage,rows);
      return true;
    } catch { return false; }
    finally { pending.delete(stage); }
  }
  globalThis.SwissEvent=Object.freeze({teams,matches,refresh,stages,catalogue,behind,lastSuccess:stage=>lastSuccess.get(stage)});
})();
