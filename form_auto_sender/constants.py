USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

HEADERS = {
    "User-Agent": USER_AGENT
}

SUCCESS_KEYWORDS = [
    "送信されました",
    "成功しました"
]

EXCLUDE_KEYWORDS = [
    "営業のご連絡はご遠慮ください",
    "新規の営業やご提案は受け付けておりません",
    "営業目的のお問い合わせ",
    "自動的に迷惑メール"
]
