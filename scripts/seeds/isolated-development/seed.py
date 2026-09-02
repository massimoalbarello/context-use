import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

APP_URL = os.environ["CONTEXT_USE_APP_URL"]
EXPECTED_ORIGIN = f"{urlparse(APP_URL).scheme}://{urlparse(APP_URL).netloc}"
FIXTURE_FOLDER = Path(os.environ["CONTEXT_USE_SEED_FOLDER"])
UI_TIMEOUT_SECONDS = 30


def read_seed_json(relative_path):
    return json.loads((FIXTURE_FOLDER / relative_path).read_text())


def read_seed_text(relative_path):
    return (FIXTURE_FOLDER / relative_path).read_text()


PROFILE = read_seed_json("entities/alex-morgan.json")
ENTITIES = [
    read_seed_json("entities/maya-chen.json"),
    read_seed_json("entities/northstar.json"),
    read_seed_json("entities/priya-shah.json"),
    read_seed_json("entities/theo-brooks.json"),
    read_seed_json("entities/orbit-labs.json"),
    read_seed_json("entities/jun-park.json"),
    read_seed_json("entities/compass.json"),
]
PAGES = [
    {
        **page,
        "markdown": read_seed_text(f"pages/{page['readableId']}.md"),
    }
    for page in read_seed_json("pages/index.json")
]
PROFILE_IMAGE_ASSET = {
    "readableId": "sample-profile-portrait",
    "name": "Sample profile portrait",
    "path": "assets/profile.jpeg",
    "expectedMediaType": "image/jpeg",
}
RESEARCH_HIGHLIGHTS_ASSET = {
    "readableId": "research-interview-highlights",
    "name": "Research interview highlights",
    "path": "assets/research-interview-highlights.txt",
}
ROLLOUT_METRICS_ASSET = {
    "readableId": "rollout-metrics",
    "name": "Rollout metrics",
    "path": "assets/rollout-metrics.csv",
}
ASSETS = [PROFILE_IMAGE_ASSET, RESEARCH_HIGHLIGHTS_ASSET, ROLLOUT_METRICS_ASSET]


def wait_until(predicate, failure_message, timeout_seconds=UI_TIMEOUT_SECONDS):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.2)
    raise RuntimeError(failure_message)


def checked_api_response(method, path, result):
    response = json.loads(result)
    if not response["ok"]:
        raise RuntimeError(
            f"{method} {path} failed with {response['status']}: {response['body']}"
        )
    return json.loads(response["body"])


def api_request(method, path, body):
    result = js(
        f"""
        (async () => {{
          const response = await fetch({json.dumps(path)}, {{
            method: {json.dumps(method)},
            credentials: 'same-origin',
            headers: {{ 'content-type': 'application/json' }},
            body: JSON.stringify({json.dumps(body)}),
          }});
          return JSON.stringify({{
            ok: response.ok,
            status: response.status,
            body: await response.text(),
          }});
        }})()
        """
    )
    return checked_api_response(method, path, result)


def create_asset(asset):
    input_id = "isolated-seed-asset-file"
    js(
        f"""
        (() => {{
          document.getElementById({json.dumps(input_id)})?.remove();
          const input = document.createElement('input');
          input.id = {json.dumps(input_id)};
          input.type = 'file';
          input.hidden = true;
          document.body.append(input);
        }})()
        """
    )
    upload_file(
        f"#{input_id}",
        str((FIXTURE_FOLDER / asset["path"]).resolve()),
    )
    result = js(
        f"""
        (async () => {{
          const input = document.getElementById({json.dumps(input_id)});
          try {{
            const file = input?.files?.[0];
            if (!file) throw new Error('Seed asset file was not transferred to the browser');
            const form = new FormData();
            form.set('name', {json.dumps(asset["name"])});
            form.set('file', file);
            const response = await fetch('/api/assets', {{
              method: 'POST',
              credentials: 'same-origin',
              body: form,
            }});
            return JSON.stringify({{
              ok: response.ok,
              status: response.status,
              body: await response.text(),
            }});
          }} finally {{
            input?.remove();
          }}
        }})()
        """
    )
    created = checked_api_response("POST", "/api/assets", result)
    if created["readableId"] != asset["readableId"]:
        raise RuntimeError("Created asset did not match the fixture")
    if asset.get("expectedMediaType") and created["mediaType"] != asset["expectedMediaType"]:
        raise RuntimeError("Seed asset bytes were not detected as the expected media type")


