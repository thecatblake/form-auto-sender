import { Locator } from "playwright";
import { logger } from "./logger";

export type SubmitPayload = {
  // 氏名
  name?: string; // 「姓 名」や「名 姓」でもOK（半角/全角スペース分割）
  kana?: string;
  sei?: string;
  mei?: string;
  sei_kana?: string;
  mei_kana?: string;
  furigana_mei?: string;
  furigana_sei?: string;

  // 企業
  company?: string;
  department?: string;
  title?: string;

  // 連絡
  email?: string;
  phone?: string;                 // 03-xxxx-xxxx など
  phone_parts?: [string, string, string]; // 3分割で指定したい場合

  // 住所
  zip?: string;
  post_code?: string;
  prefecture?: string;
  address1?: string;
  address2?: string;

  // 問い合わせ
  subject?: string;
  message?: string;
  type?: string;                  // セレクトに合わせる（例: "資料請求"）

  // 同意
  agree?: boolean;                // 省略時はtrue相当でチェック
};

const Rx = {
    // 氏名系
    name: /(お名前|氏名|ご担当者名|代表者名|name|full\s*name|contact\s*name)/i,
    kana: /(フリガナ|kana)/i,
    family: /(姓|氏|last\s*name|surname|family\s*name|sei)/i,
    given: /((?<!sur)名|first\s*name|given\s*name|mei)/i,
    familyKana: /(セイ|ｾｲ|フリガナ.*セイ|カナ.*セイ|^(?=.*sei)(?=.*kana).*$|^(?=.*last)(?=.*kana).*$)/i,
    givenKana: /(メイ|ﾒｲ|フリガナ.*メイ|カナ.*メイ|^(?=.*mei)(?=.*kana).*$|^(?=.*first)(?=.*kana).*$)/i,

    // 企業/所属
    company: /(会社名|法人名|御社名|貴社名|団体名|company(\s*name)?|organization|organisation|corp|corporation|business|employer|firm)/i,
    department: /(部署|所属|部門|department|division|team)/i,
    title: /(役職|肩書|職位|title|position|job\s*title|role)/i,

    // 連絡先
    email: /(メール(アドレス)?|e-?mail|email\s*address)/i,
    emailConfirm: /(確認.*メール|メール.*確認|retype|confirm(ation)?|verify|repeat|confirm\s*email)/i,
    phone: /(電話(番号)?|TEL|携帯(番号)?|phone(\s*number)?|telephone|mobile|cell(ular)?)/i,

    // 住所
    zip: /(郵便番号|〒|ZIP|postal(\s*code)?|post\s*code|zip(\s*code)?)/i,
    prefecture: /(都道府県|prefecture|province|state|region)/i,
    address1: /(住所|市区町村|番地|address(\s*line)?\s*1?|street(\s*address)?|add)/i,
    address2: /(建物名|マンション名|建物|ﾏﾝｼｮﾝ|address\s*line\s*2|building|apt|apartment|suite|unit|room)/i,
    city: /(市|区|町|村|city|town|ward|district)/i,

    // 問い合わせ内容
    subject: /(件名|題名|タイトル|subject|title|topic)/i,
    message: /(お問い合わせ(内容)?|内容|メッセージ|ご用件|ご質問|ご相談|詳細|message|inquiry|enquiry|description|details|comments?|body|content)/i,
    type: /(種別|種類|区分|目的|category|type|kind|purpose|reason|topic)/i,

    // 同意
    consent: /(同意|承諾|確認しました|プライバシ|個人情報|利用規約|privacy\s*policy|terms|I\s*agree|agree|accept|consent|affirmation)/i,

    // ハニーポットっぽいname/id
    honeypotName: /(honeypot|hp_|_hp|_confirm$|website_url|url|homepage)/i,
};

async function isFilled(locator: Locator) {
    const value = await locator.inputValue();
    return value.trim().length > 0
}

async function safe(action: () => Promise<any>) {
    try {
        return await action();
    } catch (e) {
        console.warn("safe() ignored error:", e);
    }
}

