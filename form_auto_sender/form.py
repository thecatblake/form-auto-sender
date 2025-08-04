from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

from .constants import HEADERS

def send_form(url: str, content: dict[str, str]) -> None:
    pass


@dataclass
class FormField:
    tag: str
    name: Optional[str] = None
    id: Optional[str] = None
    type: Optional[str] = None
    value: Optional[str] = None
    placeholder: Optional[str] = None
    required: bool = False
    maxlength: Optional[str] = None
    checked: Optional[bool] = None
    selected_options: Optional[List[dict]] = None # List of dicts for options, as per original logic

@dataclass
class Form:
    index: int
    action: Optional[str] = None
    method: str = "GET"
    id: Optional[str] = None
    className: Optional[List[str]] = None # className is a list in BeautifulSoup
    action_absolute: Optional[str] = None
    fields: List[FormField] = None


def find_forms(url: str, html: str | None = None) -> List[Form]:
    """
    Fetches a webpage, identifies forms, and extracts a schema for each form,
    including details about its input fields.

    Args:
        url (str): The URL of the webpage containing the form(s).
        html (str): The content of the webpage containing the form(s).

    Returns:
        list: A list of Form objects, where each object represents a form
              and its schema. Returns an empty list if no forms are found or
              an error occurs.
    """
    forms_schemas: List[Form] = []
    
    if html is None:
        try:
            res = requests.get(url, headers=HEADERS)
            res.raise_for_status()

            html = res.text
        except:
            return []

    soup = BeautifulSoup(html, "html.parser")
    forms = soup.find_all("form")

    if not forms:
        return []

    for i, form_soup_tag in enumerate(forms):
        action = form_soup_tag.get("action")
        method = form_soup_tag.get("method", "GET").upper()
        form_id = form_soup_tag.get("id")
        class_name = form_soup_tag.get("class") # This is already a list

        action_absolute = None
        if action:
            action_absolute = urljoin(url, action)

        form_fields: List[FormField] = []
        inputs = form_soup_tag.find_all(["input", "textarea", "select", "button"])

        for field in inputs:
            field_tag = field.name
            field_name = field.get("name")
            field_id = field.get("id")
            field_type = field.get("type")
            field_value = field.get("value")
            field_placeholder = field.get("placeholder")
            field_required = field.has_attr("required")
            field_maxlength = field.get("maxlength")
            field_checked = None
            if field_type in ["checkbox", "radio"]:
                field_checked = field.has_attr("checked")

            field_selected_options = []
            if field.name == "select":
                options = field.find_all("option")
                for option in options:
                    option_data = {
                        "value": option.get("value"),
                        "text": option.get_text().strip(),
                        "selected": option.has_attr("selected"),
                    }
                    field_selected_options.append(option_data)
                
                # Set value for select based on selected option or first option
                if not field_selected_options and options:
                    field_value = options[0].get("value")
                elif field_selected_options:
                    selected_opt = next((opt for opt in field_selected_options if opt["selected"]), None)
                    if selected_opt:
                        field_value = selected_opt["value"]
                    elif options: # If no 'selected' attribute, default to the first option
                        field_value = options[0].get("value")


            form_field = FormField(
                tag=field_tag,
                name=field_name,
                id=field_id,
                type=field_type,
                value=field_value,
                placeholder=field_placeholder,
                required=field_required,
                maxlength=field_maxlength,
                checked=field_checked,
                selected_options=field_selected_options if field_selected_options else None # Only include if not empty
            )
            form_fields.append(form_field)

        form_obj = Form(
            index=i,
            action=action,
            method=method,
            id=form_id,
            className=class_name,
            action_absolute=action_absolute,
            fields=form_fields,
        )
        forms_schemas.append(form_obj)

    return forms_schemas


def print_form_pretty(form: Form) -> None:
    """
    Prints the extracted form data in a more readable format.

    Args:
        forms (List[Form]): A list of Form objects to display.
    """
    print(f"\n--- Form Index: {form.index} ---")
    print(f"  Action: {form.action}")
    print(f"  Absolute Action URL: {form.action_absolute}")
    print(f"  Method: {form.method}")
    if form.id:
        print(f"  ID: {form.id}")
    if form.className: # className is already a list, so join directly
        print(f"  Class: {', '.join(form.className)}")

    print("  Fields:")
    if not form.fields:
        print("    No fields found for this form.")
    else:
        for field in form.fields:
            print(f"    - Tag: {field.tag}")
            if field.name:
                print(f"      Name: {field.name}")
            if field.id:
                print(f"      ID: {field.id}")
            if field.type:
                print(f"      Type: {field.type}")
            # Include empty strings as valid values for 'value'
            if field.value is not None:
                print(f"      Default Value: '{field.value}'")
            if field.placeholder:
                print(f"      Placeholder: '{field.placeholder}'")
            if field.required:
                print(f"      Required: {field.required}")
            if field.maxlength:
                print(f"      Max Length: {field.maxlength}")
            if field.checked is not None: # Check if it's explicitly True or False
                print(f"      Checked: {field.checked}")
            if field.selected_options:
                print("      Options (Select):")
                for opt in field.selected_options:
                    print(
                        f"        - Text: '{opt.get('text')}', Value: '{opt.get('value')}', Selected: {opt.get('selected')}"
                    )
            print("---") # Separator for each field