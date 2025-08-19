import { chromium, Page, Locator } from "playwright";
import { parentPort, workerData } from "worker_threads";
import { ContactData } from "./types";
import { findContactPageUrl, submitContactForm } from "./crawler";



(async () => {
  const { url, contactData } = workerData;

  const contactPageUrl = await findContactPageUrl(url);
  const targetUrl = contactPageUrl || url;

  const status = await submitContactForm(targetUrl, contactData);
  parentPort?.postMessage({ url: targetUrl, status });
})();
