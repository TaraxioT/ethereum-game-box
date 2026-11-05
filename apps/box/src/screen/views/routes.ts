// Which view each phase of the Box shows, and how much of the machine stands behind it.
import type { Routes } from "../shell/router.ts";
import { attractView } from "./attract.ts";
import { homeView } from "./home.ts";

export const routes: Routes = (state) => {
  switch (state.phase) {
    case "boot":
      return { key: "boot", pose: "home", view: null };
    case "attract":
      return { key: "attract", pose: "home", view: attractView };
    default:
      return { key: "home", pose: "home", view: homeView };
  }
};
