import { Locator } from "playwright";

/** -------------------------
 *  正規表現辞書（表記ゆれ対応）
 *  ------------------------- */
const Rx = {
  // 氏名系
  name: /(お名前|氏名|ご担当者名|代表者名|name|full\s*name|contact\s*name)/i,
  family: /(姓|氏|last\s*name|surname|family\s*name)/i,
  given: /((?<!sur)名|first\s*name|given\s*name)/i,
  familyKana: /(セイ|せい|ｾｲ|フリガナ.*セイ|カナ.*セイ)/i,
  givenKana: /(メイ|めい|ﾒｲ|フリガナ.*メイ|カナ.*メイ)/i,

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
  address1: /(住所|市区町村|番地|address(\s*line)?\s*1?|street(\s*address)?)/i,
  address2: /(建物名|マンション名|建物|ﾏﾝｼｮﾝ|address\s*line\s*2|building|apt|apartment|suite|unit|room)/i,
  city: /(市|区|町|村|city|town|ward|district)/i,

  // 問い合わせ内容
  subject: /(件名|題名|タイトル|subject|title|topic)/i,
  message: /(お問い合わせ(内容)?|内容|メッセージ|ご用件|ご質問|ご相談|詳細|message|inquiry|enquiry|description|details|comments?|body)/i,
  type: /(種別|種類|区分|目的|category|type|kind|purpose|reason|topic)/i,

  // 同意
  consent: /(同意|承諾|確認しました|プライバシ|個人情報|利用規約|privacy\s*policy|terms|I\s*agree|agree|accept|consent)/i,

  // ハニーポットっぽいname/id
  honeypotName: /(honeypot|hp_|_hp|_confirm$|website_url|url|homepage)/i,
};


/** -------------------------
 *  返却フィールド（拡張）
 *  ------------------------- */
export type FieldMap = {
  // 従来
  name?: Locator;
  email?: Locator;
  subject?: Locator;
  message?: Locator;
  company?: Locator;
  phone?: Locator;
  consent?: Locator; // checkbox
  submit?: Locator;

  // 追加（ある場合だけ入力に使う）
  familyName?: Locator;
  givenName?: Locator;
  familyKana?: Locator;
  givenKana?: Locator;

  emailConfirm?: Locator;

  tel1?: Locator; // 市外
  tel2?: Locator; // 市内
  tel3?: Locator; // 加入者

  zip?: Locator;
  prefecture?: Locator; // select であること多い
  address1?: Locator;
  address2?: Locator;

  typeSelect?: Locator; // お問い合わせ種別
};

/** -------------------------
 *  ペイロード型（推奨）
 *  ------------------------- */
