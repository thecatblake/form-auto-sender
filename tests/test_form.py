from form_auto_sender.form import find_forms, print_form_pretty

def test_get_form_scheme():
    forms = find_forms("https://aerospacebiz.jaxa.jp/contact/form/")
    assert len(forms) != 0
    
    fields = forms[1].fields
    print_form_pretty(forms[1])
    assert len(fields) != 0