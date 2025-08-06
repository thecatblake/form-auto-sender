from form_auto_sender.form import find_forms, print_form_pretty

def test_get_form_scheme():
    forms = find_forms("http://akikokitamura.com/contact/")
    assert len(forms) != 0
    
    fields = forms[0].fields
    # print_form(forms[0])
    assert len(fields) != 0