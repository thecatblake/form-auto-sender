import { chromium, Page, Locator } from "playwright";

interface ContactData {
  sei?: string;
  mei?: string;
  furigana_sei?: string;
  furigana_mei?: string;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  company?: string;
  department?: string;
  prefecture?: string;
  post_code?: string;
  address?: string;
}

const contactData: ContactData = {
  sei: "山田",
  mei: "太郎",
  furigana_sei: "ヤマダ",
  furigana_mei: "タロウ",
  name: "山本 太郎",
  email: "taro.yamada@example.com",
  phone: "03-1234-5678",
  subject: "ホームページを拝見いたしました。",
  message: "貴社のサービスについて、詳細をお伺いしたくご連絡いたしました。何卒よろしくお願い申し上げます。",
  company: "株式会社サンプル",
  department: "営業部",
  prefecture: "東京都",
  post_code: "100-0005",
  address: "千代田区丸の内１丁目９−２"
};

async function submitContactForm(url: string, data: ContactData): Promise<string> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    console.error(`Error navigating to ${url}:`, error);
    await browser.close();
    return "get failed";
  }

  let fieldsFilledCount = 0;
  try {
    const formLocator = page.locator("form").first();
    await formLocator.waitFor({ state: 'visible', timeout: 30000 });
    
    // Scroll the form into view if it's not already visible
    await formLocator.scrollIntoViewIfNeeded();
    
    const formElements = await formLocator.locator("input, textarea").all();

    if (formElements.length === 0) {
      console.warn("No form fields found within the form element.");
      await browser.close();
      return "contact not found";
    }

    for (const element of formElements) {
      // Scroll each element into view before attempting to interact with it
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
      } else if (/name|名前|なまえ/.test(combined) && data.name) {
        await element.fill(data.name);
        console.log("Filled name field.");
        fieldsFilledCount++;
      } else if (/post.?code|zip.?code|郵便番号|〒/.test(combined) && data.post_code) {
        await element.fill(data.post_code);
        console.log("Filled postcode field.");
        fieldsFilledCount++;
      } else if (/address|住所|番地/.test(combined) && data.address) {
        await element.fill(data.address);
        console.log("Filled address field.");
        fieldsFilledCount++;
      } else if (/email|メールアドレス/.test(combined) && data.email) {
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
      } else if (/message|content|enquiry|inquiry|comment/.test(combined) && data.message) {
        await element.fill(data.message);
        console.log("Filled message field.");
        fieldsFilledCount++;
      } else if (/company|organization|company.?name|会社名/.test(combined) && data.company) {
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
    }
    
    if (fieldsFilledCount === 0) {
      console.warn("No fields were filled.");
      await browser.close();
      return "contact not found";
    }

    console.log("Checking for confirmation checkboxes...");
    const checkboxes = await page.locator('input[type="checkbox"]').all();
    for (const checkbox of checkboxes) {
      await checkbox.scrollIntoViewIfNeeded();
      const checkboxText = await checkbox.evaluate(el => {
        let parent = el.parentElement;
        while (parent && !parent.textContent) {
          parent = parent.parentElement;
        }
        return parent?.textContent;
      });

      const combinedCheckboxText = (checkboxText || '' + (await checkbox.getAttribute('name')) || '' + (await checkbox.getAttribute('id')) || '').toLowerCase();
      
      if (/agree|terms|privacy|policy|規約|同意|個人情報|privacy policy/.test(combinedCheckboxText)) {
        console.log("Found and checking a confirmation checkbox.");
        await checkbox.check();
      }
    }
  } catch (error) {
    console.error("Error filling form fields or checking checkboxes:", error);
    await browser.close();
    return "filling failed";
  }

  try {
    const submitButton = page.locator('button[type="submit"], input[type="submit"], button[aria-label="送信"]');
    if (await submitButton.count() === 0) {
      console.warn("Submit button not found.");
      await browser.close();
      return "submit failed";
    }
    await submitButton.first().scrollIntoViewIfNeeded();
    await submitButton.first().click();
    console.log("Clicked submit button.");
  } catch (error) {
    console.error("Error submitting the form:", error);
    await browser.close();
    return "submit failed";
  }

  console.log("Form submitted successfully!");
  await browser.close();
  return "success";
}

(async () => {
  const status = await submitContactForm("https://shl-olive.co.jp/form/", contactData);
  console.log(`Operation status: ${status}`);
})();
