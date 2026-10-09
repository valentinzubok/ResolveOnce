"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_REPO,
  DEMO_FINAL,
  DEMO_OPEN,
  DEMO_OUTCOMES,
  DEMO_QUESTION,
  DEMO_RULE,
  EXPLORER,
  GITHUB,
  txUrl,
} from "@/lib/config";
import {
  claim,
  createMarket,
  expire,
  getBalance,
  getClaimable,
  getCredit,
  getEvents,
  getMarket,
  getPredictions,
  getSchedule,
  getStats,
  listIds,
  predict,
  resolve,
  withdrawCredit,
  type Claimable,
  type EventRow,
  type MarketRow,
  type Prediction,
  type Schedule,
  type Stats,
} from "@/lib/contracts";
import { fundWithTestGen, getNativeBalance, type TxStage } from "@/lib/genlayer";
import { useWallet } from "./WalletProvider";

const short = (h: string, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
const shortHash = (h: string) => (h ? `${h.slice(0, 16)}…` : "—");
const utc = (seconds: number) =>
  seconds ? `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC` : "—";
const span = (seconds: number) =>
  seconds >= 86400
    ? `${Math.round(seconds / 8640) / 10} d`
    : seconds >= 3600
      ? `${Math.round(seconds / 360) / 10} h`
      : `${Math.round(seconds / 6) / 10} min`;

/** Wei as GEN, trimmed: 1500000000000000000 -> "1.5". */
const fmtGen = (wei: string | number | undefined) => {
  let v: bigint;
  try {
    v = BigInt(wei || 0);
  } catch {
    return "0";
  }
  const whole = v / BigInt(10 ** 18);
  const frac = (v % BigInt(10 ** 18)).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : `${whole}`;
};

/** GEN typed by a person as wei, or "" when it is not a number. */
const toWei = (text: string) => {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) return "";
  return (BigInt(m[1]) * BigInt(10 ** 18) + BigInt((m[2] || "").padEnd(18, "0") || "0")).toString();
};

const ROUND: Record<string, { text: string; tone: string }> = {
  none: { text: "no round yet", tone: "neutral" },
  source_unreachable: { text: "source unreachable · no effect", tone: "broken" },
  undetermined: { text: "not determinable yet", tone: "neutral" },
  proposed: { text: "proposed · not final", tone: "broken" },
  confirmed: { text: "confirmed again · not final", tone: "broken" },
  contradicted: { text: "contradicted · count restarted", tone: "broken" },
  resolved: { text: "final", tone: "ok" },
};

/** Hero illustration: one reading is a proposal; only agreeing, separated readings are final. */
function Rounds() {
  return (
    <div className="roundsbox" aria-hidden="true">
      <p className="q">Did proposal 42 pass?</p>
      <div className="lane">
        <span>before T</span>
        <span className="bar no">resolve refused · the event has not happened</span>
      </div>
      <div className="lane">
        <span>round 1</span>
        <span className="bar yes">page states: Passed → proposal</span>
      </div>
      <p className="gap">⋮ at least one full interval</p>
      <div className="lane">
        <span>round 2</span>
        <span className="bar yes">page still states: Passed</span>
      </div>
      <div className="lane">
        <span>result</span>
        <span className="bar final">Passed · final, once</span>
      </div>
    </div>
  );
}

function Dots({ have, need }: { have: number; need: number }) {
  return (
    <span className="confirm" title={`${have} of ${need} agreeing rounds`}>
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < have ? "on" : ""} />
      ))}
    </span>
  );
}

