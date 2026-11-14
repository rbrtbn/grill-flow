"""Check that text set in a box with no input event survives polls, blur, send and a reload.

Run it against an isolated server that has examples/decision-sample.json loaded:

    GF_PORT=4399 GF_DB=/tmp/gf-check.sqlite GF_POLL_REMOTES=0 GF_POLL_PROVIDERS=0 bun server/main.ts
    GF_PORT=4399 GF_DB=/tmp/gf-check.sqlite bun server/cli.ts load examples/decision-sample.json
    python3 scripts/check-dictation-boxes.py --url http://127.0.0.1:4399
"""

import argparse
import json
import re
import time

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4399")
parser.add_argument("--grill", default="decision-sample")
parser.add_argument("--question", default="Q1")
# The page polls every 4 s; the wait has to cover at least one poll and its re-render.
parser.add_argument("--past-poll-ms", type=int, default=5000)
args = parser.parse_args()

stamp = str(int(time.time()))
passed = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    passed.append(message)
    print(f"ok  {message}", flush=True)


def set_silently(page, selector, text):
    """Write the value the way a dictation tool can: no key, paste or input event."""
    page.locator(selector).focus()
    page.locator(selector).evaluate("(box, text) => { box.value = text }", text)


def value(page, selector):
    return page.locator(selector).evaluate("box => box.value")


def posted(page, path, text, act):
    with page.expect_request(
        lambda request: request.method == "POST"
        and request.url.endswith(path)
        and text in (request.post_data or ""),
        timeout=5000,
    ) as caught:
        act()
    return json.loads(caught.value.post_data)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1500, "height": 950})
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    page = context.new_page()
    question_url = f"{args.url}/g/{args.grill}/question/{args.question}"
    page.goto(question_url)
    page.wait_for_selector(".f-answer-section")

    own = f"#own-{args.question}"
    if page.locator(own).count() == 0:
        page.get_by_role("radio", name=re.compile("My own answer")).click()
    page.wait_for_selector(own)
    own_text = f"own answer {stamp}"
    set_silently(page, own, own_text)
    page.wait_for_timeout(args.past_poll_ms)
    check(value(page, own) == own_text, "own answer survives a poll")
    body = posted(page, "/events", own_text, lambda: page.keyboard.press("Tab"))
    check(
        body["kind"] == "answered" and body["text"] == own_text,
        "own answer saves the box's text on blur",
    )

    note = f"#note-{args.question}"
    if page.locator(note).count() == 0:
        page.get_by_role("button", name="Add a note").click()
    page.wait_for_selector(note)
    note_text = f"note {stamp}"
    set_silently(page, note, note_text)
    page.wait_for_timeout(args.past_poll_ms)
    check(value(page, note) == note_text, "note survives a poll")
    body = posted(page, "/events", note_text, lambda: page.keyboard.press("Tab"))
    check(
        body["kind"] == "noted" and body["text"] == note_text,
        "note saves the box's text on blur",
    )

    if page.locator("#talk-box").count() == 0:
        page.get_by_role("button", name="Discuss", exact=True).first.click()
    page.wait_for_selector("#talk-box")
    talk_text = f"discussion {stamp}"
    set_silently(page, "#talk-box", talk_text)
    page.wait_for_timeout(args.past_poll_ms)
    check(value(page, "#talk-box") == talk_text, "discussion box survives a poll")
    body = posted(page, "/events", talk_text, lambda: page.keyboard.press("Enter"))
    check(
        body["kind"] == "asked" and body["text"] == talk_text,
        "discussion box sends the box's text",
    )

    # The page takes a paste itself: it reads the text inside the paste event and inserts it,
    # because a dictation tool's paste can leave the browser's own insertion empty.
    page.wait_for_selector("#talk-box")
    page.evaluate(
        """() => {
          window.__pastes = []
          window.addEventListener('paste', event => setTimeout(
            () => window.__pastes.push(event.defaultPrevented), 0), true)
        }"""
    )
    for selector in ["#talk-box", note, own]:
        pasted_text = f"pasted {selector} {stamp}"
        page.evaluate("text => navigator.clipboard.writeText(text)", pasted_text)
        page.locator(selector).focus()
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.press("ControlOrMeta+V")
        page.wait_for_timeout(300)
        check(
            value(page, selector) == pasted_text,
            f"{selector} holds a pasted text exactly once",
        )
    check(
        page.evaluate("window.__pastes") == [True, True, True],
        "the page takes each paste itself",
    )
    before_undo = value(page, own)
    page.keyboard.press("ControlOrMeta+Z")
    check(value(page, own) != before_undo, "undo takes a pasted text back")
    page.keyboard.press("ControlOrMeta+Shift+Z")

    # A new build reloads the page; the boxes' text and the caret must come back.
    carried_note = f"carried note {stamp}"
    carried_talk = f"carried discussion {stamp}"
    page.wait_for_selector("#talk-box")
    set_silently(page, note, carried_note)
    set_silently(page, "#talk-box", carried_talk)
    page.route(
        "**/api/build",
        lambda route: route.fulfill(json={"build": f"another-build-{stamp}"}),
    )
    with page.expect_navigation(timeout=10000):
        pass
    page.wait_for_selector("#talk-box")
    page.wait_for_selector(note)
    check(value(page, note) == carried_note, "note survives a build reload")
    check(
        value(page, "#talk-box") == carried_talk,
        "discussion box survives a build reload",
    )
    check(
        page.evaluate("document.activeElement && document.activeElement.id")
        == "talk-box",
        "the box that had focus has it again after a build reload",
    )
    page.unroute("**/api/build")

    page.goto(f"{args.url}/g/{args.grill}/review")
    page.wait_for_selector("#send-message")
    send_text = f"send message {stamp}"
    set_silently(page, "#send-message", send_text)
    page.wait_for_timeout(args.past_poll_ms)
    check(
        value(page, "#send-message") == send_text,
        "Review message survives a poll",
    )
    body = posted(
        page,
        "/send",
        send_text,
        lambda: page.locator(".f-review-compose .send-button").click(),
    )
    check(body["message"] == send_text, "Review send carries the box's text")
    browser.close()

print(f"{len(passed)} checks passed")
