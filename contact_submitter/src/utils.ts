import { Page } from "playwright";
import { cfg } from "./config.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";


export async function neutralizeOverlays(page: Page) {
  // 1) CSSで pointer-events を殺す（最も確実）
  await page.addStyleTag({
	content: `
	  /* MailPoet / 一般的なポップアップ */
	  .mailpoet_form_popup_overlay,
	  .mailpoet_form_popup,
	  .mpopup-overlay,
	  .popup-overlay,
	  .modal-backdrop,
	  .remodal-overlay,
	  .remodal-wrapper,
	  .pum-overlay,
	  .pum-container,
	  .mfp-bg,
	  .mfp-wrap,
	  div[class*="overlay"][class*="active"],
	  div[id*="overlay"][class*="active"] {
		pointer-events: none !important;
	  }
	`,
  });

  // 2) 典型的な close/overlay をクリック（閉じられるタイプ）
  const closers = [
	'.mailpoet_form_popup_close',
	'.mailpoet_close',
	'.pum-close',
	'.mfp-close',
	'.modal-close, .close, button[aria-label="Close"]',
	'.mailpoet_form_popup_overlay',
	'.pum-overlay',
	'.mfp-bg',
  ];
  for (const sel of closers) {
	const el = page.locator(sel).first();
	if (await el.count()) {
	  try { await el.click({ timeout: 1000 }).catch(() => {}); } catch {}
	}
  }

  // 3) ESCで閉じるタイプ
  try { await page.keyboard.press("Escape"); } catch {}

  // 4) それでも残る強硬派は remove() で DOM から削除
  await page.evaluate(() => {
	const killers = [
	  '.mailpoet_form_popup_overlay',
	  '.mailpoet_form_popup',
	  '#mp_form_popup1',
	  '.pum-overlay', '.pum-container',
	  '.mfp-bg', '.mfp-wrap',
	  '.modal-backdrop', '.remodal-overlay', '.remodal-wrapper',
	];
	for (const sel of killers) {
	  document.querySelectorAll(sel).forEach(n => n.remove());
	}
  });
}

export async function screenshotOnFail(page: Page, id: string) {
  try {
	const dir = cfg.screenshotDir;
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${id}.jpg`);
	await page.screenshot({ path, type: "jpeg", quality: 80, fullPage: false });
	return path;
  } catch {
	return undefined;
  }
}