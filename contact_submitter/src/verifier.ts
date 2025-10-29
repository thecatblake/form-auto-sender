// successDetector.ts
import { Page } from "playwright";

/** ---- 1) 強力な成功ワード（日本語+英語） ---- */
const THANKS_TEXT = new RegExp([
  // JP: 送信系
  "(お問い合わせ|お問合せ|ご連絡|お申し込み|申込|応募|資料請求|見積|予約|ご注文|購入).*(完了|受け付け|受理|送信|ありがとうございました|ありがとうございます)",
  "(送信|応募|申込|登録|完了|受付)(が|を)?(完了|成功|しました|されました)",
  "(受付|受け付け)(完了|しました|いたしました)",
  "(ありがとうございました|ありがとうございます)",
  "(送信完了|受付完了|登録完了|送信成功|受付済み|送信が完了しました)",
  "(フォームの送信|エントリー).*(完了|成功)",
  "ご(依頼|連絡|質問)ありがとうございます",
  // EN: thank-you / confirmation
  "(thank\\s*you|thanks)",
  "(we('|’)?ll\\s*be\\s*in\\s*touch|we\\s*will\\s*contact\\s*you)",
  "(your\\s*(message|request|inquiry|enquiry|submission|form)\\s*(has\\s*been)?\\s*(sent|received|submitted|success))",
  "(submission\\s*complete|success|completed)",
  "(request\\s*received)",
].join("|"), "i");

/** ---- 2) URL/パス・クエリのサクセス兆候 ---- */
const SUCCESS_PATH = /(thank(s|-?you)?|thanks|complete(d)?|done|success|sent|submitted|contact(-|_)?(thanks|complete|done)|finish(ed)?)/i;
const SUCCESS_QUERY = /(\bstatus=(success|ok|done|sent)\b|\bsent=1\b|\bsuccess=1\b|\bsubmitted=1\b)/i;
const SUCCESS_HASH = /(thank|thanks|complete|done|success|sent|submitted)/i;

/** ---- 3) よくあるコンポーネント/ベンダ固有の成功UI ----
 *  - Contact Form 7: .wpcf7 form[data-status="sent"] / .wpcf7-mail-sent-ok
 *  - HubSpot: .submitted-message / .hs-form .hs-form__thank-you
 *  - Marketo: .mktoForm .mktoThankYou
 *  - Bootstrap/Alert: .alert-success, role=alert + THANKS_TEXT
 *  - Formrun: .formrun-...-success 的なクラスや[data-formrun-success]
 */
const SUCCESS_SELECTORS = [
  '.wpcf7 form[data-status="sent"]',
  ".wpcf7 .wpcf7-mail-sent-ok",
  ".submitted-message",
  ".hs-form__thank-you, .hs_cos_wrapper_type_rich_text:has-text('Thank')",
  ".mktoForm .mktoThankYou",
  '.alert.alert-success, .alert-success, [role="alert"].is-success',
  "[data-formrun-success], .formrun-success, .formrun-message--success",
  // 汎用：成功を示す要素のテキスト
  `:is([role="status"], [role="alert"], .message, .notice, .result, .status, .thank, .complete, .success)`,
];

/** ---- 4) 明確なエラー選好（これが在れば失敗寄り） ---- */
const ERROR_SELECTORS = [
  ".wpcf7 form[data-status='invalid']",
  ".wpcf7-not-valid-tip",
  "[aria-invalid='true']",
  ".error, .errors, .is-error, .has-error, .validation-error",
  ".alert-danger, .alert-error, .text-danger",
];
const CAPTCHA_SELECTORS = [
  ".g-recaptcha", "[data-sitekey]", "iframe[src*='recaptcha']",
  "[data-hcaptcha-response]", "iframe[src*='hcaptcha']",
];

/** ---- ユーティリティ ---- */
async function getVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = node.textContent?.trim();
        if (!t) return NodeFilter.FILTER_REJECT;
        // CSS的に非表示の親は弾く
        let el: HTMLElement | null = node.parentElement;
        while (el) {
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return NodeFilter.FILTER_REJECT;
          }
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const parts: string[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) parts.push(n.textContent!);
    return parts.join("\n");
  });
}

async function anySelector(page: Page, sels: string[]): Promise<boolean> {
  for (const s of sels) {
    const el = page.locator(s);
    try {
      if (await el.first().isVisible()) return true;
    } catch {}
  }
  return false;
}

function urlSuccessHeuristic(u: URL): boolean {
  return SUCCESS_PATH.test(u.pathname) || SUCCESS_QUERY.test(u.search) || SUCCESS_HASH.test(u.hash);
}

/** ==== メイン：多層成功判定 ==== */
export async function waitForSuccess(
  page: Page,
  opts?: { timeoutMs?: number; settleMs?: number }
): Promise<"success" | "maybe" | "fail"> {
  const timeoutMs = opts?.timeoutMs ?? 12000;   // 12s
  const settleMs  = opts?.settleMs  ?? 600;     // 送信直後の揺れ待ち

  // 1) ナビ or ネットワーク静穏を少し待つ
  try {
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: timeoutMs }).catch(() => null),
      page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => null),
    ]);
  } catch {}
  await page.waitForTimeout(settleMs);

  // 2) URLヒューリスティック
  try {
    const u = new URL(page.url());
    if (urlSuccessHeuristic(u)) return "success";
  } catch {}

  // 3) コンポーネント固有/ARIA 成功UI
  if (await anySelector(page, SUCCESS_SELECTORS)) {
    const t = (await getVisibleText(page));
    if (THANKS_TEXT.test(t)) return "success";
    // セレクタは立ってるが文言弱い時
    return "maybe";
  }

  // 4) ページ全文言スキャン
  const text = (await getVisibleText(page));
  if (THANKS_TEXT.test(text)) return "success";

  // 5) フォームが“明確に”エラーなら失敗寄り
  if (await anySelector(page, ERROR_SELECTORS)) return "fail";

  // 6) CAPTCHAに捕まっていれば失敗寄り
  if (await anySelector(page, CAPTCHA_SELECTORS)) return "fail";

  // 7) 送信ボタンがdisabled & 入力値がリセットされている等の“エビデンス薄い成功”
  //    → maybe に倒す。必要ならここに「必須inputが空に戻っているか」を入れてもよい
  const submitDisabled = await page.locator('button[type="submit"], input[type="submit"]').first().isDisabled().catch(() => false);
  if (submitDisabled) return "maybe";

  // 8) 何も拾えない
  return "fail";
}
