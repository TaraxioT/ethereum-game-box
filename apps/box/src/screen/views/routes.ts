// Which view each phase of the Box shows, and how much of the machine stands behind it.
import type { Routes } from "../shell/router.ts";
import { quickDrawScreen } from "../../games/quick-draw/screen.ts";
import { stockDuelScreen } from "../../games/stock-duel/screen.ts";
import { attractView } from "./attract.ts";
import { homeView } from "./home.ts";
import { joinView } from "./join.ts";
import { stakeView } from "./stake.ts";
import { resultView } from "./result.ts";
import { refundView } from "./refund.ts";
import { builderView } from "./builder.ts";

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
    case "stake":
      return { key: "stake", pose: "page", view: stakeView };
    case "playing":
      return state.match?.game === "stock-duel"
        ? { key: `play-${state.match.id}`, pose: "game", view: stockDuelScreen }
        : { key: `play-${state.match?.id ?? 0}`, pose: "game", view: quickDrawScreen };
    case "result":
      return { key: "result", pose: "page", view: resultView };
    case "refund":
      return { key: "refund", pose: "page", view: refundView };
    case "build":
      return { key: "build", pose: "page", view: builderView };
  }
};
