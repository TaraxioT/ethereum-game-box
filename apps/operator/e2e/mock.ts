// What the Playwright run talks to in place of Sepolia and the relayer: a small chain that answers the reads the site
// makes (`accountOf`, `hasRole`, `getBox`, a resolver's `resolve`, `BoxRegistered` and `GameAdded` logs, `getCode`),
// and a relayer that records each request and answers it `done`. Requests a test checks are kept in `posted`.
import type { Page, Route } from "@playwright/test";
import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  keccak256,
  concat,
  pad,
  slice,
  toHex,
} from "viem";
import {
  GAME_BOX_ROLES,
  type DeployAccountRequest,
  type ExecuteRequest,
  gameBoxNamesAbi,
  p256AccountFactoryAbi,
  permissionedResolverAbi,
  resolverProfilesAbi,
} from "@egb/shared/names";

import deployments from "./deployments.json" with { type: "json" };

export const FACTORY = getAddress(deployments.contracts.P256AccountFactory.address);
export const NAMES = getAddress(deployments.contracts.GameBoxNames.address);
export const RESOLVER = getAddress("0x000000000000000000000000000000000000e5e5");
const HEAD = 1_100n;

/** The mock factory's `accountOf`: any fixed function of the key does. */
export function mockAccountOf(qx: Hex, qy: Hex): Address {
  return getAddress(slice(keccak256(concat([qx, qy])), 12));
}

export interface MockBox {
  label: string;
  operator: Address;
  account: Address;
  qx: Hex;
  qy: Hex;
  status: number;
  expiry: bigint;
  records: Record<string, string>;
}

export class MockChain {
  readonly deployed = new Set<string>();
  readonly licensors = new Set<string>();
  readonly boxes: MockBox[] = [];
  readonly posted: { path: string; body: ExecuteRequest | DeployAccountRequest }[] = [];
  /** Runs when the relayer takes an execute, to apply its effect. */
  onExecute: (body: ExecuteRequest) => void = () => {};
  private txs = 0;

  async install(page: Page): Promise<void> {
    await page.route("https://rpc.test/**", (route) => this.rpc(route));
    await page.route("https://relayer.test/**", (route) => this.relayer(route));
  }

