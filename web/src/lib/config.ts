/** Live ResolveOnce deploy on GenLayer Studio Dev (chain 61997). Override via env. */
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_RESOLVEONCE_ADDRESS ||
  "0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc") as `0x${string}`;

/** Studio Dev / Studio Next — chain ID 61997. */
export const CHAIN_ID = 61997;
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC || "https://studio-dev.genlayer.com/api";
export const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-studio-dev.genlayer.com";
export const EXPLORER = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const txUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;

export const GITHUB = "https://github.com/valentinzubok/ResolveOnce";
export const CONTRACT_REPO = "https://github.com/valentinzubok/ResolveOnceCore";

/** The demo source pages live in this repository, so every change is a public commit. */
export const DEMO_FINAL = "https://valentinzubok.github.io/ResolveOnce/fixtures/vote-final.html";
export const DEMO_OPEN = "https://valentinzubok.github.io/ResolveOnce/fixtures/vote-open.html";
export const DEMO_QUESTION = "Did Harbor Collective proposal 42 pass?";
export const DEMO_OUTCOMES = "Passed\nRejected";
export const DEMO_RULE =
  "Resolve only from a final, certified result the page states after voting has closed. A live tally or a forecast is not a result.";
