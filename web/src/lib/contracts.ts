import { CONTRACT_ADDRESS } from "./config";
import { type Address, type TxStage, parseJson, readContract, writeAndWait } from "./genlayer";

export type MarketRow = {
  market_id: string;
  creator: string;
  question: string;
  outcomes: string[];
  source_url: string;
  resolution_rule: string;
  created_at: number;
  predictions_close_at: number;
  resolve_at: number;
  expires_at: number;
  confirmations_required: number;
  confirm_interval: number;
  status: string;
  proposed_index: number;
  confirmations: number;
  next_round_at: number;
  last_round_at: number;
  rounds: number;
  last_round: string;
  last_page_hash: string;
  last_detail: string;
  injection_flags: string[];
  final_index: number;
  final_label: string;
  resolved_at: number;
  tally: number[];
};

export type EventRow = { kind: string; [key: string]: unknown };

export type Schedule = {
  market_id: string;
  now: number;
  status: string;
  predictions_close_at: number;
  predictions_open: boolean;
  resolve_at: number;
  next_round_at: number;
  round_open: boolean;
  seconds_until_round: number;
  expires_at: number;
  can_expire: boolean;
  confirmations: number;
  confirmations_required: number;
  confirm_interval: number;
};

export type Prediction = { address: string; outcome: number; at: number; correct?: boolean };

export type Stats = {
  markets: number;
  open: number;
  proposed: number;
  resolved: number;
  void: number;
  predictions: number;
  rounds: number;
};

type OnStage = (stage: TxStage, hash: string) => void;

/** What is accepted right now — read it before paying a fee for a call that would revert. */
export async function getSchedule(marketId: string): Promise<Schedule | null> {
  const raw = await readContract<string>(CONTRACT_ADDRESS, "get_schedule", [marketId]);
  const parsed = parseJson<Schedule & { error?: string }>(raw, {} as Schedule);
  return parsed.market_id ? parsed : null;
}

export async function listIds(): Promise<string[]> {
  return parseJson<string[]>(await readContract<string>(CONTRACT_ADDRESS, "list_ids", []), []);
}

export async function getMarket(id: string): Promise<MarketRow | null> {
  const raw = await readContract<string>(CONTRACT_ADDRESS, "get_market", [id]);
  const parsed = parseJson<MarketRow & { error?: string }>(raw, {} as MarketRow);
  return parsed.market_id ? parsed : null;
}

export async function getPredictions(id: string): Promise<Prediction[]> {
  const raw = await readContract<string>(CONTRACT_ADDRESS, "get_predictions", [id]);
  const parsed = parseJson<Prediction[] | { error: string }>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function getEvents(): Promise<EventRow[]> {
  return parseJson<EventRow[]>(
    await readContract<string>(CONTRACT_ADDRESS, "get_events", []),
    [],
  );
}

export async function getStats(): Promise<Stats | null> {
  return parseJson<Stats | null>(
    await readContract<string>(CONTRACT_ADDRESS, "get_stats", []),
    null,
  );
}

export type NewMarket = {
  marketId: string;
  question: string;
  outcomes: string[];
  sourceUrl: string;
  rule: string;
  predictionsCloseIn: string;
  resolveIn: string;
  confirmations: string;
  confirmInterval: string;
  expireIn: string;
};

export async function createMarket(
  account: Address,
  provider: unknown,
  m: NewMarket,
  onStage?: OnStage,
) {
  return writeAndWait(
    account,
    provider,
    CONTRACT_ADDRESS,
    "create_market",
    [
      m.marketId,
      m.question,
      JSON.stringify(m.outcomes),
      m.sourceUrl,
      m.rule,
      m.predictionsCloseIn,
      m.resolveIn,
      m.confirmations,
      m.confirmInterval,
      m.expireIn,
    ],
    onStage,
  );
}

export async function predict(
  account: Address,
  provider: unknown,
  marketId: string,
  outcomeIndex: number,
  onStage?: OnStage,
) {
  return writeAndWait(
    account,
    provider,
    CONTRACT_ADDRESS,
    "predict",
    [marketId, String(outcomeIndex)],
    onStage,
  );
}

export async function resolve(
  account: Address,
  provider: unknown,
  marketId: string,
  onStage?: OnStage,
) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "resolve", [marketId], onStage);
}

export async function expire(
  account: Address,
  provider: unknown,
  marketId: string,
  onStage?: OnStage,
) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "expire", [marketId], onStage);
}
