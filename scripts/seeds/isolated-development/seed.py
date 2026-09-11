import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
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


PROFILE = read_seed_json("entities/steve-jobs.json")
PAGE_SNAPSHOTS = read_seed_json("pages/index.json")
ENTITIES = [
    json.loads(path.read_text())
    for path in sorted((FIXTURE_FOLDER / "entities").glob("*.json"))
    if path.stem != PROFILE["readableId"]
]
ASSETS = read_seed_json("assets/index.json")
RECORDS = read_seed_json("records/index.json")


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
    return json.loads(response["body"]) if response["body"] else None


def api_request(method, path, body=None):
    body_option = (
        f"body: JSON.stringify({json.dumps(body)})," if body is not None else ""
    )
    result = js(
        f"""
        (async () => {{
          const response = await fetch({json.dumps(path)}, {{
            method: {json.dumps(method)},
            credentials: 'same-origin',
            headers: {{ 'content-type': 'application/json' }},
            {body_option}
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


def assign_entity_image(asset):
    updated = api_request(
        "PUT",
        f"/api/entities/{asset['entityReadableId']}/image",
        {"assetReadableId": asset["readableId"]},
    )
    if updated["readableId"] != asset["entityReadableId"]:
        raise RuntimeError("Assigned image to an unexpected entity")
    if not updated["image"] or updated["image"]["readableId"] != asset["readableId"]:
        raise RuntimeError("Assigned entity image did not match the fixture")


def create_page(page):
    created = api_request("POST", "/api/pages", page)
    if created["readableId"] != page["readableId"]:
        raise RuntimeError("Created page did not match the fixture")


def update_page(readable_id, expected_revision_number, markdown, temporal_coverage):
    updated = api_request(
        "PUT",
        f"/api/pages/{readable_id}",
        {
            "expectedRevisionNumber": expected_revision_number,
            "markdown": markdown,
            "temporalCoverage": temporal_coverage,
        },
    )
    if updated["revisionNumber"] != expected_revision_number + 1:
        raise RuntimeError("Updated page did not create the expected revision")


def create_records():
    committed_at = datetime.now(timezone.utc).isoformat()
    records = []
    for record in RECORDS:
        content = {**record["content"], "body": read_seed_text(record["path"])}
        # The fixtures contain only strings, integer-free metadata, objects and arrays;
        # sorted compact UTF-8 JSON is canonical for this deliberately narrow content.
        canonical = json.dumps(
            content, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        records.append({
            "eventId": str(uuid.uuid4()),
            "provider": record["provider"],
            "sourceId": "steve-jobs-2000-2001",
            "kind": record["kind"],
            "id": record["id"],
            "revision": 1,
            "operation": "added",
            "contentHash": hashlib.sha256(canonical.encode()).hexdigest(),
            "committedAt": committed_at,
            "content": content,
        })
    envelope = {"version": 1, "batchId": str(uuid.uuid4()), "records": records}
    # Issue, use and revoke the disposable sync key inside the browser. Never return
    # the credential through the harness or persist it in a fixture/log.
    result = js(f"""
        (async () => {{
          const created = await fetch('/api/syncs', {{
            method: 'POST', credentials: 'same-origin',
            headers: {{ 'content-type': 'application/json' }},
            body: JSON.stringify({{ name: 'Steve Jobs historical research' }}),
          }});
          if (!created.ok) throw new Error('Could not create isolated research sync');
          const sync = await created.json();
          try {{
            const response = await fetch('/api/records/batch', {{
              method: 'POST',
              headers: {{
                'content-type': 'application/json',
                authorization: `Bearer ${{sync.apiKey}}`,
                'idempotency-key': {json.dumps(envelope['batchId'])},
              }},
              body: JSON.stringify({json.dumps(envelope)}),
            }});
            return JSON.stringify({{
              ok: response.ok, status: response.status, body: await response.text(),
            }});
          }} finally {{
            const revoked = await fetch(`/api/syncs/${{sync.sync.readableId}}/revoke`, {{
              method: 'PUT', credentials: 'same-origin',
            }});
            if (!revoked.ok) throw new Error('Could not revoke isolated research sync');
          }}
        }})()
    """)
    checked_api_response("POST", "/api/records/batch", result)
    # Record addresses are allocated by the server and include the sync identity.
    # Resolve from authenticated output rather than duplicating its ID algorithm.
    addresses = {}
    offset = 0
    while True:
        page = api_request("GET", f"/api/records?limit=50&offset={offset}")
        for record in page["items"]:
            addresses[record["recordId"]] = record["readableId"]
        if page["nextOffset"] is None:
            break
        offset = page["nextOffset"]
    if set(addresses) != {record["id"] for record in RECORDS}:
        raise RuntimeError("Imported records did not match the fixture")
    return addresses


def seed_pages(record_addresses):
    revisions = {}
    for snapshot in PAGE_SNAPSHOTS:
        readable_id = snapshot["readableId"]
        markdown = re.sub(
            r"context-use://record/([a-z0-9-]+)",
            lambda match: f"context-use://record/{record_addresses[match[1]]}",
            read_seed_text(snapshot["path"]),
        )
        if readable_id in revisions:
            update_page(
                readable_id, revisions[readable_id], markdown, snapshot["temporalCoverage"]
            )
        else:
            create_page({
                "readableId": readable_id,
                "markdown": markdown,
                "temporalCoverage": snapshot["temporalCoverage"],
            })
        revisions[readable_id] = revisions.get(readable_id, 0) + 1
    return len(revisions)


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
        if asset.get("entityReadableId"):
            assign_entity_image(asset)
    record_addresses = create_records()
    page_count = seed_pages(record_addresses)

    # Use a document navigation so the new app instance reads the seeded profile instead of
    # retaining the setup route's pre-seed query cache.
    goto_url(f"{APP_URL}/hypermedia")
    wait_for_load()
    wait_until(
        lambda: urlparse(page_info()["url"]).path == "/hypermedia",
        "Seeded profile did not open the workspace",
    )
    print(
        f"Seeded Steve Jobs: 1 profile, {len(ENTITIES)} entities, {page_count} linked pages, "
        f"{len(PAGE_SNAPSHOTS) - page_count} page updates, {len(RECORDS)} records, "
        f"and {len(ASSETS)} assets"
    )


try:
    seed_isolated_data()
except BaseException:
    cdp("WebAuthn.disable")
    raise
