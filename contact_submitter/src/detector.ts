import { FrameLocator, Locator, Page } from "playwright";

const FORM_ROOTS = [
  "form",
  "[role=form]",
  ".contact-form",
  ".wpcf7-form",
  ".mw_wp_form",
  ".hs-form",
  ".mktoForm",
  ".elementor-form"
];

const SUBMIT_BUTTONS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("送信")',
  'button:has-text("Submit")',
  'button:has-text("Send")',
];

export type FormCandidate = {
  root: Locator;
  score: number;
  frame?: FrameLocator;
};

export async function findFormCandidates(page: Page): Promise<FormCandidate[]> {
  const out: FormCandidate[] = [];

  // ページ直下
  for (const sel of FORM_ROOTS) {
    const els = page.locator(sel);
    const count = await els.count();
    for (let i = 0; i < count; i++) {
      const root = els.nth(i);
      out.push({ root, score: await scoreForm(root) });
    }
  }

  // iframe内（HubSpot 等）
  const ifrCount = await page.locator('iframe').count();
  for (let i = 0; i < ifrCount; i++) {
    const fl = page.frameLocator(`iframe:nth-of-type(${i + 1})`);
    for (const sel of FORM_ROOTS) {
      const els = fl.locator(sel);
      const cnt = await els.count();
      for (let k = 0; k < cnt; k++) {
        const root = els.nth(k);
        out.push({ root, score: await scoreForm(root), frame: fl });
      }
    }
  }

  // formタグが無い「フォーム状ブロック」の救済
  const blocks = page.locator("section, div, form").filter({
    has: page.locator("input, textarea, select"),
    hasNot: page.locator('input[type="password"], input[type="search"]')
  });
  const bCount = await blocks.count();
  for (let i = 0; i < bCount; i++) {
    const root = blocks.nth(i);
    const s = await scoreForm(root);
    if (s >= 25) out.push({ root, score: s });
  }

  // ランキング
  out.sort((a, b) => b.score - a.score);
  return out;
}

async function scoreForm(root: Locator): Promise<number> {
  let s = 0;
  if (await root.locator('input[type="email"]').count() > 0) s += 25;
  if (await root.locator("textarea").count() > 0) s += 20;

  for (const b of SUBMIT_BUTTONS) {
    if (await root.locator(b).count() > 0) { s += 10; break; }
  }
  // 反証
  if (await root.locator('input[type="password"]').count() > 0) s -= 40;
  if (await root.locator('input[type="search"]').count() > 0) s -= 20;
  return s;
}
