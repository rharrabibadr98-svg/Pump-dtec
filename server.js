// PUMP DTEC backend: Solana token risk data. Node 18+, no dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const RPC = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

async function dexscreener(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const j = await r.json();
    const pairs = (j.pairs || []).filter((p) => p.chainId === "solana");
    pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    return pairs[0] || null;
  } catch (e) {
    return null;
  }
}

async function analyze(mint) {
  const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const parsed = acc && acc.value && acc.value.data && acc.value.data.parsed;
  if (!parsed || parsed.type !== "mint") {
    const e = new Error("This address is not a token mint on Solana.");
    e.status = 400;
    throw e;
  }
  const info = parsed.info;
  const [pair, largest] = await Promise.all([
    dexscreener(mint),
    rpc("getTokenLargestAccounts", [mint]).catch(() => null),
  ]);

  // Top 10 holder concentration, excluding the liquidity pool / bonding curve account when we can identify it.
  let top10Pct = null;
  const supply = Number(info.supply) / Math.pow(10, info.decimals);
  if (largest && largest.value && supply > 0) {
    const top = largest.value.slice(0, 20);
    let owners = [];
    try {
      const m = await rpc("getMultipleAccounts", [top.map((t) => t.address), { encoding: "jsonParsed" }]);
      owners = m.value.map((v) => v && v.data && v.data.parsed && v.data.parsed.info && v.data.parsed.info.owner);
    } catch (e) {}
    const pool = pair && pair.pairAddress;
    const kept = top.filter((t, i) => !(pool && owners[i] === pool)).slice(0, 10);
    top10Pct = Math.round((kept.reduce((s, t) => s + (t.uiAmount || 0), 0) / supply) * 1000) / 10;
  }

  return {
    mint,
    name: pair ? pair.baseToken.name : null,
    symbol: pair ? pair.baseToken.symbol : null,
    mintRevoked: info.mintAuthority === null,
    freezeRevoked: info.freezeAuthority === null,
    top10Pct,
    hasPair: !!pair,
    liquidityUsd: pair && pair.liquidity ? pair.liquidity.usd || 0 : null,
    ageHours: pair && pair.pairCreatedAt ? Math.max(0, Math.round((Date.now() - pair.pairCreatedAt) / 36e5)) : null,
    price: pair ? Number(pair.priceUsd) : null,
    mcap: pair ? pair.marketCap || pair.fdv || null : null,
    vol: pair && pair.volume ? pair.volume.h24 : null,
    change: pair && pair.priceChange ? pair.priceChange : null,
  };
}

// tiny in-memory cache and per-IP rate limit
const cache = new Map();
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20;
}

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/check") {
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      if (limited(ip)) return send(res, 429, { error: "Too many requests. Try again in a minute." });
      const mint = (url.searchParams.get("address") || "").trim();
      if (!B58.test(mint)) return send(res, 400, { error: "Invalid Solana address." });
      const hit = cache.get(mint);
      if (hit && Date.now() - hit.t < 30000) return send(res, 200, hit.data);
      try {
        const data = await analyze(mint);
        cache.set(mint, { t: Date.now(), data });
        return send(res, 200, data);
      } catch (e) {
        return send(res, e.status || 502, { error: e.status ? e.message : "Could not fetch on-chain data. Try again." });
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    }
    send(res, 404, { error: "Not found" });
  })
  .listen(PORT, () => console.log(`PUMP DTEC running on http://localhost:${PORT}`));