  private cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };

  private reply(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, headers: { ...this.cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  private async rpc(route: Route) {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: this.cors });
    const request = route.request().postDataJSON() as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const answer = (one: { id: number; method: string; params: unknown[] }) => {
      try {
        return { jsonrpc: "2.0", id: one.id, result: this.call(one.method, one.params) };
      } catch (err) {
        return { jsonrpc: "2.0", id: one.id, error: { code: -32000, message: String(err) } };
      }
    };
    return this.reply(route, 200, Array.isArray(request) ? request.map(answer) : answer(request));
  }

  private call(method: string, params: unknown[]): unknown {
    switch (method) {
      case "eth_chainId":
        return toHex(deployments.chainId);
      case "eth_blockNumber":
        return toHex(HEAD);
      case "eth_getCode":
        return this.deployed.has(getAddress(params[0] as string)) ? "0x6000" : "0x";
      case "eth_call":
        return this.ethCall(params[0] as { to: Address; data: Hex });
      case "eth_getLogs":
        return this.logs(params[0] as { address: Address; topics: (Hex | null)[] });
      default:
        throw new Error(`mock chain: ${method}`);
    }
  }

  private ethCall({ to, data }: { to: Address; data: Hex }): Hex {
    const target = getAddress(to);
    if (target === FACTORY) {
      const { args } = decodeFunctionData({ abi: p256AccountFactoryAbi, data });
      return encodeFunctionResult({ abi: p256AccountFactoryAbi, functionName: "accountOf", result: mockAccountOf(args[0] as Hex, args[1] as Hex) });
    }
    if (target === NAMES) {
      const call = decodeFunctionData({ abi: gameBoxNamesAbi, data });
      if (call.functionName === "hasRole") {
        const [role, account] = call.args;
        return encodeFunctionResult({ abi: gameBoxNamesAbi, functionName: "hasRole", result: role === GAME_BOX_ROLES.LICENSOR_ROLE && this.licensors.has(account) });
      }
      if (call.functionName === "getBox") {
        const box = this.boxes.find((b) => b.label === call.args[0]);
        const zero = pad("0x0");
        return encodeFunctionResult({
          abi: gameBoxNamesAbi,
          functionName: "getBox",
          result: box
            ? { operator: box.operator, account: box.account, qx: box.qx, qy: box.qy, status: box.status, resolver: RESOLVER, expiry: box.expiry }
            : { operator: getAddress(pad("0x0", { size: 20 })), account: getAddress(pad("0x0", { size: 20 })), qx: zero, qy: zero, status: 0, resolver: getAddress(pad("0x0", { size: 20 })), expiry: 0n },
        });
      }
    }
    if (target === RESOLVER) {
      const { args } = decodeFunctionData({ abi: permissionedResolverAbi, data });
      const [name, inner] = args as [Hex, Hex];
      const label = Buffer.from(name.slice(4, 4 + 2 * parseInt(name.slice(2, 4), 16)), "hex").toString();
      const text = decodeFunctionData({ abi: resolverProfilesAbi, data: inner });
      const key = (text.args as [Hex, string])[1];
      const value = this.boxes.find((b) => b.label === label)?.records[key] ?? "";
      const result = encodeFunctionResult({ abi: resolverProfilesAbi, functionName: "text", result: value });
      return encodeFunctionResult({ abi: permissionedResolverAbi, functionName: "resolve", result });
    }
    throw new Error(`mock chain: eth_call to ${to}`);
  }

  private logs({ address, topics }: { address: Address; topics: (Hex | null)[] }) {
    if (getAddress(address) !== NAMES) return [];
    const registered = getAbiItem({ abi: gameBoxNamesAbi, name: "BoxRegistered" });
    const added = getAbiItem({ abi: gameBoxNamesAbi, name: "GameAdded" });
    const log = (topics: Hex[], data: Hex, i: number) => ({
      address: NAMES,
      topics,
      data,
      blockNumber: toHex(1_001n),
      blockHash: pad("0xb1"),
      transactionHash: pad(toHex(i + 1)),
      transactionIndex: "0x0",
      logIndex: toHex(i),
      removed: false,
    });
    const [topic0, , operatorTopic] = topics;
    if (topic0 === encodeEventTopics({ abi: [added] })[0]) {
      return ["stockduel", "quickdraw"].map((label, i) =>
        log(encodeEventTopics({ abi: [added] }) as Hex[], encodeAbiParameters([{ type: "string" }, { type: "address" }, { type: "uint64" }], [label, RESOLVER, 900n]), i),
      );
    }
    return this.boxes
      .filter((box) => !operatorTopic || operatorTopic.toLowerCase() === pad(box.operator).toLowerCase())
      .map((box, i) =>
        log(
          encodeEventTopics({ abi: [registered], args: { operator: box.operator, account: box.account } }) as Hex[],
          encodeAbiParameters(
            [{ type: "string" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
            [box.label, RESOLVER, box.qx, box.qy, box.expiry],
          ),
          i,
        ),
      );
  }

  private async relayer(route: Route) {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: this.cors });
    const path = new URL(request.url()).pathname;
    const done = (kind: string) => {
      this.txs += 1;
      return { id: `t${this.txs}`, kind, status: "done", hash: pad(toHex(0xabc000 + this.txs)), block: Number(HEAD) };
    };
    if (path === "/health") {
      return this.reply(route, 200, { address: getAddress(pad("0x9", { size: 20 })), balance: "100000000000000000", pending: 0, block: Number(HEAD), tipGwei: "1" });
    }
    if (path === "/account/deploy") {
      const body = request.postDataJSON() as DeployAccountRequest;
      this.posted.push({ path, body });
      this.deployed.add(mockAccountOf(body.qx, body.qy));
      return this.reply(route, 202, done("deploy"));
    }
    if (path === "/account/execute") {
      const body = request.postDataJSON() as ExecuteRequest;
      this.posted.push({ path, body });
      if (!this.deployed.has(getAddress(body.account))) return this.reply(route, 400, { error: "account not deployed" });
      this.onExecute(body);
      return this.reply(route, 202, done("execute"));
    }
    return this.reply(route, 404, { error: "not found" });
  }
}
