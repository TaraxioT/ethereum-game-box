// The hostile game's screen: nothing to see. Typed by the one property it uses, so it compiles without the DOM.
const screen = {
  mount(root: { textContent: string | null }) {
    root.textContent = "hostile";
    return { update() {} };
  },
};

export default screen;
