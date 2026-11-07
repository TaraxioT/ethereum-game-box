// The project's public pages, for any page that links to the others: the browser demo's DEMO tag, the names site.

/** The browser demo: the Box's screen and core in a browser, simulated, nothing on chain. */
export const DEMO_URL = 'https://ethereum-game-box.pages.dev/';
/** The names site: the ENS names under gamebox.eth on Sepolia, and what the Boxes wrote to them. */
export const NAMES_SITE_URL = 'https://gamebox-names.pages.dev';
/** The operator site: an operator signs in with a passkey and edits its Box's keys. */
export const OPERATOR_SITE_URL = 'https://gamebox-operator.pages.dev';
/** The project plan. */
export const PLAN_URL = 'https://plans.georgekm.com/ethereum-game-box-2026-11-05/';
/** The source. */
export const SOURCE_URL = 'https://github.com/TaraxioT/ethereum-game-box';

export interface Site {
  /** A short label, a word or two. */
  readonly label: string;
  readonly url: string;
}

/** The names site's pages, in its own menu's order. */
export const NAMES_SITE_PAGES: readonly Site[] = [
  { label: 'Tree', url: `${NAMES_SITE_URL}/#/` },
  { label: 'Players', url: `${NAMES_SITE_URL}/#/players` },
  { label: 'Lobby', url: `${NAMES_SITE_URL}/#/lobby` },
  { label: 'Titles', url: `${NAMES_SITE_URL}/#/champions` },
  { label: 'Cups', url: `${NAMES_SITE_URL}/#/championships` },
  { label: 'Boxes', url: `${NAMES_SITE_URL}/#/boxes` },
  { label: 'Agent', url: `${NAMES_SITE_URL}/#/agent` },
];

/** The project's other pages. */
export const PROJECT_SITES: readonly Site[] = [
  { label: 'Operator', url: OPERATOR_SITE_URL },
  { label: 'Plan', url: PLAN_URL },
  { label: 'Source', url: SOURCE_URL },
];