async function getFieldHint(input: Locator): Promise<string> {
    return (
        [
            await safe(() => input.getAttribute("name")),
            await safe(() => input.getAttribute("id")),
            await safe(() => input.getAttribute("placeholder")),
            await safe(() => input.getAttribute("aria-label")),
            await safe(() => input.getAttribute("class")),
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
    );
}

export async function fillFields(root: Locator, payload: SubmitPayload) {
    const input_locators = await root.locator("input:visible").all();

    for (const input_locator of input_locators) {
        const already = await safe(() => isFilled(input_locator));
        if (already) continue;

        const raw_input =
            (await safe(() =>
                input_locator.evaluate(el => el.outerHTML)
            )) ?? "";

        const hint = await getFieldHint(input_locator);

        let handled = false;

        // --- 共通で使う小さいヘルパ ---
        const logAndFill = async (fieldName: string, value: string | undefined) => {
            // ログ出す（必要なら JSON にしても OK）
            logger.info({
                event: "fill_field",
                field: fieldName,
                value,
                hint,
                raw_input
            });

            await safe(() => input_locator.fill(value ?? ""));
        };

        // --- 会社名 ---
        if (!handled && Rx.company.test(hint)) {
            await logAndFill("company", payload.company);
            handled = true;
        }

        // --- address1 ---
        if (
            !handled &&
            (
                /\bname=["']?add["']?\b/i.test(raw_input) ||
                /\badd\b/.test(hint) ||
                Rx.address1.test(hint)
            )
        ) {
            await logAndFill("address1", payload.address1);
            handled = true;
        }

        // --- address2 ---
        if (!handled && Rx.address2.test(hint)) {
            await logAndFill("address2", payload.address2);
            handled = true;
        }

        // --- 名（カナ） ---
        if (!handled && Rx.givenKana.test(hint)) {
            const v = payload.mei_kana ?? payload.furigana_mei;
            await logAndFill("mei_kana", v);
            handled = true;
        }

        // --- 名 ---
        if (!handled && Rx.given.test(hint)) {
            await logAndFill("mei", payload.mei);
            handled = true;
        }

        // --- 姓（カナ） ---
        if (!handled && Rx.familyKana.test(hint)) {
            const v = payload.sei_kana ?? payload.furigana_sei;
            await logAndFill("sei_kana", v);
            handled = true;
        }

        // --- 姓 ---
        if (!handled && Rx.family.test(hint)) {
            await logAndFill("sei", payload.sei);
            handled = true;
        }

        // --- メール ---
        if (!handled && Rx.email.test(hint)) {
            await logAndFill("email", payload.email);
            handled = true;
        }
        if (!handled && Rx.emailConfirm.test(hint)) {
            await logAndFill("email_confirm", payload.email);
            handled = true;
        }

        // --- 郵便番号 ---
        if (!handled && Rx.zip.test(hint)) {
            const v = payload.zip ?? payload.post_code;
            await logAndFill("zip", v);
            handled = true;
        }

        // --- 電話 ---
        if (!handled && Rx.phone.test(hint)) {
            await logAndFill("phone", payload.phone);
            handled = true;
        }

        // --- 都道府県 ---
        if (!handled && Rx.prefecture.test(hint)) {
            await logAndFill("prefecture", payload.prefecture);
            handled = true;
        }

        // --- カナ（氏名まとめ） ---
        if (!handled && Rx.kana.test(hint)) {
            await logAndFill("kana", payload.kana);
            handled = true;
        }

        // --- 氏名 ---
        if (!handled && Rx.name.test(hint)) {
            await logAndFill("name", payload.name);
            handled = true;
        }

        // --- 同意チェック ---
        if (!handled && Rx.consent.test(hint)) {
            logger.info({
                event: "check_field",
                field: "consent",
                hint,
                raw_input
            });
            await safe(() => input_locator.check({ force: true }));
            handled = true;
        }

        if (handled) continue;
    }

    // ----- checkboxes -----
    const checkboxes = root.locator('input[type="checkbox"]');
    const count = (await safe(() => checkboxes.count())) || 0;

    for (let i = 0; i < count; i++) {
        logger.info({ event: "check_box", index: i });
        await safe(() => checkboxes.nth(i).check());
    }

    // ----- selects -----
    const selects = await root.locator('select, input[list]').all();
    for (const select of selects) {
        await safe(async () => {
            const option = select.locator("option").first();
            const value = await option.evaluate(el => el.getAttribute("value"));

            logger.info({
                event: "select_option",
                value
            });

            await select.selectOption(value ?? "");
        });
    }

    // ----- textarea -----
    const textarea_locators = await root.locator("textarea:visible").all();
    for (const textarea_locator of textarea_locators) {
        const raw_input =
            (await safe(() =>
                textarea_locator.evaluate(el => el.outerHTML)
            )) ?? "";

        if (Rx.message.test(raw_input)) {
            const msg = payload.message ?? "こんにちは世界";

            logger.info({
                event: "fill_textarea",
                field: "message",
                value: msg
            });

            await safe(() => textarea_locator.fill(msg));
        }
    }
}
