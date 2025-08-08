from form_auto_sender import send_form_browser, send_form
from form_auto_sender.contact.search import search_contact
from scraping_tools import MultiProcessRuntime
import pandas as pd

df = pd.read_csv("url_samples.csv", encoding="")
urls = df["URL"].tolist()
standard_contact_data = {
    "first_name": "山田",
    "last_name": "太郎",
    "first_name_kana": "ヤマダ",
    "last_name_kana": "タロウ",
    "name": "山田　太郎",
    "kana": "やまだ　たろう",
    "company_name": "株式会社テスト",
    "department_name": "開発部",
    "email_address": "test@example.com",
    "email_address_confirm": "test@example.com",  # Confirmation email
    "phone_number": "09012345678",
    "message_content": "これはテストメッセージです。",
    "subject": "お問い合わせ",
    "age": "30",  # Example age
    "gender": "male",  # Standardized gender: 'male', 'female', 'other', 'unspecified',
    "postal_code": "1700013",  # Example Zip Code (Toshima City, Tokyo)
    "address_prefecture": "東京都",  # Prefecture (都道府県)
    "address_city": "豊島区",  # City/Ward (市区町村)
    "address_street": "東池袋",  # Street/Block (町名番地)
    "address_building": "サンシャイン60",  # Building/Apartment name (建物名・部屋番号)
    "address_prefecture_kana": "トウキョウト",
    "address_city_kana": "トシマク",
    "address_street_kana": "ヒガシイケブクロ",
}


def _send_form(url):
    result = send_form_browser(url, standard_contact_data)
    return f"{url},{result}"

def _contact_pages(url):
    pages = search_contact(url)
    if len(pages) == 0:
        return None
    return "\n".join(pages)


if __name__ == "__main__":
    contact_found = 0
    form_sent = 0
    contact_pages = []

    runtime = MultiProcessRuntime("urls.csv", max_workers=6)
    runtime.run(_contact_pages, urls)

# runtime = MultiProcessRuntime("benchmark.csv")
# runtime.run(_send_form, contact_pages)