import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceNames = ["index.js", "buffer.js", "rewind.js", "shape.js"];

test("package metadata matches the contract", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "@aneron/rewind-buffer");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.author, "Vadim Gubin");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.engines, { node: ">=20" });
  assert.equal(pkg.main, "./src/index.js");
  assert.equal(pkg.exports, "./src/index.js");
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  assert.match(license, /Copyright \(c\) 2026 Vadim Gubin/);
});

test("the lockfile resolves only from the npm registry", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const resolved = [];
  collectResolved(lock, resolved);
  assert.ok(resolved.length > 0);
  for (const url of resolved) {
    assert.equal(url.startsWith("https://registry.npmjs.org/"), true, url);
  }
});

test("source files import only sibling modules and have no comments", () => {
  for (const name of sourceNames) {
    const source = readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
    const specifiers = source.match(/from "[^"]+"/g) ?? [];
    assert.ok(specifiers.length > 0 || !source.includes("import "));
    for (const specifier of specifiers) {
      assert.match(specifier, /^from "\.\/[a-z]+\.js"$/);
    }
    assert.equal(source.includes("node:"), false);
    assert.equal(source.includes("//"), false);
    assert.equal(source.includes("/*"), false);
  }
});

function collectResolved(node, resolved) {
  if (node == null || typeof node !== "object") {
    return;
  }
  if (typeof node.resolved === "string") {
    resolved.push(node.resolved);
  }
  for (const value of Object.values(node)) {
    if (value != null && typeof value === "object") {
      collectResolved(value, resolved);
    }
  }
}
