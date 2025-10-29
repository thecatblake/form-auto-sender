// import { Browser } from "playwright";
// import { getBrowser, newContext } from "./browserPool";
// import { cfg } from "./config";
// import { findFormCandidates } from "./detector";
// import { discoverContacts } from "./discover";
// import { click, fillFields, mapFields } from "./mapper";
// import { neutralizeOverlays, screenshotOnFail } from "./utils";
// import { waitForSuccess } from "./verifier";


// async function submitOne(url: string, payload: Record<string, string>, browser: Browser) {

// 	let page = await browser.newPage();
// 	await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });

// 	const candidates = await Promise.race([
// 		  findFormCandidates(page),
// 		  page.waitForTimeout(cfg.findTimeoutMs).then(() => [] as Awaited<ReturnType<typeof findFormCandidates>>),
// 		]);

// 	for (const cand of candidates) {
// 		const root = cand.root;
// 		const map = await mapFields(root);

// 		await fillFields(map, payload);

// 		await neutralizeOverlays(page);
// 		await click(map.submit);
// 		await page.keyboard.press("Enter");
// 	}

// 	await screenshotOnFail(page, url);

// 	return await waitForSuccess(page);
// }

// (async () => {
// 	let ctx = await newContext();
// 	let browser = await getBrowser(); 

// 	const url = "https://stream-data.co.jp";
// 	const payload: Record<string, string> = {
// 		"name": "山田 太郎",
// 		"sei": "ヤマダ",
// 		"mei": "タロウ",
// 		"sei_kana": "ヤマダ",
// 		"mei_kana": "タロウ",
// 		"company": "株式会社ストリーム",
// 		"email": "k222ryousuke@gmail.com",
// 		"phone": "03-1234-5678",
// 		"subject": "お問い合わせ（御社サービスのご提案）",
// 		"message": "はじめまして。御社サイトを拝見し、集客とCV改善に関するご提案が可能と考えご連絡しました。具体的な改善案のドラフトを無償提供できます。オンラインで15分だけお時間いただけませんか？",
// 		"agree": "true",
// 	};

// 	const contacts = await discoverContacts(
// 		"http://localhost:8080/discover",
// 		url,
// 		100,
// 		5,
// 		10,
// 		500,
// 		30000
// 	);
	
// 	for (const contactInfo of contacts) {
// 		if (contactInfo.score > 50)
// 			console.log(await submitOne(contactInfo.url, payload, browser));
// 	}

// 	await browser.close();
// 	await ctx.close();
// })();