export function ResolveOnceApp() {
  const { address, provider, connect, error: walletError } = useWallet();
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({});
  const [books, setBooks] = useState<Record<string, Prediction[]>>({});
  const [claimables, setClaimables] = useState<Record<string, Claimable>>({});
  const [credit, setCredit] = useState("0");
  const [held, setHeld] = useState("0");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [gen, setGen] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [tx, setTx] = useState("");
  const [stage, setStage] = useState<TxStage | "">("");

  const [marketId, setMarketId] = useState("dao/my-market");
  const [question, setQuestion] = useState(DEMO_QUESTION);
  const [outcomes, setOutcomes] = useState(DEMO_OUTCOMES);
  const [sourceUrl, setSourceUrl] = useState(DEMO_FINAL);
  const [rule, setRule] = useState(DEMO_RULE);
  const [closeIn, setCloseIn] = useState("120");
  const [resolveIn, setResolveIn] = useState("180");
  const [confirmations, setConfirmations] = useState("2");
  const [confirmInterval, setConfirmInterval] = useState("180");
  const [expireIn, setExpireIn] = useState("86400");
  const [stakeGen, setStakeGen] = useState("1");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ids, s, ev, bal] = await Promise.all([
        listIds(),
        getStats(),
        getEvents(),
        getBalance(),
      ]);
      setStats(s);
      setHeld(bal);
      setEvents(ev.slice(-10).reverse());
      const loaded = await Promise.all(ids.map((id) => getMarket(id)));
      setRows((loaded.filter(Boolean) as MarketRow[]).reverse());
      const sched = await Promise.all(ids.map((id) => getSchedule(id)));
      setSchedules(
        Object.fromEntries(
          sched.filter(Boolean).map((x) => [(x as Schedule).market_id, x as Schedule]),
        ),
      );
      const preds = await Promise.all(ids.map((id) => getPredictions(id)));
      setBooks(Object.fromEntries(ids.map((id, i) => [id, preds[i]])));
      if (address) {
        setGen(await getNativeBalance(address));
        setCredit(await getCredit(address));
        const mine = await Promise.all(ids.map((id) => getClaimable(id, address)));
        setClaimables(
          Object.fromEntries(ids.flatMap((id, i) => (mine[i] ? [[id, mine[i] as Claimable]] : []))),
        );
      } else {
        setCredit("0");
        setClaimables({});
      }
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : "read failed"}`);
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** ACCEPTED and FINALIZED are different guarantees, so the UI shows both. */
  const onStage = (next: TxStage, hash: string) => {
    setTx(hash);
    setStage(next);
    if (next === "finalized") void refresh();
  };

  const run = async (name: string, fn: () => Promise<string | void>) => {
    if (!address || !provider) {
      setMsg("Connect MetaMask for writes");
      setOk(false);
      return;
    }
    setBusy(name);
    setMsg("");
    setStage("");
    try {
      const hash = await fn();
      if (hash) setTx(hash);
      await refresh();
      setMsg(`${name}: accepted by consensus`);
      setOk(true);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setOk(false);
    } finally {
      setBusy("");
    }
  };

  const acct = address as `0x${string}`;
  const disabled = !!busy || !address;
  const labels = outcomes
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const stakeWei = toWei(stakeGen);

  return (
    <main className="wrap">
      <section className="hero">
        <div>
          <h1>
            Resolve<span className="accent">Once</span>
          </h1>
          <p className="lede">
            A market is only as honest as whoever announces how it ended. Here nobody does. The
            creator commits the question, the outcomes, one source page and the rule for reading
            it. After the committed time anyone can ask the network to read that page — and an
            outcome becomes final only when <strong>separated consensus rounds agree</strong> on
            the same one. Predictions carry a real stake: it sits in the contract until the
            market settles, then the winners split the pot — or everyone gets their stake back.
          </p>
          <div className="chips">
            <span className="chip">
              chain <b>{CHAIN_ID}</b>
            </span>
            {stats && (
              <>
                <span className="chip">
                  markets <b>{stats.markets}</b>
                </span>
                <span className="chip hot">
                  proposed <b>{stats.proposed}</b>
                </span>
                <span className="chip">
                  final <b>{stats.resolved}</b>
                </span>
                <span className="chip">
                  rounds <b>{stats.rounds}</b>
                </span>
                <span className="chip">
                  predictions <b>{stats.predictions}</b>
                </span>
                <span className="chip">
                  staked <b>{fmtGen(stats.staked)} GEN</b>
                </span>
                <span className="chip">
                  paid out <b>{fmtGen(stats.paid_out)} GEN</b>
                </span>
                <span className="chip hot">
                  held now <b>{fmtGen(held)} GEN</b>
                </span>
              </>
            )}
          </div>
          <p className="muted" style={{ marginTop: "0.8rem" }}>
            Contract <a href={EXPLORER}>{short(CONTRACT_ADDRESS, 12)}</a> · no owner, no admin ·{" "}
            <a href={CONTRACT_REPO}>contract source</a> · <a href={GITHUB}>this console</a>
          </p>
          <div>
            {!address ? (
              <button onClick={() => void connect()}>Connect MetaMask</button>
            ) : (
              <span className="pill">
                <span className="dot" /> {short(address)} · {gen || "?"} GEN
              </span>
            )}
            {address && (
              <button
                className="ghost"
                style={{ marginLeft: "0.5rem" }}
                disabled={!!busy}
                onClick={() =>
                  void run("Get test GEN", async () => {
                    await fundWithTestGen(acct);
                  })
                }
              >
                Get test GEN
              </button>
            )}
          </div>
          {address && credit !== "0" && (
            <p className="verdictbox">
              The contract holds <strong>{fmtGen(credit)} GEN</strong> for you that it could not put
              into a market (an overpaid or refused stake).{" "}
              <button
                className="ghost tiny"
                disabled={!!busy}
                onClick={() =>
                  void run("withdraw_credit", () => withdrawCredit(acct, provider, onStage))
                }
              >
                take it back
              </button>
            </p>
          )}
          {walletError && <p className="msg">{walletError}</p>}
          {msg && <p className={ok ? "okmsg" : "msg"}>{msg}</p>}
          {tx && (
            <p className="tx muted">
              last tx <a href={txUrl(tx)}>{short(tx, 14)}</a>{" "}
              {stage === "finalized" ? (
                <span className="stagepill final">finalized</span>
              ) : (
                <span className="stagepill accepted">accepted — awaiting finalization</span>
              )}
            </p>
          )}
        </div>
        <Rounds />
      </section>

      <div className="row">
        <section className="card">
          <h2>1 · Create a market</h2>
          <p className="muted">
            Everything a resolution depends on is fixed here and has no setter: not for you, not
            for an administrator — the contract has no owner. <code>resolve</code> later takes a
            market id and nothing else.
          </p>
          <label htmlFor="marketId">Market id</label>
          <input id="marketId" value={marketId} onChange={(e) => setMarketId(e.target.value)} />
          <label htmlFor="question">Question</label>
          <input id="question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <label htmlFor="outcomes">Outcomes (one per line, 2–6)</label>
          <textarea
            id="outcomes"
            rows={2}
            value={outcomes}
            onChange={(e) => setOutcomes(e.target.value)}
          />
          <label htmlFor="sourceUrl">Source page (https)</label>
          <input id="sourceUrl" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          <p className="muted">
            Demo pages:{" "}
            <button className="ghost tiny" onClick={() => setSourceUrl(DEMO_FINAL)}>
              certified result
            </button>
            <button className="ghost tiny" onClick={() => setSourceUrl(DEMO_OPEN)}>
              voting still open
            </button>
          </p>
          <label htmlFor="rule">Resolution rule</label>
          <textarea id="rule" rows={2} value={rule} onChange={(e) => setRule(e.target.value)} />
          <div className="grid2">
            <div>
              <label htmlFor="closeIn">Predictions close in (s)</label>
              <input id="closeIn" value={closeIn} onChange={(e) => setCloseIn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="resolveIn">Resolution opens in (s)</label>
              <input
                id="resolveIn"
                value={resolveIn}
                onChange={(e) => setResolveIn(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirmations">Agreeing rounds needed</label>
              <input
                id="confirmations"
                value={confirmations}
                onChange={(e) => setConfirmations(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirmInterval">Interval between rounds (s)</label>
              <input
                id="confirmInterval"
                value={confirmInterval}
                onChange={(e) => setConfirmInterval(e.target.value)}
              />
            </div>
          </div>
          <div className="grid2">
            <div>
              <label htmlFor="expireIn">Void if unresolved after (s)</label>
              <input id="expireIn" value={expireIn} onChange={(e) => setExpireIn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="stakeGen">Stake per prediction (GEN, 0 = free)</label>
              <input id="stakeGen" value={stakeGen} onChange={(e) => setStakeGen(e.target.value)} />
            </div>
          </div>
          <p className="muted">
            The stake is equal for everyone and fixed here. The pot is stake × predictions; it
            goes to the winners in equal shares, or back to every predictor if nobody was right or
            the market expires. No fee is taken and no address can withdraw it any other way.
          </p>
          <p className="muted">
            With these numbers the earliest possible final result is{" "}
            {span(
              (Number(resolveIn) || 0) +
                Math.max(0, (Number(confirmations) || 1) - 1) * (Number(confirmInterval) || 0),
            )}{" "}
            from now, whoever calls and however often. The demo values are minutes so the flow is
            reproducible; a real market would use hours or days.
          </p>
          <button
            disabled={
              disabled || !marketId || !question || labels.length < 2 || !rule || stakeWei === ""
            }
            onClick={() =>
              void run("create_market", () =>
                createMarket(
                  acct,
                  provider,
                  {
                    marketId,
                    question,
                    outcomes: labels,
                    sourceUrl,
                    rule,
                    predictionsCloseIn: closeIn,
                    resolveIn,
                    confirmations,
                    confirmInterval,
                    expireIn,
                    stake: stakeWei,
                  },
                  onStage,
                ),
              )
            }
          >
            {busy === "create_market" ? (
              <span className="working">
                <span className="spinner" /> creating…
              </span>
            ) : (
              "create the market"
            )}
          </button>
        </section>

        <section className="card">
          <h2>2 · What a round decides</h2>
          <ul className="decide">
            <li>
              <span className="tag">refused</span> before the committed resolve time, or before a
              full interval has passed since the last accepted round. The page is not even
              fetched.
            </li>
            <li>
              <span className="tag">not determinable yet</span> the page shows a live tally, a
              forecast or nothing final. A normal answer: nothing is proposed, and an earlier
              proposal is withdrawn.
            </li>
            <li>
              <span className="tag broken">proposed</span> validators agree the page states one
              listed outcome as a fact. One reading is not final.
            </li>
            <li>
              <span className="tag broken">contradicted</span> a later round reads a different
              outcome: the count starts again from one.
            </li>
            <li>
              <span className="tag ok">final</span> the committed number of rounds, each a full
              interval apart, named the same outcome.
            </li>
            <li>
              <span className="tag">void</span> the committed expiry passed without a final
              result; anyone may close the market.
            </li>
          </ul>
          <p className="muted">
            Finality cannot be undone, so the fail-safe direction is to record nothing: a
            malformed model answer, a model error or a consensus failure{" "}
            <strong>reverts the transaction</strong>. The outcome must come back as a JSON integer
            index of a listed outcome — a quoted number, a label or an index out of range is
            rejected. A source nobody can read confirms nothing and overturns nothing.
          </p>
        </section>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <h2>Markets on chain {loading && <span className="spinner" />}</h2>
        {rows.length === 0 && !loading && <p className="muted">No markets yet.</p>}
        {rows.map((m) => {
          const s = schedules[m.market_id];
          const book = books[m.market_id] || [];
          const mine = address
            ? book.find((p) => p.address.toLowerCase() === address.toLowerCase())
            : undefined;
          const due = claimables[m.market_id];
          const staked = m.stake && m.stake !== "0";
          const res = ROUND[m.last_round] || { text: m.last_round, tone: "neutral" };
          const tone = m.status === "resolved" ? "ok" : m.status === "void" ? "neutral" : res.tone;
          return (
            <article key={m.market_id} className={`card claim ${tone}`}>
              <div className="head">
                <span className="id">{m.market_id}</span>
                <span className={`verdict ${tone}`}>
                  {m.status === "void" ? "void · expired unresolved" : res.text}
                </span>
                <span className="muted">
                  {m.rounds} round(s) · {m.status}
                  {m.status !== "void" && (
                    <Dots have={m.confirmations} need={m.confirmations_required} />
                  )}
                </span>
              </div>
              <p className="claimtext">“{m.question}”</p>
              <div className="outcomes">
                {m.outcomes.map((label, i) => (
                  <span
                    key={label}
                    className={`outcome ${
                      m.final_index === i ? "final" : m.proposed_index === i ? "proposed" : ""
                    }`}
                  >
                    {label}
                    <small>
                      {m.tally[i] || 0} predicted
                      {m.final_index === i
                        ? " · final"
                        : m.proposed_index === i && m.status === "proposed"
                          ? " · proposed"
                          : ""}
                    </small>
                  </span>
                ))}
              </div>
              <p className="hashline">
                source <a href={m.source_url}>{m.source_url}</a>
              </p>
              <p className="hashline">rule: {m.resolution_rule}</p>
              <p className="hashline">
                {staked ? (
                  <>
                    stake <strong>{fmtGen(m.stake)} GEN</strong> per prediction · pot{" "}
                    <strong>{fmtGen(m.pot)} GEN</strong> · paid out {fmtGen(m.paid_out)} GEN in{" "}
                    {m.claims} claim(s)
                  </>
                ) : (
                  "free market: predictions carry no stake"
                )}
              </p>
              <p className="hashline">
                resolution from {utc(m.resolve_at)} · rounds ≥ {span(m.confirm_interval)} apart ·
                void after {utc(m.expires_at)}
                {m.last_page_hash && (
                  <>
                    {" "}
                    · last page sha-256 <code>{shortHash(m.last_page_hash)}</code>
                  </>
                )}
              </p>
              {m.last_detail && <p className="hashline">{m.last_detail}</p>}
              {s && m.status !== "resolved" && m.status !== "void" && (
                <p className="hashline">
                  {s.round_open
                    ? "a round is accepted now"
                    : s.can_expire
                      ? "expired: anyone may void it"
                      : `next round accepted from ${utc(s.next_round_at)}`}
                  {s.predictions_open
                    ? ` · predictions open until ${utc(s.predictions_close_at)}`
                    : " · predictions closed"}
                </p>
              )}
              {m.status === "resolved" && (
                <p className="verdictbox">
                  <strong>final: {m.final_label}.</strong> {m.tally[m.final_index] || 0} of{" "}
                  {m.tally.reduce((sum, n) => sum + n, 0)} prediction(s) were right
                  {mine ? ` — yours was ${mine.correct ? "right" : "wrong"}` : ""}.
                  {staked &&
                    ((m.tally[m.final_index] || 0) > 0
                      ? " The winners split the pot in equal shares."
                      : " Nobody was right, so every stake goes back.")}
                </p>
              )}
              {m.status === "void" && staked && (
                <p className="verdictbox">
                  <strong>void.</strong> The market expired without a final result, so every
                  predictor takes their stake back.
                </p>
              )}
              {due && due.amount !== "0" && (
                <button
                  style={{ marginRight: "0.5rem" }}
                  disabled={disabled}
                  onClick={() => void run("claim", () => claim(acct, provider, m.market_id, onStage))}
                >
                  claim {fmtGen(due.amount)} GEN ({due.kind === "refund" ? "stake back" : "winnings"})
                </button>
              )}
              {mine?.claimed && <span className="muted">you have claimed · </span>}
              {m.injection_flags?.length > 0 && (
                <p className="hashline flagged">
                  injection phrasing seen in the data: {m.injection_flags.join(", ")}
                </p>
              )}
              {s?.predictions_open &&
                !mine &&
                m.outcomes.map((label, i) => (
                  <button
                    key={label}
                    className="ghost"
                    style={{ marginRight: "0.5rem" }}
                    disabled={disabled}
                    onClick={() =>
                      void run("predict", () =>
                        predict(acct, provider, m.market_id, i, m.stake, onStage),
                      )
                    }
                  >
                    predict {label}
                    {staked ? ` · ${fmtGen(m.stake)} GEN` : ""}
                  </button>
                ))}
              {mine && m.status !== "resolved" && (
                <span className="muted" style={{ marginRight: "0.6rem" }}>
                  you predicted {m.outcomes[mine.outcome]}
                </span>
              )}
              {(m.status === "open" || m.status === "proposed") && (
                <button
                  className="ghost"
                  disabled={disabled || (s ? !s.round_open : false)}
                  onClick={() =>
                    void run("resolve", () => resolve(acct, provider, m.market_id, onStage))
                  }
                >
                  {s && !s.round_open ? "round not accepted yet" : "run a resolution round"}
                </button>
              )}
              {s?.can_expire && (
                <button
                  className="ghost"
                  style={{ marginLeft: "0.5rem" }}
                  disabled={disabled}
                  onClick={() =>
                    void run("expire", () => expire(acct, provider, m.market_id, onStage))
                  }
                >
                  void expired market
                </button>
              )}
            </article>
          );
        })}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Recent events</h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i} className={e.kind === "Resolved" ? "" : e.kind === "Round" ? "broken" : ""}>
                <strong>{String(e.kind)}</strong>{" "}
                <span className="muted">
                  {[
                    e.id,
                    e.round ? `round ${e.round}` : null,
                    e.result,
                    e.label,
                    e.confirmations
                      ? `${e.confirmations}/${e.confirmations_required ?? e.confirmations}`
                      : null,
                    e.kind === "Claimed" ? `${e.what} ${fmtGen(String(e.amount))} GEN` : null,
                    typeof e.at === "number" ? utc(e.at) : null,
                  ]
                    .filter(Boolean)
                    .map(String)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        ResolveOnce on GenLayer Studio Dev (chain {CHAIN_ID}). Reads work without a wallet; writes
        need MetaMask and test GEN for fees. The demo source pages are files in this repository,
        so every change to them is a public commit. Contract source:{" "}
        <a href={CONTRACT_REPO}>ResolveOnceCore</a>.
      </footer>
    </main>
  );
}
