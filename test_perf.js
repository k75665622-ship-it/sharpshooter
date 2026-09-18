const ids = [306, 331, 337, 349, 357, 359, 360, 361, 362, 363, 364, 366, 367, 368, 370, 371, 373, 375, 376, 377];
const url = (i) => `https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/types/1/teams/${i}/statistics`;

async function run(concurrency) {
  const queue = [...ids];
  const t0 = Date.now();
  let ok = 0;
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const r = await fetch(url(id));
        if (r.ok) { await r.text(); ok++; }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { concurrency, ms: Date.now() - t0, ok };
}

(async () => {
  for (const c of [1, 5, 10, 20]) {
    const r = await run(c);
    console.log(`concurrency ${String(c).padStart(2)} -> ${r.ok}/20 ok in ${(r.ms / 1000).toFixed(1)}s  (${(r.ms / r.ok).toFixed(0)}ms per request effective)`);
  }
})();
