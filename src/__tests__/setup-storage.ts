import { JSDOM } from "jsdom";

// Node 25 以降は globalThis.localStorage を持つが、保存先ファイルを指定しないと undefined になり、
// vitest の jsdom 環境の localStorage を隠してしまう。UI のテストでは jsdom の Storage を使う
const { window } = new JSDOM("", { url: "http://localhost:3000/" });
Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
