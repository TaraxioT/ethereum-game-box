// The pages a person reads at `/judge/<box>` and `/judge/<box>/<round>`. Plain HTML with no script. The log, the
// instructions and the model's words are all untrusted, so everything goes through `esc`, and `PAGE_CSP` backs that up.

import type { MatchLog } from '@egb/sdk';
import type { AgentTurn, AuditRecord, JudgeStatus } from '@egb/shared/store';

import type { AuditView } from './judge.ts';
import type { OpenedPot } from './runs.ts';

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** The most log entries a page lists. */
const TIMELINE_ROWS = 200;
const ETHERSCAN = 'https://sepolia.etherscan.io';
const HEX = /^0x[0-9a-fA-F]+$/;

export interface RunRow extends OpenedPot {
  readonly title: string | null;
  readonly status: JudgeStatus | null;
}

export interface RunDetail {
  readonly box: string;
  readonly round: string;
  readonly status: JudgeStatus;
  readonly audit: AuditView | null;
  /** The sealed record's exact text, until it lands on 0G Storage and is dropped here. */
  readonly recordText: string | null;
}

export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** USDC base units as dollars: `20000000` is `20`. */
export function usdc(units: string): string {
  if (!/^[0-9]+$/.test(units)) return esc(units);
  const padded = units.padStart(7, '0');
  const cents = padded.slice(-6).replace(/0+$/, '');
  return `${padded.slice(0, -6)}${cents ? `.${cents}` : ''} USDC`;
}

const short = (hex: string) => (hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex);
const when = (seconds: number) => (seconds ? new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '');

function chainLink(kind: 'tx' | 'address', hex: string | null | undefined): string {
  if (!hex) return '<span class="dim">none</span>';
  if (!HEX.test(hex)) return esc(hex);
  return `<a class="mono" href="${ETHERSCAN}/${kind}/${hex}" title="${hex}">${short(hex)}</a>`;
}

const STATE_WORDS: Record<JudgeStatus['state'], string> = {
  judging: 'Judging',
  paying: 'Paying',
  paid: 'Paid',
  refunded: 'Refunded',
  failed: 'Failed',
};

function stateTag(status: JudgeStatus | null): string {
  if (!status) return '<span class="tag none">Not judged</span>';
  return `<span class="tag ${status.state}">${STATE_WORDS[status.state]}</span>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#FAF9F5;--ink:#141413;--muted:#6F6E68;--line:#DEDCD2;--panel:#F0EEE6;--accent:#3B5BDB;--good:#2F7D4F;--warn:#A8650B;--bad:#B3372B}
@media(prefers-color-scheme:dark){:root{--bg:#1B1B1A;--ink:#EDEBE4;--muted:#A09E96;--line:#3A3936;--panel:#252523;--accent:#8FA6FF;--good:#7CC79A;--warn:#E5B567;--bad:#F09A8E}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 80px}a{color:var(--accent)}
h1{font:500 32px/1.2 ui-serif,Georgia,serif;margin:6px 0}h2{font-size:17px;margin:32px 0 8px}.kicker,th{font:600 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lede,.dim{color:var(--muted)}.mono{font:13.5px ui-monospace,Menlo,monospace}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);text-align:left;padding:8px 10px;vertical-align:top}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:18px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:20px;font-weight:600}
.say{background:var(--panel);border-left:3px solid var(--accent);border-radius:6px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.tag{font:600 12px/1 ui-monospace,Menlo,monospace;padding:4px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.paid{color:var(--good)}.refunded,.judging,.paying{color:var(--warn)}.failed{color:var(--bad)}.none{color:var(--muted)}
</style></head><body><main>${body}</main></body></html>`;
}

function outcome(row: RunRow): string {
  const status = row.status;
  if (status?.payouts) {
    const won = status.payouts.reduce((best, payout, seat) => (BigInt(payout) > BigInt(status.payouts?.[best] ?? '0') ? seat : best), 0);
    return `Seat ${won + 1} took ${usdc(status.payouts[won] ?? '0')}`;
  }
  return status?.state === 'refunded' ? 'Stakes returned' : '';
}

export function runsPage(box: string, rows: readonly RunRow[]): string {
  const count = (state: JudgeStatus['state']) => rows.filter((row) => row.status?.state === state).length;
  const staked = rows.reduce((sum, row) => sum + BigInt(row.amount) * BigInt(row.players.length), 0n);
  const body = rows.length
    ? `<div class="scroll"><table><tr><th>Round</th><th>Game</th><th>Players</th><th>Pot</th><th>Result</th><th>Outcome</th><th>Opened</th></tr>${rows
        .map(
          (row) =>
            `<tr><td><a href="/judge/${esc(box)}/${esc(row.round)}">#${esc(row.round)}</a></td><td>${esc(row.title ?? short(row.bundle))}</td><td>${row.players.length}</td><td>${usdc((BigInt(row.amount) * BigInt(row.players.length)).toString())}</td><td>${stateTag(row.status)}</td><td>${esc(outcome(row))}</td><td class="dim">${esc(when(row.openedAt))}</td></tr>`,
        )
        .join('')}</table></div>`
    : '<p class="dim">This Box has opened no store pots.</p>';
  return page(
    `${box}: judged runs`,
    `<div class="kicker">Game Box verifier</div><h1>${esc(box)}</h1><p class="lede">Every store game this Box has staked, and what the AI judge decided.</p>
