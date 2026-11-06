// Which view each phase of the Box shows, and how much of the machine stands behind it.
import type { Route, Routes } from "../shell/router.ts";
import type { TeamGameId } from "../../core/types.ts";
import { quickDrawScreen } from "../../games/quick-draw/screen.ts";
import { stockDuelScreen } from "../../games/stock-duel/screen.ts";
import { attractView } from "./attract.ts";
import { homeView } from "./home.ts";
import { joinView } from "./join.ts";
import { stakeView } from "./stake.ts";
import { resultView } from "./result.ts";
import { refundView } from "./refund.ts";
import { lobbyView } from "./lobby.ts";
import { builderView } from "./builder.ts";
import { frameView } from "../frame/view.ts";
import { builtMatch } from "../frame/feed.ts";
import { isTeamGame } from "../../core/catalogue.ts";

/** A built game's screen: its own, in the sandboxed frame. */
const builtScreen = frameView(builtMatch);

/** A team game's screen, from the stakes going in to the end of its match. Every match passes through Stake or Home
 * before the next, so the key changes between matches. Stock Duel draws its own top band (players, score, pot); Quick
 * Draw plays under the machine's thin overlay. */
function teamRoute(game: TeamGameId): Route {
  return game === "stock-duel"
    ? { key: "team-stock-duel", pose: "full", view: stockDuelScreen }
    : { key: "team-quick-draw", pose: "game", view: quickDrawScreen };
}

export const routes: Routes = (state) => {
  switch (state.phase) {
    case "boot":
      return { key: "boot", pose: "home", view: null };
    case "attract":
      return { key: "attract", pose: "home", view: attractView };
    case "home":
      return { key: "home", pose: "home", view: homeView };
    case "join":
      return { key: "join", pose: "page", view: joinView };
    case "stake": {
      // Both signed for a team game: its stakes are going into the pot, and the game's own screen shows the wait (the
      // gunslingers pace out, the market's pre-open). The key is the one the match will play under, so the same
      // screen carries on into it without a move.
      const focus = state.focus;
      if (isTeamGame(focus) && state.seats.every((s) => s.signed)) return teamRoute(focus);
      return { key: "stake", pose: "page", view: stakeView };
    }
    case "playing": {
      const game = state.match?.play.game;
      if (game === "quick-draw" || game === "stock-duel") return teamRoute(game);
      return { key: `play-${state.match?.id ?? 0}`, pose: "game", view: builtScreen };
    }
    case "result":
      return { key: "result", pose: "page", view: resultView };
    case "refund":
      return { key: "refund", pose: "page", view: refundView };
    case "build":
      return { key: "build", pose: "page", view: builderView };
    case "lobby":
      return { key: "lobby", pose: "page", view: lobbyView };
  }
};
