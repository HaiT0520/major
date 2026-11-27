"use strict";

window.PublicTicket = (() => {
  const workerUrl = new URL("public-ticket-worker.js", document.currentScript.src);
  const local=location.port==="8764" && ["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  async function json(url,options,timeout,signal) {
    const controller=new AbortController(), abort=()=>controller.abort();
    if(signal?.aborted)throw new DOMException("已取消","AbortError");
    signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,timeout);
    try {
      const response=await fetch(url,{...options,signal:controller.signal});
      if(!response.ok)throw Error("查询服务暂不可用");
      return await response.json();
    } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);}
  }
  function browser(feed,card,signal) {
    return new Promise((resolve, reject) => {
      if(signal?.aborted){reject(new DOMException("已取消","AbortError"));return;}
      const worker = new Worker(workerUrl);
      const finish=(error,result)=>{
        clearTimeout(timer);signal?.removeEventListener("abort",abort);worker.terminate();
        error?reject(error):resolve(result);
      };
      const abort=()=>finish(new DOMException("已取消","AbortError"));
      const timer=setTimeout(()=>finish(new Error("本地样本下载超时，请检查网络后重试")),45000);
      signal?.addEventListener("abort",abort,{once:true});
      worker.onmessage = ({data}) => {
        finish(data.error?new Error(data.error):null,data.result);
      };
      worker.onerror = () => finish(new Error("未能加载该阶段的竞猜计算程序"));
      worker.postMessage({key:feed.key, teams:feed.teams, card,
        settled:feed.kind==="final" || feed.pickem?.kind==="settled"});
    });
  }
  function valid(result,key) {
    const probability=p=>Number.isFinite(p)&&p>=0&&p<=1;
    return result?.snapshotKey===key && probability(result.passProbability) &&
      Number.isFinite(result.expectedHits) && result.expectedHits>=0 && result.expectedHits<=10 &&
      Number.isFinite(result.samples) && result.samples>0 &&
      Array.isArray(result.hitProbabilities) && result.hitProbabilities.length===11 && result.hitProbabilities.every(probability) &&
      Array.isArray(result.interval95) && result.interval95.length===2 && result.interval95.every(probability);
  }
  async function evaluate(feed,card,{signal,onStatus=()=>{}}={}) {
    if(feed.kind==="final" || feed.pickem?.kind==="settled"){
      onStatus("settled");
      return {...await browser(feed,card,signal),computation:"settled",approximate:false};
    }
    onStatus("server");
    let endpoint=local?new URL("api/ticket",location.href).href:null;
    if(!endpoint){
      try {
        const config=await json("data/runtime.json",{cache:"no-store",credentials:"omit"},2000,signal);
        if(config.ticketEndpoint){
          const url=new URL(config.ticketEndpoint);
          if(url.protocol==="https:" && !url.username && !url.password)endpoint=url.href;
        }
      } catch {}
    }
    if(signal?.aborted)throw new DOMException("已取消","AbortError");
    if(endpoint){
      try {
        const result=await json(endpoint,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({snapshot:feed.key,card})},12000,signal);
        if(!valid(result,feed.key))throw Error("查询结果与当前数据不同步");
        return {...result,computation:"server",approximate:false};
      } catch {}
    }
    if(signal?.aborted)throw new DOMException("已取消","AbortError");
    onStatus("browser");
    const result=await browser(feed,card,signal);
    return {...result,computation:"browser",approximate:true};
  }
  return {evaluate};
})();