<div class="cards"><div class="card"><b>${rows.length}</b>Runs</div><div class="card"><b>${count('paid')}</b>Paid</div><div class="card"><b>${count('refunded')}</b>Refunded</div><div class="card"><b>${usdc(staked.toString())}</b>Staked</div></div>${body}`,
  );
}

function parsedRecord(text: string | null): AuditRecord | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as AuditRecord;
  } catch {
    return null;
  }
}

function parsedLog(record: AuditRecord | null): MatchLog | null {
  try {
    return record ? (JSON.parse(record.log) as MatchLog) : null;
  } catch {
    return null;
  }
}

function entryWords(entry: MatchLog['entries'][number]): string {
  if (entry.t === 'tap') return `Seat ${esc(entry.seat + 1)} tapped${entry.roll === null ? '' : `, rolling ${esc(entry.roll)}`}`;
  if (entry.t === 'end') {
    const why = { game: 'the game ended it', time: 'time ran out', lost: 'the game was lost' }[entry.why] ?? entry.why;
    return `The match closed: ${esc(why)}`;
  }
  return `The game reported <strong>${esc(entry.name)}</strong> <span class="mono dim">${esc(JSON.stringify(entry.data))}</span>`;
}

function timeline(log: MatchLog): string {
  const start = log.entries[0]?.at ?? log.header.startedAt;
  const rows = log.entries.slice(0, TIMELINE_ROWS).map((entry) => {
    const source = entry.src === 'box' ? 'Box saw' : 'Game claimed';
    return `<tr><td class="mono">+${esc(((entry.at - start) / 1000).toFixed(2))}s</td><td class="dim">${source}</td><td>${entryWords(entry)}</td></tr>`;
  });
  const more = log.entries.length - rows.length;
  return `<div class="scroll"><table><tr><th>When</th><th>Source</th><th>What happened</th></tr>${rows.join('')}</table></div>${more > 0 ? `<p class="dim">And ${more} more entries.</p>` : ''}`;
}

function seats(log: MatchLog, payouts: readonly string[] | null): string {
  const taps = (seat: number) => log.entries.filter((entry) => entry.t === 'tap' && entry.seat === seat).length;
  const rows = log.header.players.map(
    (player, seat) =>
      `<tr><td>Seat ${seat + 1}</td><td>${chainLink('address', player)}</td><td>${taps(seat)}</td><td>${usdc(log.header.amount)}</td><td>${payouts?.[seat] === undefined ? '<span class="dim">none</span>' : usdc(payouts[seat])}</td></tr>`,
  );
  return `<div class="scroll"><table><tr><th>Seat</th><th>Player</th><th>Taps the Box saw</th><th>Stake</th><th>Paid</th></tr>${rows.join('')}</table></div>`;
}

const turnProof = (turns: readonly AgentTurn[]) => {
  const passed = turns.filter((turn) => turn.teeVerified).length;
  return `${passed} of ${turns.length} model turns passed the enclave check. That shows a registered enclave handled each turn, not that its text is what appears here.`;
};

export function runPage(run: RunDetail): string {
  const { box, round, status, audit } = run;
  const record = parsedRecord(run.recordText);
  const log = parsedLog(record);
  const verdict = record?.verdict;
  const said = verdict?.kind === 'failed' ? verdict.why : verdict?.why;
  const story = log
    ? `<h2>Players</h2>${seats(log, status.payouts)}<h2>The match</h2>${timeline(log)}`
    : `<p class="dim">The match log isn't kept here${audit?.root ? ' any more: the full record is on 0G Storage, under the root below' : ' yet'}.</p>`;
  return page(
    `${box} round ${round}`,
    `<div class="kicker"><a href="/judge/${esc(box)}">${esc(box)}</a> · Round ${esc(round)}</div><h1>${esc(log?.header.game ?? `Round ${round}`)}</h1><p>${stateTag(status)}</p>
${said || status.reason ? `<h2>What the judge said</h2><div class="say">${esc(said ?? status.reason)}</div>` : ''}
${story}
${record ? `<h2>The rules it judged by</h2><div class="say">${esc(record.instructions)}</div><h2>The judge</h2><p>${esc(record.attempts)} ${record.attempts === 1 ? 'attempt' : 'attempts'}. ${esc(turnProof(record.turns))}</p>` : ''}
<h2>Proof</h2><div class="scroll"><table>
<tr><td>Settlement on Sepolia</td><td>${chainLink('tx', status.tx)}</td></tr>
<tr><td>Audit record hash</td><td class="mono">${esc(status.record ?? 'none yet')}</td></tr>
<tr><td>0G Storage root</td><td class="mono">${esc(audit?.root ?? 'upload pending')}</td></tr>
<tr><td>JSON</td><td><a href="/judge/${esc(box)}/${esc(round)}?format=json">Status</a> · <a href="/audit/${esc(box)}/${esc(round)}">Audit</a></td></tr>
</table></div>`,
  );
}

export function missingPage(box: string, round: string): string {
  return page('No judgement', `<div class="kicker"><a href="/judge/${esc(box)}">${esc(box)}</a></div><h1>No judgement for round ${esc(round)}</h1><p class="lede">Only store games are judged, and this round has no judgement.</p>`);
}
