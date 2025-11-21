use scraper::{Html, Selector};
use url::Url;

pub fn heuristic_url_priority(u: &Url) -> i32 {
    let path = u.path().to_lowercase();
    let mut score = 0;
    for kw in ["contact", "contact-us", "inquiry", "support"] {
        if path.contains(kw) {
            score += 30;
        }
    }
    // 日本語スラッグ（エンコード済みも多い）: ざっくり判定
    for kw in ["お問い合わせ", "お問合せ", "連絡先", "問い合わせ", "company/contact", "about/contact"] {
        if path.contains(kw) {
            score += 40;
        }
        // URLエンコード版の一部（簡易）
        if path.contains("%e3%81%8a%e5%95%8f%e3%81%84%e5%90%88%e3%81%9b")
            || path.contains("%e3%81%8a%e5%95%8f%e5%90%88%e3%81%9b")
        {
            score += 40;
        }
    }
    score
}


pub fn known_contact_paths(root: &url::Url) -> Vec<(url::Url, i32, &'static str)> {
    // (path, base_score)
    const CANDIDATES: &[(&str, i32)] = &[
        ("/contact", 80),
        ("/contact-us", 75),
        ("/inquiry", 70),
        ("/お問い合わせ", 90),
        ("/お問合せ", 90),
        ("/連絡先", 70),
        ("/company/contact", 75),
        ("/about/contact", 70),
    ];
    let mut out = Vec::new();
    for (p, base) in CANDIDATES {
        if let Ok(u) = root.join(p) {
            out.push((u, *base, "known_path"));
        }
    }
    out
}

// ルートHTMLの<a>から、アンカー語 + URLスラッグの両方でスコア
pub fn candidates_from_root_html(root: &url::Url, html: &str) -> Vec<(url::Url, i32, &'static str)> {
    let doc = Html::parse_document(html);
    let sel_a = Selector::parse("a[href]").unwrap();
    let mut out = Vec::new();

    // アンカー語彙（日本語優先）
    const POS_ANCHOR: &[(&str, i32)] = &[
        ("お問い合わせ", 50),
        ("お問合せ", 50),
        ("問い合わせ", 45),
        ("ご相談", 40),
        ("ご依頼", 40),
        ("資料請求", 35),
        ("商談", 35),
        ("連絡先", 35),
        ("企業様向け", 25),
        ("法人様向け", 25),
        ("協業", 25),
        ("提携", 25),
        ("contact", 30),
        ("inquiry", 30),
        ("support", 15), // あまり強くしない
    ];

    for a in doc.select(&sel_a) {
        let href = match a.value().attr("href") {
            Some(h) => h,
            None => continue,
        };
        let text = a.text().collect::<String>();
        if text.trim().is_empty() { continue; }

        // URL解決
        let url = match root.join(href) {
            Ok(u) => u,
            Err(_) => continue,
        };
        if url.domain() != root.domain() { continue; } // 同一サイト限定（調整可）

        // アンカー語スコア
        let mut s = 0;
        for (kw, w) in POS_ANCHOR {
            if text.contains(kw) {
                s += *w;
            }
        }

        // URL/スラッグにもヒューリスティック加点
        s += heuristic_url_priority(&url);

        // 低スコアはノイズなので弾く（チューニング用しきい値）
        if s >= 30 {
            out.push((url, s, "root_anchor"));
        }
    }
    out
}
