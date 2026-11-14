import assert from "node:assert/strict";
import test from "node:test";
import { redactSignedUrls } from "./wrangler.mjs";

test("D1エクスポートの署名付きURLを失敗ログから取り除く", () => {
  assert.equal(redactSignedUrls("Download https://example.com/export.sql?X-Amz-Signature=secret failed"), "Download [redacted URL] failed");
  assert.equal(redactSignedUrls("See https://developers.cloudflare.com/d1/"), "See https://developers.cloudflare.com/d1/");
});
