from typing import List
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.chrome.options import Options
import time

from .models import Form, FormField
from .constants import HEADERS
from .matching import match

def send_form(url: str, content: dict[str, str]) -> None:
    forms = find_forms(url)
    for form in forms:
        fields = []
        hidden_fields = [field for field in form.fields if field.type == "hidden"]
        for key, value in content.items():
            field = match(form, key, value)
            fields.append(field)
        if len(fields) < len(content):
            continue
        fields.extend(hidden_fields)
        body = fields_to_body(fields)

        try:
            if form.method == "GET":
                res = requests.get(form.action_absolute, data=body)
            elif form.method == "POST":
                res = requests.post(form.action_absolute, data=body)
            res.raise_for_status()
        except:
            return 


def send_form_browser(url: str, content: dict[str, str]):
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    driver = webdriver.Chrome()
    driver.get(url)

    forms = find_forms(url, html=driver.page_source)
    for i, form in enumerate(forms):
        fields = []
        for key, value in content.items():
            field = match(form, key, value)
            fields.append(field)
        if len(fields) < len(content):
            continue
        input_fields_browser(driver, fields)
        submit_button = driver.find_element(
            By.XPATH,
            f"//form[{i + 1}]//input[@type='submit'] | //form[{i + 1}]//button[@type='submit']")
        submit_button.click()


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
        input_nums = {
            "input": 0,
            "textarea": 0,
            "select": 0,
            "button": 0
        }
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
            input_nums[field_tag] += 1
            xpath = f"//form[{i + 1}]//{field_tag}"
            if field_id is not None:
                xpath += f"[@id='{field_id}]]"
            elif field_name is not None:
                xpath += f"[@name='{field_name}']"
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
                selected_options=field_selected_options if field_selected_options else None,
                xpath=xpath
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


def print_form(form: Form) -> None:
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

def fields_to_body(fields: List[FormField]) -> dict[str, str]:
    return {field.name: field.value for field in fields}

def input_fields_browser(driver: WebDriver, fields: List[FormField]):
    for field in fields:
        element = driver.find_element(By.XPATH, field.xpath)
        if field.tag in ["input", "textarea"]:
            time.sleep(0.1)
            element.send_keys(field.value)
        
