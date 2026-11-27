"use strict";

// One worker per submitted ticket. Its decoded pages are released on completion.
window.PublicTicket = (() => {
  const workerUrl = new URL("public-ticket-worker.js", document.currentScript.src);
  function evaluate(feed, card) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl);
      worker.onmessage = ({data}) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("未能加载该阶段的竞猜计算程序"));
      };
      worker.postMessage({key:feed.key, teams:feed.teams, card,
        settled:feed.kind==="final" || feed.pickem?.kind==="settled"});
    });
  }
  return {evaluate};
})();
