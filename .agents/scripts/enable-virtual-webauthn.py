import os
from urllib.parse import urlparse

APP_URL = os.environ["CONTEXT_USE_APP_URL"]
parsed_app_url = urlparse(APP_URL)
EXPECTED_ORIGIN = f"{parsed_app_url.scheme}://{parsed_app_url.netloc}"


def origin(url):
    parsed_url = urlparse(url)
    return f"{parsed_url.scheme}://{parsed_url.netloc}"


matching_tabs = [
    tab for tab in list_tabs(include_chrome=False) if origin(tab["url"]) == EXPECTED_ORIGIN
]
if matching_tabs:
    current_target_id = current_tab()["targetId"]
    if all(tab["targetId"] != current_target_id for tab in matching_tabs):
        switch_tab(matching_tabs[0])
else:
    new_tab(APP_URL)
    wait_for_load()

cdp("WebAuthn.enable", enableUI=False)
result = cdp(
    "WebAuthn.addVirtualAuthenticator",
    options={
        "protocol": "ctap2",
        "ctap2Version": "ctap2_1",
        "transport": "internal",
        "hasResidentKey": True,
        "hasUserVerification": True,
        "automaticPresenceSimulation": True,
        "isUserVerified": True,
    },
)

print(f"Virtual WebAuthn authenticator enabled: {result['authenticatorId']}")
