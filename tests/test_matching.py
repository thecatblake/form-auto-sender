from form_auto_sender.matching import heuristic_match, similarity_match
from form_auto_sender.form import find_forms
from form_auto_sender.contact import CONTACT_EXPANSION

def test_heuristic_matching():
    forms = find_forms("http://akikokitamura.com/contact/")
    
    assert len(forms) > 0

    form = forms[0]

    assert len(form.fields) > 0

    field = heuristic_match(form, CONTACT_EXPANSION, "name", "ai")

    assert field is not None

    # print(field)

def test_similarity_matching():
    forms = find_forms("http://akikokitamura.com/contact/")
    
    assert len(forms) > 0

    form = forms[0]

    assert len(form.fields) > 0

    field = similarity_match(form, "email_address", "email@example.com")

    assert field is not None

    # print(field)
