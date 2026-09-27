# Radar/OpenClaw upgrade benchmark

Status: LAB ONLY. This benchmark must not change `main`, Radar, exchange credentials, or production state.

## Goal

Compare `Reinke01/openclaw` old baseline `69aa3df116d38141626fcdc29fc16b5f31f08d6c` (package version `2026.2.6-3`) against candidate `v2026.9.6` / `eb377ac59e6c9fd6c7705028034812becf00271b`.

The decision metric is **cost/usage per successful task**, not tokens per individual API call.

## Fairness rules

- Same provider and exact same model.
- Same model settings / thinking level.
- Same prompts and same run count.
- Local agent mode; no channel delivery.
- Fresh session id for each replicate.
- No production Radar data and no exchange access.
- Do not put API keys or credentials in this repository.
- Run from two isolated checkouts/worktrees with dependencies installed.
- Preserve raw JSON outputs outside Git; commit only aggregate evidence with secrets removed.

## Metrics

For each task/version/run capture:

- success / failure
- input tokens
- output tokens
- cache-read tokens
- cache-write tokens
- total tokens
- elapsed milliseconds
- process exit code
- retry/error count when observable
- output contract pass/fail

Primary metric: total billable/recorded tokens per **successful** task.
Secondary metrics: latency, failures/retries, output-contract accuracy.

## Workload

### T1 — minimal exact response
Prompt: `Reply exactly with: OK`

Pass: normalized assistant text is exactly `OK`.

### T2 — deterministic extraction
Prompt:

`From this record: asset=BTCUSDT; side=SHORT; rr=1.5; state=CONFIRMED. Return only JSON with keys asset, side, rr, state, preserving those values.`

Pass: valid JSON and values match the source record.

### T3 — short context continuation
Use one fresh session. Turn 1:

`Remember only these four values for this benchmark: asset BTCUSDT, side SHORT, stop 65000, target 62000. Reply exactly STORED.`

Turn 2:

`Return only JSON with keys asset, side, stop, target using the four stored values.`

Pass: turn 1 exact `STORED`; turn 2 valid JSON with all four expected values.

### T4 — longer fixed-context continuation
Use one fresh session. Send four fixed factual turns, each requiring `ACK`, then a fifth turn asking for the four facts as JSON. This measures context handling without tools or production data.

## Interpretation

Do not declare the new version better from a single run. Compare medians and totals across successful runs.

Classify:
- `BETTER`: lower total recorded tokens per successful task with no output-contract regression and no higher failure rate.
- `NEUTRAL`: difference too small/inconsistent to support a token-economy claim.
- `WORSE`: materially higher usage, more failures/retries, or output-contract regression.
- `NOT_DETERMINABLE`: provider usage metadata missing or environment not equivalent.

Latency is secondary; a faster run is not automatically cheaper.

## Safety / scope

This benchmark does not authorize:
- changing the Radar strategy;
- enabling exchange trading;
- installing the OpenClaw candidate as production;
- merging the upgrade branch.

Promotion requires review of the measured evidence.