def create_profile(profile):
    created = api_request("POST", "/api/profile", profile)
    if created["selfEntity"]["readableId"] != profile["readableId"]:
        raise RuntimeError("Created profile did not match the fixture")


def create_entity(entity):
    created = api_request("POST", "/api/entities", entity)
    if created["readableId"] != entity["readableId"]:
        raise RuntimeError("Created entity did not match the fixture")


def assign_owner_entity_image(profile, asset):
    updated = api_request(
        "PUT",
        f"/api/entities/{profile['readableId']}/image",
        {"assetReadableId": asset["readableId"]},
    )
    if not updated["isSelf"] or updated["readableId"] != profile["readableId"]:
        raise RuntimeError("Assigned image to an unexpected entity")
    if not updated["image"] or updated["image"]["readableId"] != asset["readableId"]:
        raise RuntimeError("Assigned entity image did not match the fixture")


def create_page(page):
    created = api_request("POST", "/api/pages", page)
    if created["readableId"] != page["readableId"]:
        raise RuntimeError("Created page did not match the fixture")


def update_page(readable_id, expected_revision_number, markdown):
    updated = api_request(
        "PUT",
        f"/api/pages/{readable_id}",
        {
            "expectedRevisionNumber": expected_revision_number,
            "markdown": markdown,
        },
    )
    if updated["revisionNumber"] != expected_revision_number + 1:
        raise RuntimeError("Updated page did not create the expected revision")


def seed_isolated_data():
    current_origin = urlparse(page_info()["url"])
    if f"{current_origin.scheme}://{current_origin.netloc}" != EXPECTED_ORIGIN:
        raise RuntimeError(f"The active browser tab is not the isolated app at {APP_URL}")

    goto_url(APP_URL)
    wait_for_load()
    wait_until(
        lambda: js("!!document.querySelector('button[type=submit]:not([disabled])')"),
        "Owner registration action did not become available",
    )
    activate_tab(current_tab())
    cdp("Page.bringToFront")
    time.sleep(1)
    button_center = json.loads(
        js(
            """
            (() => {
              const button = document.querySelector('button[type=submit]:not([disabled])');
              if (!button) return 'null';
              const bounds = button.getBoundingClientRect();
              return JSON.stringify({
                x: bounds.left + bounds.width / 2,
                y: bounds.top + bounds.height / 2,
              });
            })()
            """
        )
    )
    if button_center is None:
        raise RuntimeError("Owner registration action disappeared before it could be activated")
    cdp(
        "Input.dispatchMouseEvent",
        type="mouseMoved",
        x=button_center["x"],
        y=button_center["y"],
    )
    click_at_xy(button_center["x"], button_center["y"])
    wait_until(
        lambda: urlparse(page_info()["url"]).path == "/setup",
        "Owner passkey registration did not complete",
    )

    create_profile(PROFILE)
    for entity in ENTITIES:
        create_entity(entity)
    for asset in ASSETS:
        create_asset(asset)
    assign_owner_entity_image(PROFILE, PROFILE_IMAGE_ASSET)
    for page in PAGES:
        create_page(page)
    update_page(
        "project-brief",
        1,
        read_seed_text("revisions/project-brief.md"),
    )

    # Use a document navigation so the new app instance reads the seeded profile instead of
    # retaining the setup route's pre-seed query cache.
    goto_url(f"{APP_URL}/map")
    wait_for_load()
    wait_until(
        lambda: urlparse(page_info()["url"]).path == "/map",
        "Seeded profile did not open the workspace",
    )
    print(
        f"Seeded 1 profile, {len(ENTITIES)} entities, {len(PAGES)} linked pages, "
        f"and {len(ASSETS)} assets"
    )


try:
    seed_isolated_data()
except BaseException:
    cdp("WebAuthn.disable")
    raise
