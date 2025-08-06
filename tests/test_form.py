from form_auto_sender.form import send_form, send_form_browser, find_forms, print_form

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

def test_send_form_browser():
    success = send_form_browser("http://akikokitamura.com/contact/", {
        "name": "test",
        "email_address": "test@example.com",
        "message_content": "it's a test",
        "subject": "it's a test"
    })

    assert success

    success = send_form_browser("http://akikokitamura.com/contact/", {
        # "name": "test",
        "email_address": "test@example.com",
        "message_content": "it's a test",
        "subject": "it's a test"
    })

    assert not success
