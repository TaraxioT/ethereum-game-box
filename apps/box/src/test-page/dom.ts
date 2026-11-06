// The few DOM helpers the test page needs: make an element, fill a table, and talk to the server.

type Child = Node | string | null | false;

/** An element with a class and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child !== null && child !== false) node.append(child);
  return node;
}

/** A button that runs `act` and disables itself until it is done. */
export function button(label: string, act: () => Promise<unknown> | void, className = ""): HTMLButtonElement {
  const b = h("button", className, label);
  b.type = "button";
  b.addEventListener("click", () => {
    b.disabled = true;
    void Promise.resolve()
      .then(act)
      .catch((error: unknown) => console.error(error))
      .finally(() => (b.disabled = false));
  });
  return b;
}

/** Replaces a table body's rows. */
export function rows(body: HTMLTableSectionElement, data: readonly (readonly (string | number)[])[]): void {
  body.replaceChildren(...data.map((cells) => h("tr", "", ...cells.map((cell) => h("td", "", String(cell))))));
}

export class ApiError extends Error {}

/** GET a route's JSON. */
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new ApiError(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** POST JSON to a route; its JSON answer, or null for none. */
export async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(`${res.status}: ${await res.text()}`);
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

/** Runs a request and writes its answer, or its error, into `out`. */
export async function show(out: HTMLElement, run: () => Promise<string>): Promise<void> {
  out.classList.remove("bad");
  out.textContent = "…";
  try {
    out.textContent = await run();
  } catch (error) {
    out.classList.add("bad");
    out.textContent = error instanceof Error ? error.message : String(error);
  }
}

export const ms = (n: number | null): string => (n === null ? "—" : `${n.toFixed(n < 10 ? 2 : 1)} ms`);