export type SubmitPayload = {
  // 氏名
  name?: string; // 「姓 名」や「名 姓」でもOK（半角/全角スペース分割）
  sei?: string;
  mei?: string;
  sei_kana?: string;
  mei_kana?: string;

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

/** -------------------------
 *  ユーティリティ
 *  ------------------------- */
async function isFillable(el: Locator): Promise<boolean> {
  try {
    const visible = await el.isVisible();
    if (!visible) return false;
  } catch { /* ignore */ }

  try {
    // ハニーポット風の属性やhidden, aria-hiddenを弾く
    return await el.evaluate((node) => {
      const e = node as HTMLElement;
      const style = window.getComputedStyle(e);
      const name = (e.getAttribute("name") || "").toLowerCase();
      const id = (e.id || "").toLowerCase();

      const hidden = e.hasAttribute("hidden") ||
        e.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        (e as any).offsetParent === null;

      const tabIdx = e.getAttribute("tabindex");
      const isHpAttr = (name + " " + id).match(/(honeypot|hp_|_hp|_confirm|website_url|url)/i) != null;
      const isHiddenType = (e as HTMLInputElement).type === "hidden";

      return !(hidden || tabIdx === "-1" || isHpAttr || isHiddenType);
    });
  } catch {
    return true; // 要素取得に失敗したらとりあえず許可（過剰除外を避ける）
  }
}

/** :has-text("...") を安全に処理する pick() 改訂版 */
async function pick(root: Locator, selectors: string[]): Promise<Locator | undefined> {
  for (const s of selectors) {
    // :has-text("...") を検出して baseSel + filter({ hasText: /.../i }) に変換
    const m = s.match(/^(.*):has-text\((.*)\)\s*$/i);
    if (m) {
      const baseSel = (m[1] || "*").trim() || "*";
      // 括弧内のクォートを剥がす（"..." / '...' 両対応）
      const textRaw = (m[2] || "").trim().replace(/^['"]|['"]$/g, "");
      const re = new RegExp(textRaw, "i");
      const candidates = root.locator(baseSel).filter({ hasText: re });
      const count = await candidates.count();
      if (count > 0) return candidates.first();
      continue;
    }

    // 通常CSSとして処理
    const list = root.locator(s);
    const count = await list.count();
    for (let i = 0; i < count; i++) {
      const el = list.nth(i);
      if (await isFillable(el)) return el;
    }
  }
  return undefined;
}

// ラベル由来（getByLabelは表記揺れに強い）
async function pickByLabel(root: Locator, rx: RegExp): Promise<Locator | undefined> {
  const el = root.getByLabel(rx, { exact: false });
  if (await el.count()) {
    const first = el.first();
    if (await isFillable(first)) return first;
  }
  return undefined;
}

// 近傍のテキスト（祖先.container内ラベルテキストで判定）
// ※ CSSに正規表現は入れず、filter({ hasText: rx }) を使う
async function pickByNearbyText(
  root: Locator,
  rx: RegExp,
  inputSel = "input, textarea, select"
): Promise<Locator | undefined> {
  const wrappers = [
    ".form-group", ".field", ".form-item", ".c-form__item",
    ".mktoFormRow", ".hs-form-field", ".wpforms-field",
    "li", "div", "section"
  ];

  for (const w of wrappers) {
    const items = root.locator(w).filter({ hasText: rx });
    const cnt = await items.count();
    for (let i = 0; i < cnt; i++) {
      const container = items.nth(i);
      const cand = container.locator(inputSel).first();
      if (await cand.count() && await isFillable(cand)) return cand;
    }
  }
  return undefined;
}

/** 送信ボタン検出（:has-text("... i) を排除、大小は pick() 側で /.../i 吸収） */
async function pickSubmit(root: Locator): Promise<Locator | undefined> {
  const sels = [
    'button[type="submit"]',
    'input[type="submit"]',

    // 日本語
    'button:has-text("送信")',
    'button:has-text("送信する")',
    'button:has-text("確認")',
    'button:has-text("確認へ")',

    // 英語（大小は pick() が /.../i で吸収）
    'button:has-text("submit")',
    'button:has-text("send")',
    'button:has-text("next")',
    'button:has-text("proceed")',
    'button:has-text("continue")',
  ];

  return (
    (await pick(root, sels)) ??
    (await pickByNearbyText(root, /(送信|確認|submit|send|next|proceed|continue)/i, 'button, input[type="submit"]'))
  );
}

function splitName(full?: string): { sei?: string; mei?: string } {
  if (!full) return {};
  const s = full.trim().replace(/\s+/g, " ");
  const parts = s.split(" ");
  if (parts.length >= 2) {
    return { sei: parts[0], mei: parts.slice(1).join(" ") };
  }
  return { sei: s, mei: "" };
}

async function sameElement(a?: Locator, b?: Locator): Promise<boolean> {
  if (!a || !b) return false;
  try {
    const [an, ai, bn, bi] = await Promise.all([
      a.getAttribute("name"), a.getAttribute("id"),
      b.getAttribute("name"), b.getAttribute("id"),
    ]);
    return (an || "") === (bn || "") && (ai || "") === (bi || "");
  } catch { return false; }
}

function splitPhoneJP(phone?: string): [string?, string?, string?] {
  if (!phone) return [undefined, undefined, undefined];
  const d = phone.replace(/[^\d]/g, "");
  // 携帯: 070/080/090 → 3-4-4
  if (/^0[789]0/.test(d) && d.length >= 11) {
    return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)];
  }
  // 固定回線: 03/06(2桁)-4-4 それ以外は 3-3-4 をざっくり優先
  if (/^0\d{1,4}/.test(d) && d.length >= 10) {
    const head = d.startsWith("03") || d.startsWith("06") ? 2 : 3;
    return [d.slice(0, head), d.slice(head, head + 4), d.slice(head + 4, head + 8)];
  }
  return [d, undefined, undefined];
}

/** -------------------------
 *  マッピング
 *  ------------------------- */
export async function mapFields(root: Locator): Promise<FieldMap> {
  const out: FieldMap = {};
  // email / email confirm
  out.email =
    (await pick(root, [
      // 汎用
      'input[type="email"]',
      'input[name*="mail" i]',
      'input[id*="mail" i]',
      'input[placeholder*="メール"]',
      'input[placeholder*="email" i]',
      'input[aria-label*="email" i]',
      // ベンダ: CF7 / HubSpot / Marketo / WPForms / Shopify
      'input[name="your-email"]',
      'input[name="Email"]',
      'input[name="email"]',
      'input[name="fields[email]"]',
      'input[name^="wpforms"][name$="[email]"]',
      'input[name="contact[email]"]',
    ])) ?? (await pickByLabel(root, Rx.email)) ?? (await pickByNearbyText(root, Rx.email, "input"));

  out.emailConfirm =
    (await pick(root, [
      'input[name*="confirm" i]',
      'input[id*="confirm" i]',
      'input[placeholder*="確認" i]',
      'input[placeholder*="confirm" i]',
      'input[aria-label*="confirm" i]',
      // ベンダの再入力欄
      'input[name="your-email-confirm"]',
      'input[name="email_confirm"]',
      'input[name="emailConfirmation"]',
    ])) ?? (await pickByLabel(root, Rx.emailConfirm)) ?? (await pickByNearbyText(root, Rx.emailConfirm, "input"));

  // name（単一: full name）
  out.name =
    (await pick(root, [
      'input[name*="fullname" i]',
      'input[id*="fullname" i]',
      'input[placeholder*="名前"]',
      'input[placeholder*="氏名"]',
      'input[placeholder*="full name" i]',
      'input[aria-label*="full name" i]',
      // ベンダ
      'input[name="your-name"]',
      'input[name="fullname"]',
      'input[name^="wpforms"][name$="[name]"]',
    ])) ?? (await pickByLabel(root, Rx.name)) ?? (await pickByNearbyText(root, Rx.name, "input"));

  // 姓/名 分割
  out.familyName =
    (await pick(root, [
      'input[name*="sei" i]', 'input[id*="sei" i]',
      'input[name*="last" i]', 'input[id*="last" i]',
      'input[name*="surname" i]', 'input[id*="surname" i]',
      'input[name*="family" i]', 'input[id*="family" i]',
      'input[placeholder*="姓"]',
      'input[placeholder*="last" i]',
      'input[aria-label*="last" i]',
      // ベンダ
      'input[name="your-lastname"]',
      'input[name="last_name"]',
      'input[name="lastname"]',
      'input[name^="wpforms"][name$="[last]"]',
    ])) ?? (await pickByLabel(root, Rx.family)) ?? (await pickByNearbyText(root, Rx.family, "input"));

  out.givenName =
    (await pick(root, [
      'input[name*="mei" i]', 'input[id*="mei" i]',
      'input[name*="first" i]', 'input[id*="first" i]',
      'input[name*="given" i]', 'input[id*="given" i]',
      'input[placeholder*="名"]',
      'input[placeholder*="first" i]',
      'input[aria-label*="first" i]',
      // ベンダ
      'input[name="your-firstname"]',
      'input[name="first_name"]',
      'input[name="firstname"]',
      'input[name^="wpforms"][name$="[first]"]',
    ])) ?? (await pickByLabel(root, Rx.given)) ?? (await pickByNearbyText(root, Rx.given, "input"));

  // カナ
  out.familyKana =
    (await pick(root, [
      'input[name*="sei_kana" i]',
      'input[id*="sei_kana" i]',
      // 英語圏の "last/family + kana"
      'input[id*="last" i][id*="kana" i]',
      'input[name*="last" i][name*="kana" i]',
      'input[id*="family" i][id*="kana" i]',
      'input[name*="family" i][name*="kana" i]',
      // プレースホルダヒント
      'input[placeholder*="セイ"]',
    ])) ??
    (await pickByLabel(root, Rx.familyKana)) ??
    (await pickByNearbyText(root, Rx.familyKana, "input"));

  out.givenKana =
    (await pick(root, [
      'input[name*="mei_kana" i]',
      'input[id*="mei_kana" i]',
      // 英語圏の "first/given + kana"
      'input[id*="first" i][id*="kana" i]',
      'input[name*="first" i][name*="kana" i]',
      'input[id*="given" i][id*="kana" i]',
      'input[name*="given" i][name*="kana" i]',
      // プレースホルダヒント
      'input[placeholder*="メイ"]',
    ])) ??
    (await pickByLabel(root, Rx.givenKana)) ??
    (await pickByNearbyText(root, Rx.givenKana, "input"));

  // --- フォールバック: kana 全件スキャンして振り分け ---
  if (!out.familyKana || !out.givenKana || await sameElement(out.familyKana, out.givenKana)) {
    const kanaCandidates = await root
      .locator('input[name*="kana" i], input[id*="kana" i], input[placeholder*="カナ"], input[placeholder*="フリガナ"]')
      .all();

    type KH = { el: Locator; hint: string };
    const hints: KH[] = [];
    for (const el of kanaCandidates) {
      const [name, id, ph] = await Promise.all([
        el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("placeholder"),
      ]);
      const hint = `${(name || "").toLowerCase()} ${(id || "").toLowerCase()} ${(ph || "").toLowerCase()}`;
      hints.push({ el, hint });
    }

    for (const h of hints) {
      if (!out.givenKana && /(first|given|mei)/.test(h.hint)) out.givenKana = h.el;
      if (!out.familyKana && /(last|family|sei)/.test(h.hint)) out.familyKana = h.el;
    }

    if ((!out.familyKana || !out.givenKana) || await sameElement(out.familyKana, out.givenKana)) {
      if (!out.familyKana && hints[0]) out.familyKana = hints[0].el;
      if (!out.givenKana && hints[1]) out.givenKana = hints[1].el;

      if (await sameElement(out.familyKana, out.givenKana)) {
        if (out.familyKana) {
          const [fn, fi] = await Promise.all([out.familyKana.getAttribute("name"), out.familyKana.getAttribute("id")]);
          const fHint = `${(fn || "").toLowerCase()} ${(fi || "").toLowerCase()}`;
          if (/(first|given|mei)/.test(fHint)) {
            out.familyKana = undefined;
          } else {
            out.givenKana = undefined;
          }
        } else {
          out.givenKana = undefined;
        }
      }
    }
  }

  // 会社
  out.company =
    (await pick(root, [
      'input[name*="company" i]',
      'input[id*="company" i]',
      'input[placeholder*="会社名"]',
      'input[placeholder*="法人名"]',
      'input[placeholder*="company" i]',
      'input[aria-label*="company" i]',
      // ベンダ
      'input[name="your-company"]',
      'input[name="company_name"]',
      'input[name="organization"]',
      'input[name^="wpforms"][name$="[company]"]',
    ])) ?? (await pickByLabel(root, Rx.company)) ?? (await pickByNearbyText(root, Rx.company, "input"));

  // 電話 単一 or 3分割
  out.phone =
    (await pick(root, [
      'input[type="tel"]',
      'input[name*="tel" i]',
      'input[id*="tel" i]',
      'input[placeholder*="電話"]',
      'input[placeholder*="phone" i]',
      'input[aria-label*="phone" i]',
      // ベンダ
      'input[name="your-tel"]',
      'input[name="phone"]',
      'input[name="mobile"]',
      'input[name^="wpforms"][name$="[phone]"]',
    ])) ?? (await pickByLabel(root, Rx.phone)) ?? (await pickByNearbyText(root, Rx.phone, "input"));

  // 3分割ヒント探索（英語も）
  const telCandidates = await root.locator(
    'input[type="tel"], input[name*="tel" i], input[name*="phone" i]'
  ).all();

  const telSplit = (await Promise.all(
    telCandidates.map(async (el) => {
      const name = (await el.getAttribute("name"))?.toLowerCase() || "";
      const id = (await el.getAttribute("id"))?.toLowerCase() || "";
      const ph = (await el.getAttribute("placeholder"))?.toLowerCase() || "";
      const hint = `${name} ${id} ${ph}`;
      return { el, hint };
    })
  )).sort((a, b) => a.hint.localeCompare(b.hint));

  for (const t of telSplit) {
    if (!out.tel1 && /(\b|_)(1|ichi|市外|area|country|part\s*1|first)/.test(t.hint)) out.tel1 = t.el;
    else if (!out.tel2 && /(\b|_)(2|ni|市内|exchange|middle|part\s*2|second)/.test(t.hint)) out.tel2 = t.el;
    else if (!out.tel3 && /(\b|_)(3|san|加入者|subscriber|last|part\s*3|third)/.test(t.hint)) out.tel3 = t.el;
  }

  // ===== フォールバック規則 =====
  if (!out.tel1 && !out.tel2 && !out.tel3) {
    if (telCandidates.length === 1 && !out.phone) {
      out.phone = telCandidates[0];
    } else if (telCandidates.length >= 2) {
      out.tel1 = out.tel1 ?? telCandidates[0];
      out.tel2 = out.tel2 ?? telCandidates[1];
      out.tel3 = out.tel3 ?? (telCandidates[2] ?? undefined);
      out.phone = undefined;
    }
  }

  const telCount = [out.tel1, out.tel2, out.tel3].filter(Boolean).length;
  if (telCount === 1) {
    if (!out.phone) {
      out.phone = out.tel1 || out.tel2 || out.tel3;
    }
    out.tel1 = undefined;
    out.tel2 = undefined;
    out.tel3 = undefined;
  }

  const splitComplete = !!(out.tel1 && out.tel2 && out.tel3);
  if (out.phone && !splitComplete) {
    out.tel1 = undefined;
    out.tel2 = undefined;
    out.tel3 = undefined;
  }

  // 住所
  out.zip =
    (await pick(root, [
      'input[name*="zip" i]',
      'input[name*="postcode" i]',
      'input[name*="postal" i]',
      'input[placeholder*="郵便"]',
      'input[placeholder*="zip" i]',
      'input[aria-label*="zip" i]',
    ])) ?? (await pickByLabel(root, Rx.zip)) ?? (await pickByNearbyText(root, Rx.zip, "input"));

  out.prefecture =
    (await pick(root, [
      'select[name*="pref" i]',
      'select[id*="pref" i]',
      'select[name*="state" i]',
      'select[name*="province" i]',
      'select[name*="region" i]',
    ])) ?? (await pickByLabel(root, Rx.prefecture)) ?? (await pickByNearbyText(root, Rx.prefecture, "select"));

  out.address1 =
    (await pick(root, [
      'input[name*="address" i]',
      'textarea[name*="address" i]',
      'input[name*="street" i]',
      'input[name*="line1" i]',
      'textarea[name*="line1" i]',
      'input[placeholder*="住所"]',
      'input[placeholder*="street" i]',
    ])) ?? (await pickByNearbyText(root, Rx.address1));

  out.address2 =
    (await pick(root, [
      'input[name*="building" i]',
      'input[name*="addr2" i]',
      'input[name*="line2" i]',
      'input[name*="apt" i]',
      'input[name*="suite" i]',
      'input[name*="unit" i]',
      'input[name*="room" i]',
      'input[placeholder*="建物"]',
      'input[placeholder*="apartment" i]',
    ])) ?? (await pickByNearbyText(root, Rx.address2));

  // 件名・本文・種別
  out.subject =
    (await pick(root, [
      'input[name*="subject" i]',
      'input[id*="subject" i]',
      'input[placeholder*="件名"]',
      'input[placeholder*="subject" i]',
      'input[aria-label*="subject" i]',
      // ベンダ
      'input[name="your-subject"]',
    ])) ?? (await pickByLabel(root, Rx.subject)) ?? (await pickByNearbyText(root, Rx.subject, "input"));

  out.message =
    (await pick(root, [
      'textarea',
      'input[name*="message" i]',
      'textarea[name*="message" i]',
      'textarea[name*="comment" i]',
      'textarea[name*="description" i]',
      'textarea[name*="details" i]',
      'input[placeholder*="お問い合わせ内容"]',
      'textarea[placeholder*="message" i]',
      'textarea[aria-label*="message" i]',
      // ベンダ
      'textarea[name="your-message"]',
      'textarea[name^="wpforms"][name$="[message]"]',
    ])) ?? (await pickByLabel(root, Rx.message)) ?? (await pickByNearbyText(root, Rx.message));

  out.typeSelect =
    (await pick(root, [
	  'select',
      'select[name*="type" i]',
      'select[name*="kind" i]',
      'select[name*="category" i]',
      'select[name*="purpose" i]',
      'select[name*="reason" i]',
      'select[name*="topic" i]',
    ])) ?? (await pickByLabel(root, Rx.type)) ?? (await pickByNearbyText(root, Rx.type, "select"));

  // 同意（checkbox or 近傍テキスト）
  out.consent =
    (await pick(root, [
      'input[type="checkbox"][name*="consent" i]',
      'input[type="checkbox"][id*="consent" i]',
      'input[type="checkbox"][name*="agree" i]',
      'input[type="checkbox"][id*="agree" i]',
      'input[type="checkbox"]',
    ])) ?? (await pickByNearbyText(root, Rx.consent, 'input[type="checkbox"]'));

  // 送信
  out.submit = await pickSubmit(root);

  return out;
}

export async function fillFields(map: FieldMap, payload: SubmitPayload) {
  const fill = async (el?: Locator, v?: string) => {
    try {
      if (el && typeof v === "string" && v.length > 0) await el.fill(v);
    } catch {}
  };
  const check = async (el?: Locator, v: boolean = true) => {
    if (!el) return;
    try {
      if (v) await el.check?.();
      else await el.uncheck?.();
    } catch {/* ignore */}
  };

  // ペア入力の対称ヘルパ
  async function fillPair(
    left?: Locator,
    right?: Locator,
    leftVal?: string,
    rightVal?: string,
    joiner: string = " "
  ) {
    const fused = [leftVal, rightVal].filter(Boolean).join(joiner).trim() || undefined;
    if (left && right) {
      await fill(left, leftVal ?? fused);
      await fill(right, rightVal ?? fused);
    } else if (left) {
      await fill(left, leftVal ?? fused);
    } else if (right) {
      await fill(right, rightVal ?? fused);
    }
  }

  let sei = payload.sei;
  let mei = payload.mei;
  if ((!sei || !mei) && payload.name) {
    const s = payload.name.trim().replace(/\s+/g, " ").split(" ");
    if (s.length >= 2) { sei = sei || s[0]; mei = mei || s.slice(1).join(" "); }
    else { sei = sei || s[0]; }
  }

  // name 一体型（フルネーム）
  await fill(map.name, [sei, mei].filter(Boolean).join(" ").trim() || undefined);

  // 姓/名 分割
  await fillPair(map.familyName, map.givenName, sei, mei);

  // カナ
  await fillPair(map.familyKana, map.givenKana, payload.sei_kana, payload.mei_kana);

  // 企業
  await fill(map.company, payload.company);

  // メール
  await fill(map.email, payload.email);
  await fill(map.emailConfirm, payload.email); // 確認欄があれば同値

  // 電話
  if (map.tel1 || map.tel2 || map.tel3) {
    const [p1, p2, p3] = payload.phone_parts ?? splitPhoneJP(payload.phone);
    await fill(map.tel1, p1);
    await fill(map.tel2, p2);
    await fill(map.tel3, p3);
  } else {
    await fill(map.phone, payload.phone);
  }

  // 住所
  await fill(map.zip, payload.zip);

  // 都道府県は **与えられた時だけ** セレクト。無指定で勝手に選ばない（事故防止）
  if (map.prefecture && payload.prefecture) {
    try {
      await map.prefecture.selectOption({ label: payload.prefecture });
    } catch {
      const opts = map.prefecture.locator("option");
      const cnt = await opts.count();
      let val: string | undefined;
      for (let i = 0; i < cnt; i++) {
        const t = (await opts.nth(i).innerText()).trim();
        if (t.includes(payload.prefecture)) {
          val = await opts.nth(i).getAttribute("value") ?? undefined;
          break;
        }
      }
      if (val) await map.prefecture.selectOption(val);
    }
  }

  await fill(map.address1, payload.address1);
  await fill(map.address2, payload.address2);

  // 件名・本文
  await fill(map.subject, payload.subject);
  await fill(map.message, payload.message);

  // 種別セレクト
  if (map.typeSelect) {
    if (payload.type) {
      // 指定があればそれを優先
      try {
        await map.typeSelect.selectOption({ label: payload.type });
      } catch {
        // ラベルに無ければ value を探索
        const opts = map.typeSelect.locator("option");
        const cnt = await opts.count();
        let val: string | undefined;
        for (let i = 0; i < cnt; i++) {
          const t = (await opts.nth(i).innerText()).trim();
          if (t.includes(payload.type)) {
            val = await opts.nth(i).getAttribute("value") ?? undefined;
            break;
          }
        }
        if (val) await map.typeSelect.selectOption(val);
        else {
          // 最後の砦：その他優先 → 先頭実オプション
          await selectPreferOtherOrFirst(map.typeSelect);
        }
      }
    } else {
      // 指定が無いとき：その他/General優先で何か選ぶ
      await selectPreferOtherOrFirst(map.typeSelect);
    }
  }

  // 同意（デフォルト true 扱い）
  const agree = payload.agree !== false;
  await check(map.consent, agree);
}

export async function click(loc?: Locator) {
  if (!loc) return;
  try {
    await loc.click({ force: true });
  } catch { /* ignore */ }
}


/** =========================
 *  Selectユーティリティ
 *  ========================= */
type OptInfo = { index: number; value: string | null; label: string; disabled: boolean; hidden: boolean };

async function listOptions(select: Locator): Promise<OptInfo[]> {
  const opts = select.locator("option");
  const cnt = await opts.count();
  const out: OptInfo[] = [];
  for (let i = 0; i < cnt; i++) {
    const o = opts.nth(i);
    const [val, txt, disAttr, hidAttr, vis] = await Promise.all([
      o.getAttribute("value"),
      o.innerText(),
      o.getAttribute("disabled"),
      o.getAttribute("hidden"),
      o.isVisible().catch(() => true),
    ]);
    out.push({
      index: i,
      value: val,
      label: (txt || "").trim(),
      disabled: disAttr !== null,
      hidden: hidAttr !== null || !vis,
    });
  }
  return out;
}

function isPlaceholder(label: string, value: string | null): boolean {
  const l = label.toLowerCase();
  const v = (value || "").toLowerCase();
  return (
    l === "" ||
    /select|choose|please|選択してください|お選び|--|—|－|未選択/.test(l) ||
    v === "" ||
    v === "-1" ||
    v === "placeholder"
  );
}

/** 「その他」や汎用を優先、無ければ最初の実オプション */
async function selectPreferOtherOrFirst(
  select: Locator,
  preferredLabels: RegExp[] = [
    /(その他|そのほか|その他ご相談|その他のご質問)/i,
    /(other|others|misc|general|not\s*listed)/i,
    /(お問い合わせ|ご相談|inquiry|enquiry|contact|sales)/i,
  ]
): Promise<boolean> {
  const opts = await listOptions(select);
  if (opts.length === 0) return false;
//   const usable = opts.filter((o) => !o.disabled && !o.hidden && !isPlaceholder(o.label, o.value));
//   if (usable.length === 0) return false;

  for (const opt of opts) {
	if (opt.value != "") {
		try { await select.selectOption({ index: opt.index }); return true; } catch {}
	}
  }
  return false;

//   for (const rx of preferredLabels) {
//     const hit = usable.find((o) => rx.test(o.label));
//     if (hit) {
//       try { await select.selectOption({ index: hit.index }); return true; } catch {}
//     }
//   }
//   try { await select.selectOption({ index: usable[0].index }); return true; } catch { return false; }
}

/** Radio版「その他」優先選択（無ければ最初の有効なもの） */
async function chooseRadioPreferOtherOrFirst(container: Locator): Promise<boolean> {
  const radios = container.locator('input[type="radio"]');
  const lbls   = container.locator('label');

  const cnt = await radios.count();
  if (!cnt) return false;

  // ラベルテキストでマッチ
  const preferred = [
    /(その他|そのほか)/i,
    /(other|others|misc|general|not\s*listed)/i,
    /(お問い合わせ|ご相談|inquiry|enquiry|contact|sales)/i,
  ];

  // ラベル→for属性で紐付け
  const tryClickLabel = async (rx: RegExp): Promise<boolean> => {
    const lcnt = await lbls.count();
    for (let i = 0; i < lcnt; i++) {
      const l = lbls.nth(i);
      const t = (await l.innerText().catch(() => ""))?.trim() || "";
      if (!rx.test(t)) continue;
      try { await l.click({ force: true }); return true; } catch {}
    }
    return false;
  };

  for (const rx of preferred) {
    if (await tryClickLabel(rx)) return true;
  }

  // ラベルがダメなら最初の有効 radio
  for (let i = 0; i < cnt; i++) {
    const r = radios.nth(i);
    const disabled = await r.isDisabled().catch(() => false);
    if (!disabled) {
      try { await r.check({ force: true }); return true; } catch {}
    }
  }
  return false;
}

/** 「その他」候補 select 検出 */
async function collectOtherableSelects(root: Locator): Promise<Locator[]> {
  const out: Locator[] = [];

  // 1) name/id に type/kind/category/purpose/topic/reason/inquiry/enquiry を含む select
  const nameMatches = root.locator(
    [
      'select[name*="type" i]',
      'select[name*="kind" i]',
      'select[name*="category" i]',
      'select[name*="purpose" i]',
      'select[name*="topic" i]',
      'select[name*="reason" i]',
      'select[name*="inquiry" i]',
      'select[name*="enquiry" i]',
      'select[id*="type" i]',
      'select[id*="kind" i]',
      'select[id*="category" i]',
      'select[id*="purpose" i]',
      'select[id*="topic" i]',
      'select[id*="reason" i]',
      'select[id*="inquiry" i]',
      'select[id*="enquiry" i]',
    ].join(",")
  );

  // 2) 近傍テキスト（項目/種別/内容など）
  const byTextWrappers = [
    ".form-group", ".field", ".form-item", ".c-form__item",
    ".mktoFormRow", ".hs-form-field", ".wpforms-field",
    "li", "div", "section"
  ];
  const byText: Locator[] = [];
  for (const w of byTextWrappers) {
    const items = root.locator(w).filter({ hasText: Rx.type });
    const cnt = await items.count();
    for (let i = 0; i < cnt; i++) {
      const sel = items.nth(i).locator("select");
      if (await sel.count()) byText.push(sel.first());
    }
  }

  // merge & dedup by DOM identity
  const pushUnique = async (loc: Locator) => {
    const key = await loc.evaluate((n) => (n as any).__kp = (n as any).__kp || Symbol(), {}).catch(() => null);
    // 代替: name/id で粗い重複排除
    const nid = `${(await loc.getAttribute("name")) || ""}#${(await loc.getAttribute("id")) || ""}`;
    if (!out.find(async (o) => {
      const nid2 = `${(await o.getAttribute("name")) || ""}#${(await o.getAttribute("id")) || ""}`;
      return nid2 === nid;
    })) out.push(loc);
  };

  const addAll = async (loc: Locator) => {
    const cnt = await loc.count();
    for (let i = 0; i < cnt; i++) await pushUnique(loc.nth(i));
  };
  await addAll(nameMatches);
  for (const l of byText) await pushUnique(l);

  return out;
}

/** 「その他」候補 radio グループ検出（type/項目/種別/内容などのラベル周辺） */
async function collectOtherableRadioGroups(root: Locator): Promise<Locator[]> {
  const groups: Locator[] = [];
  const wrappers = [
    ".form-group", ".field", ".form-item", ".c-form__item",
    ".mktoFormRow", ".hs-form-field", ".wpforms-field",
    "fieldset", "li", "div", "section",
  ];
  for (const w of wrappers) {
    const items = root.locator(w).filter({ hasText: Rx.type });
    const cnt = await items.count();
    for (let i = 0; i < cnt; i++) {
      const box = items.nth(i);
      if (await box.locator('input[type="radio"]').count()) groups.push(box);
    }
  }
  return groups;
}
