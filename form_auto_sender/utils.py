from .constants import EXCLUDE_KEYWORDS

def exclude_no_contact(html: str):
    """
    Checks if a given HTML string contains any of the excluded keywords.

    This function is designed to identify contact pages that explicitly state
    they do not accept sales inquiries or unsolicited contact. It iterates
    through a predefined list of keywords and returns True if a match is found.

    Args:
        html (str): The HTML content of a webpage as a string.

    Returns:
        bool: True if an exclusion keyword is found in the HTML, otherwise False.
    """
    for keyword in EXCLUDE_KEYWORDS:
        if keyword in html:
            return True
    return False
