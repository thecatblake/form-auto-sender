import { parentPort } from "worker_threads";
import { chromium, Browser, Page } from "playwright";
import type { ContactData } from "./types";

const sleep = async (milliseconds: number) => {
  return await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

async function isPageNotFound(page: Page): Promise<boolean> {
  const bodyText = (await page.textContent("body"))?.toLowerCase() || "";
  const notFoundKeywords = [
    "見つかりませんでした",
    "ページが見つかりません",
    "404",
    "not found",
    "お探しのページは存在しません",
    "ページは削除されました"
  ];
  return notFoundKeywords.some(keyword => bodyText.includes(keyword.toLowerCase()));
}

type Job = { url: string; contactData: ContactData; id: number };
type Result = { id: number; url: string; status: string };

let browser: Browser | null = null;

/** Launch a single Chromium instance per worker, reused for all jobs */
async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
    ],
  });
  return browser;
}


async function findContactPageUrl(url: string, page: Page): Promise<string | null | "page not found"> {

  try {
    console.log(`Searching for contact page starting from ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    if (await isPageNotFound(page)) {
      return "page not found";
    }

    // Look for anchors with contact keywords in href or text
    const anchors = await page.locator('a').all();

    for (const anchor of anchors) {
      const href = (await anchor.getAttribute('href'))?.toLowerCase() || "";
      const text = (await anchor.innerText())?.toLowerCase() || "";

      // Simple keyword check for contact page
      if (
        href.includes('contact') || href.includes('問い合わせ') || href.includes('連絡') ||
        text.includes('contact') || text.includes('問い合わせ') || text.includes('連絡先')
      ) {
        // Resolve relative URLs against base url
        const resolvedUrl = new URL(href, url).href;
        console.log(`Found contact page link: ${resolvedUrl}`);
        return resolvedUrl;
      }
    }

    console.warn("No contact page link found, using original URL.");
    return null;

  } catch (error) {
    console.error(`Error searching contact page:`, error);
    return null;
  }
}

export async function submitContactForm(url: string, data: ContactData, page: Page): Promise<string> {
  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    console.error(`Error navigating to ${url}:`, error);
    return "get failed";
  }

  let iframeElementHandle;
  try {
    iframeElementHandle = await page.$('iframe');

    if (!iframeElementHandle) {
      console.log('No iframe found!');
    }
  }
  catch {
    return "get failed";
  }


  if (!iframeElementHandle?.isVisible)
    iframeElementHandle?.scrollIntoViewIfNeeded();

  // Get the frame object associated with the iframe element
  const frame = await iframeElementHandle?.contentFrame();

  if (frame) {
    console.log("iframe found")
    await frame.waitForSelector('form');
  }

  let fieldsFilledCount = 0;
  try {
    let formLocators = await page.locator("form").all();

    if (formLocators.length === 0 && frame) {
      formLocators = await frame.locator("form").all();
    }
    else if (formLocators.length === 0)
      return "contact not found";
    console.log(`Found ${formLocators.length} form(s) on the page.`);
    const formLocator = formLocators[0];

    // if (!formLocator.isVisible)
    //   await formLocator.scrollIntoViewIfNeeded();

    const formElements = await formLocator.locator("input, textarea").all();

    if (formElements.length === 0) {
      console.warn("No form fields found within the form element.");
      
      return "contact not found";
    }

    for (const element of formElements) {
      if (!element.isVisible)
        await element.scrollIntoViewIfNeeded();

      const type = (await element.getAttribute("type"))?.toLowerCase() || "";
      const tagName = (await element.evaluate(el => el.tagName)).toLowerCase();
      const nameAttr = (await element.getAttribute("name"))?.toLowerCase() || "";
      const idAttr = (await element.getAttribute("id"))?.toLowerCase() || "";
      const placeholder = (await element.getAttribute("placeholder"))?.toLowerCase() || "";
      const id = await element.getAttribute("id");
      let labelText = "";
      if (id) {
        const label = formLocator.locator(`label[for="${id}"]`);
        if (await label.count()) {
          labelText = ((await label.innerText()) || "").toLowerCase();
        }
      }
      const combined = [type, tagName, nameAttr, idAttr, placeholder, labelText].join(" ");
      if (type === "hidden")
        continue;

      try {
        if (/(sei|lastname|last.?name|氏名|名字)/.test(combined) && !/furigana|フリガナ|ふりがな/.test(combined) && data.sei) {
          await element.fill(data.sei);
          console.log("Filled last name field.");
          fieldsFilledCount++;
        } else if (/(mei|firstname|first.?name|名前)/.test(combined) && !/furigana|フリガナ|ふりがな/.test(combined) && data.mei) {
          await element.fill(data.mei);
          console.log("Filled first name field.");
          fieldsFilledCount++;
        } else if (/(furigana_sei|furigana|フリガナ|ふりがな).*?(sei|名字)/.test(combined) && data.furigana_sei) {
          await element.fill(data.furigana_sei);
          console.log("Filled furigana last name field.");
          fieldsFilledCount++;
        } else if (/(furigana_mei|furigana|フリガナ|ふりがな).*?(mei|名前)/.test(combined) && data.furigana_mei) {
          await element.fill(data.furigana_mei);
          console.log("Filled furigana first name field.");
          fieldsFilledCount++;
        } else if (/manager|担当者/.test(combined) && data.manager) {
          await element.fill(data.manager);
          console.log("Filled name field.");
          fieldsFilledCount++;
        } else if (/name|名前|なまえ/.test(combined) && data.name) {
          await element.fill(data.name);
          console.log("Filled name field.");
          fieldsFilledCount++;
        } else if (/furigana|ふりがな/.test(combined) && data.furigana) {
          await element.fill(data.furigana);
          console.log("Filled name field.");
          fieldsFilledCount++;
        } else if (/kana|カナ|フリガナ/.test(combined) && data.kana) {
          await element.fill(data.kana);
          console.log("Filled name field.");
          fieldsFilledCount++;
        } else if (/post.?code|zip.?code|zip|郵便番号|〒/.test(combined) && data.post_code) {
          await element.fill(data.post_code);
          console.log("Filled postcode field.");
          fieldsFilledCount++;
        } else if (/address|住所|番地/.test(combined) && data.address) {
          await element.fill(data.address);
          console.log("Filled address field.");
          fieldsFilledCount++;
        } else if (/email|mail|メールアドレス/.test(combined) && data.email) {
          await element.fill(data.email);
          console.log("Filled email field.");
          fieldsFilledCount++;
        } else if (/phone|mobile|tel|電話番号/.test(combined) && data.phone) {
          await element.fill(data.phone);
          console.log("Filled phone field.");
          fieldsFilledCount++;
        } else if (/subject|title/.test(combined) && data.subject) {
          await element.fill(data.subject);
          console.log("Filled subject field.");
          fieldsFilledCount++;
        } else if (/message|content|enquiry|inquiry|comment|contact|naiyou|内容/.test(combined) && data.message) {
          await element.fill(data.message);
          console.log("Filled message field.");
          fieldsFilledCount++;
        } else if (/company|organization|company.?name|group|会社/.test(combined) && data.company) {
          await element.fill(data.company);
          console.log("Filled company field.");
          fieldsFilledCount++;
        } else if (/department|division|部署名/.test(combined) && data.department) {
          await element.fill(data.department);
          console.log("Filled department field.");
          fieldsFilledCount++;
        } else if (/prefecture|都道府県/.test(combined) && data.prefecture) {
          await element.selectOption({ label: data.prefecture });
          console.log("Selected prefecture.");
          fieldsFilledCount++;
        }
      } catch (error) {
        console.log(error);
      }
    }
    
    
    if (fieldsFilledCount === 0) {
      console.warn("No fields were filled.");
      
      return "contact not found";
    }
    

    try {
      const selectElements = await formLocator.locator("select").all();
      for (const select of selectElements) {
        const options = await select.locator("option").all();
        let selected = false;

        
        for (const option of options) {
          const text = (await option.textContent())?.trim() || "";
          if (text.includes("問い合わせ")) {
            await select.selectOption({ label: text });
            console.log(`Selected option with '問い合わせ': ${text}`);
            selected = true;
            break;
          }
        }

        if (!selected && options.length > 1) {
          const randomIndex = Math.floor(Math.random() * options.length);
          let text = (await options[randomIndex].textContent())?.trim() || "";
          if (!text) {
            // If randomly picked empty option, pick the first non-empty one
            const nonEmpty = await Promise.all(
              options.map(async (o) => (await o.textContent())?.trim() || "")
            );
            const nonEmptyOptions = nonEmpty.filter((t) => t);
            if (nonEmptyOptions.length > 0) {
              text = nonEmptyOptions[0];
            }
          }
          if (text) {
            await select.selectOption({ label: text });
            console.log(`Selected random option: ${text}`);
          }
        }
      }

    } catch (error) {

    }
    const checkboxes = await formLocator.locator('input[type="checkbox"]').all();

    for (const checkbox of checkboxes) {
      try {
        // Try direct click
        await checkbox.click({ force: true });
        console.log("Checked checkbox directly.");
      } catch {
        console.warn("Could not check checkbox directly. Trying label...");

        // Try clicking associated label
        const id = await checkbox.getAttribute('id');
        if (id) {
          const label = formLocator.locator(`label[for="${id}"]`);
          if (await label.count()) {
            await label.first().click({ force: true });
            console.log(`Checked checkbox via label[for="${id}"].`);
          } else {
            console.warn(`No label found for checkbox with id: ${id}`);
          }
        } else {
          // Try clicking the nearest parent label
          const parentLabel = checkbox.locator('xpath=ancestor::label[1]');
          if (await parentLabel.count()) {
            await parentLabel.first().click({ force: true });
            console.log("Checked checkbox via parent label.");
          } else {
            console.warn("No clickable label found for checkbox without id.");
          }
        }
      }
    }
    try {
      const radios = await formLocator.locator('input[type="radio"]').all();
      if (radios.length > 0) {
        let selected = false;

        for (const radio of radios) {
          const valueAttr = (await radio.getAttribute("value")) || "";
          const idAttr = (await radio.getAttribute("id")) || "";
          let labelText = "";

          if (idAttr) {
            const label = page.locator(`label[for="${idAttr}"]`);
            if (await label.count()) {
              labelText = (await label.innerText()) || "";
            }
          }

          const combinedText = `${valueAttr} ${labelText}`.toLowerCase();

          if (combinedText.includes("問い合わせ") || combinedText.includes("その他")) {
            if (!(await radio.isVisible())) {
              await radio.scrollIntoViewIfNeeded();
            }
            await radio.check({ force: true });
            console.log(`Selected radio: ${labelText || valueAttr}`);
            selected = true;
            break;
          }
        }

        if (!selected) {
          const randomIndex = Math.floor(Math.random() * radios.length);
          const radio = radios[randomIndex];
          if (!(await radio.isVisible())) {
            await radio.scrollIntoViewIfNeeded();
          }
          await radio.check({ force: true });
          console.log("Selected a random radio button.");
        }
      }
    } catch (error) {

    }

    await sleep(2000);

    try {
        const submitButton = formLocator.locator(
          'button[type="submit"], input[type="submit"], button[aria-label="送信"], button[alt="送信"], input[aria-label="送信"], input[alt="送信"], button:has-text("送信"), input:has-text("送信")'
        );

      if (await submitButton.count() === 0) {
        console.warn("Submit button not found.");
        
        return "submit failed";
      }
      let _b1 = submitButton.filter({ hasText: /^(?!.*(戻る|修正)).*(送信|確認).*/ })
      if (!_b1.last().isVisible())
        await _b1.last().scrollIntoViewIfNeeded();
      if (await _b1.count() != 0)
        await _b1.first().click();
      console.log("Clicked submit button.");

      await sleep(5000);

      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

      let bodyText = await page.textContent("body");
      let successKeywords = ["成功", "送信しました", "送信され", "sent", "success", "完了しま", "受け付けました", "ありがとうござい"];
      let isSuccess = successKeywords.some(keyword =>
        (bodyText || "").toLowerCase().includes(keyword.toLowerCase())
      );

      if (isSuccess) {
        console.log("Form submission successful!");
        
        return "success";
      }

      const confirmButton = formLocator.locator(
        'button[type="submit"], input[type="submit"], button[aria-label="送信"], button[alt="送信"], input[aria-label="送信"], input[alt="送信"], button:has-text("送信"), input:has-text("送信")'
      );

      if (await confirmButton.count() > 0) {
        console.log("Confirmation page detected. Clicking second submit button...");
        if (!confirmButton.isVisible)
          await confirmButton.last().scrollIntoViewIfNeeded();
        let _b1 = confirmButton.filter({ hasText: /^(?!.*(戻る|修正)).*(送信|確認).*/ })
        if (await _b1.count() != 0)
          await _b1.last().click();
        await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      }

      await sleep(3000);

      bodyText = await page.textContent("body");
      successKeywords = ["成功", "送信しました", "送信され", "sent", "success", "完了しま", "受け付けました", "ありがとうござい"];
      isSuccess = successKeywords.some(keyword =>
        (bodyText || "").toLowerCase().includes(keyword.toLowerCase())
      );

      if (isSuccess) {
        console.log("Form submission successful!");
        
        return "success";
      }

      const sendButton = formLocator.locator(
        'button[type="submit"], input[type="submit"], button[aria-label="送信"], button[alt="送信"], input[aria-label="送信"], input[alt="送信"], button:has-text("送信"), input:has-text("送信")'
      );

      if (await sendButton.count() > 0) {
        console.log("Confirmation page detected. Clicking second submit button...");
        if (!sendButton.isVisible)
          await sendButton.last().scrollIntoViewIfNeeded();
        let _b1 = sendButton.filter({ hasText: /^(?!.*(戻る|修正)).*(送信|確認).*/ })
        if (await _b1.count() != 0)
          await _b1.last().click();
        await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      }

      await sleep(3000);

      bodyText = await page.textContent("body");
      successKeywords = ["成功", "送信しました", "送信され", "sent", "success", "完了しま", "受け付けました", "ありがとうござい"];
      isSuccess = successKeywords.some(keyword =>
        (bodyText || "").toLowerCase().includes(keyword.toLowerCase())
      );

      if (isSuccess) {
        console.log("Form submission successful!");
        
        return "success";
      } else {
        console.warn("Success keyword not found on page.");
        
        return "submit failed";
      }

    } catch (error) {
      console.error("Error submitting the form:", error);
      
      return "submit failed";
    }
  } catch (error) {
    console.error("Error filling form fields or checking checkboxes:", error);
    
    return "filling failed";
  }
}


/** Handle incoming jobs */
async function handleJob(job: Job): Promise<Result> {
  const b = await ensureBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let targetUrl = job.url;
  let status = "get failed";
  try {
    const maybeContact = await findContactPageUrl(job.url, page);
    if (maybeContact === "page not found") {
      status = "page not found";
    } else {
      targetUrl = maybeContact || job.url;
      status = await submitContactForm(targetUrl, job.contactData, page);
    }
  } catch (e) {
    status = "error";
  } finally {
    await context.close().catch(() => {});
  }

  return { id: job.id, url: targetUrl, status };
}

parentPort?.on("message", async (job: Job) => {
  const res = await handleJob(job);
  parentPort?.postMessage(res);
});

process.on("beforeExit", async () => {
  await browser?.close().catch(() => {});
});