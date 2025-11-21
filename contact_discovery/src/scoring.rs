use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone)]
pub struct ScoreResult {
    pub score: i32,
    pub positives: Vec<String>,
    pub negatives: Vec<String>,
}

/// スコア閾値の目安:
/// - >= 60: ほぼ確実に「営業問い合わせフォーム」
/// - 40..59: 有力候補（レンダラーで精査推奨）
/// - < 40: 低確度
pub fn score_contact_form_like(html: &str) -> ScoreResult {
    static RE_INPUT_EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<input[^>]*\btype\s*=\s*["']?email["']?[^>]*>"#).unwrap());
    static RE_TEXTAREA: Lazy<Regex>   = Lazy::new(|| Regex::new(r#"(?is)<textarea[^>]*>.*?</textarea>"#).unwrap());
    static RE_BUTTON_SUBMIT: Lazy<Regex> = Lazy::new(|| {
        // 送信ボタン周辺の語彙（日本語優先）
        Regex::new(r#"(?is)<(button|input)[^>]*?(type\s*=\s*["']?submit["']?)?[^>]*>(?:[^<]{0,40})?(送信|お問い合わせ|送信する|Submit|Send|送る)[^<]*</button>|<input[^>]*\bvalue\s*=\s*["']?(送信|お問い合わせ|Submit|Send)["']?[^>]*>"#).unwrap()
    });

    // ページ文脈（title/h1/本文テキスト）に現れたら強いポジティブ
    static RE_POS_PAGE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"(?is)(お問い合わせ|お問合せ|問い合わせ|ご相談|ご依頼|資料請求|お見積り|商談|連絡先|法人様向け|企業様向け|協業|提携|取引のご相談)"#).unwrap()
    });

    // フィールドラベル類（input/placeholder/label などに混じりやすい語彙）
    static RE_POS_FIELDS: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"(?is)(メールアドレス|email|e-mail|お名前|氏名|会社名|法人名|組織名|お問い合わせ内容|ご用件|メッセージ|本文|電話番号|お電話)"#).unwrap()
    });

    // ネガティブ（誤検出を落とす）
    static RE_LOGIN_PASS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<input[^>]*\btype\s*=\s*["']?password["']?[^>]*>"#).unwrap());
    static RE_SEARCH_INPUT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<input[^>]*\btype\s*=\s*["']?search["']?[^>]*>"#).unwrap());
    static RE_NEG_PAGE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"(?is)(採用|エントリー|応募|新卒|中途|求人|ログイン|サインイン|会員登録|検索|search|FAQ|よくある質問|通報|コンプライアンス|苦情|修理|保証|購入|カート|予約)"#).unwrap()
    });

    // タグ除去して「ページテキスト」を作る（簡易）
    static RE_TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<script.*?</script>|<style.*?</style>|<!--.*?-->|<[^>]+>").unwrap());
    let page_text = RE_TAG.replace_all(html, " ");

    let mut score: i32 = 0;
    let mut pos = Vec::<String>::new();
    let mut neg = Vec::<String>::new();

    // ===== Positive signals =====
    if RE_INPUT_EMAIL.is_match(html) {
        score += 28; pos.push("input[type=email]".into());
    }
    if RE_TEXTAREA.is_match(html) {
        score += 28; pos.push("textarea".into());
    }
    if RE_BUTTON_SUBMIT.is_match(html) {
        score += 12; pos.push("submit_button(送信/お問い合わせ/Send/Submit)".into());
    }
    if RE_POS_FIELDS.is_match(html) {
        score += 12; pos.push("field_labels(氏名/会社名/お問い合わせ内容/電話など)".into());
    }
    if RE_POS_PAGE.is_match(&page_text) {
        score += 20; pos.push("page_context(お問い合わせ/ご相談/資料請求/商談など)".into());
    }

    // ===== Negative signals =====
    if RE_LOGIN_PASS.is_match(html) {
        score -= 38; neg.push("password_input(ログイン系)".into());
    }
    if RE_SEARCH_INPUT.is_match(html) {
        score -= 18; neg.push("search_input".into());
    }
    if RE_NEG_PAGE.is_match(&page_text) {
        score -= 18; neg.push("page_context_negative(採用/ログイン/検索/FAQ/予約/購入など)".into());
    }

    // 軽い正規化：下限0, 上限100 に丸め（任意）
    if score < 0 { score = 0; }
    if score > 100 { score = 100; }

    ScoreResult { score, positives: pos, negatives: neg }
}