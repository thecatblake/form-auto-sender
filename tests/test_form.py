from form_auto_sender.form import send_form, send_form_browser, find_forms, print_form
import time

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


def test_get_form_scheme():
    forms = find_forms("http://akikokitamura.com/contact/")
    assert len(forms) != 0
    
    fields = forms[0].fields
    # print_form(forms[0])
    assert len(fields) != 0

def test_send_form():
    success = send_form("http://akikokitamura.com/contact/", {
        "name": "test",
        "email_address": "test@example.com",
        "message_content": "it's a test",
        "subject": "it's a test"
    })

    assert success

# def test_send_form_browser1():
#     success = send_form_browser("http://akikokitamura.com/contact/", {
#         "name": "test",
#         "email_address": "test@example.com",
#         "message_content": "it's a test",
#         "subject": "it's a test"
#     })
#     assert success


#     success = send_form_browser("http://akikokitamura.com/contact/", {
#         # "name": "test",
#         "email_address": "test@example.com",
#         "message_content": "it's a test",
#         "subject": "it's a test"
#     })

#     assert not success

# def test_send_form_browser2():
#     success = send_form_browser("https://kagi-net.com/contactform", standard_contact_data)
#     assert success

def test_send_form_browser3():
    success = send_form_browser("https://mugenup.com/contact/", standard_contact_data)
    assert success
