import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axePath = require.resolve(process.env.AXE_MODULE || "axe-core");

export async function checkAccessibility(page, label) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    }));
  });
  assert.deepEqual(violations, [], `${label}: accessibility violations`);
}

export async function checkTouchLayout(page, label) {
  const issues = await page.evaluate(() => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const controls = [...document.querySelectorAll("button:not(.node), .main-nav a, summary, input:not([type=checkbox]), select")]
      .filter(visible);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      undersizedControls: controls.filter(element => {
        const { width, height } = element.getBoundingClientRect();
        return width < 44 || height < 44;
      })
        .map(element => element.getAttribute("aria-label") || element.textContent.trim()),
    };
  });
  assert.deepEqual(issues, { overflow: false, undersizedControls: [] }, `${label}: responsive touch layout`);
}
