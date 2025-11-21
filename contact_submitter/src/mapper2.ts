import { Locator } from "playwright";
import { SubmitPayload } from "./mapper";

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

        const hint = await getFieldHint(input_locator); // ← 追加

        let handled = false;

        // --- 会社名 ---
        if (!handled && Rx.company.test(hint) /* 👈 hint に対して判定 */) {
            await safe(() => input_locator.fill(payload.company ?? ""));
            handled = true;
        }

        // --- address1（name="add" を強めに拾う）---
        if (
            !handled &&
            (
                /\bname=["']?add["']?\b/i.test(raw_input) ||    // name="add"
                /\badd\b/.test(hint) ||                        // hint に add 単体
                Rx.address1.test(hint)                         // 既存正規表現
            )
        ) {
            await safe(() => input_locator.fill(payload.address1 ?? ""));
            handled = true;
        }

        // --- address2 ---
        if (!handled && Rx.address2.test(hint)) {
            await safe(() => input_locator.fill(payload.address2 ?? ""));
            handled = true;
        }

        // 以下、他も raw_input → hint に差し替えていくと安定する
        if (!handled && Rx.givenKana.test(hint)) {
            await safe(() => input_locator.fill(payload.mei_kana ?? ""));
            handled = true;
        }

        if (!handled && Rx.given.test(hint)) {
            await safe(() => input_locator.fill(payload.mei ?? ""));
            handled = true;
        }

        if (!handled && Rx.familyKana.test(hint)) {
            await safe(() => input_locator.fill(payload.sei_kana ?? ""));
            handled = true;
        }

        if (!handled && Rx.family.test(hint)) {
            await safe(() => input_locator.fill(payload.sei ?? ""));
            handled = true;
        }

        if (!handled && Rx.email.test(hint)) {
            await safe(() => input_locator.fill(payload.email ?? ""));
            handled = true;
        }
        if (!handled && Rx.emailConfirm.test(hint)) {
            await safe(() => input_locator.fill(payload.email ?? ""));
            handled = true;
        }

        if (!handled && Rx.zip.test(hint)) {
            await safe(() =>
                input_locator.fill(payload.zip ?? payload.post_code ?? "")
            );
            handled = true;
        }

        if (!handled && Rx.phone.test(hint)) {
            await safe(() => input_locator.fill(payload.phone ?? ""));
            handled = true;
        }

        if (!handled && Rx.prefecture.test(hint)) {
            await safe(() => input_locator.fill(payload.prefecture ?? ""));
            handled = true;
        }

        if (!handled && Rx.kana.test(hint)) {
            await safe(() => input_locator.fill(payload.kana ?? ""));
            handled = true;
        }

        if (!handled && Rx.name.test(hint)) {
            await safe(() => input_locator.fill(payload.name ?? ""));
            handled = true;
        }

        if (!handled && Rx.consent.test(hint)) {
            await safe(() => input_locator.check({ force: true }));
            handled = true;
        }

        if (handled) continue;
    }

    // ----- checkboxes -----
    const checkboxes = root.locator('input[type="checkbox"]');
    const count = await safe(() => checkboxes.count()) || 0;

    for (let i = 0; i < count; i++) {
        await safe(() => checkboxes.nth(i).check());
    }

    // ----- selects -----
    const selects = await root.locator('select, input[list]').all();
    for (const select of selects) {
        await safe(async () => {
            const option = select.locator('option').first();
            const value = await option.evaluate(el => el.getAttribute("value"));
            await select.selectOption(value);
        });
    }

    // ----- textarea -----
    const textarea_locators = await root.locator("textarea:visible").all();
    for (const textarea_locator of textarea_locators) {
        const raw_input = await safe(() =>
            textarea_locator.evaluate(el => el.outerHTML)
        ) ?? "";

        if (Rx.message.test(raw_input)) {
            await safe(() =>
                textarea_locator.fill(payload.message ?? "こんにちは世界")
            );
        }
    }
}