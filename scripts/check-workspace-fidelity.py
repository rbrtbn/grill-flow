"""Compare the chosen prototype with the workspace in isolated browser contexts."""

import argparse
import copy
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--reference-dir", type=Path, required=True)
parser.add_argument(
    "--reference-url",
    default="http://127.0.0.1:4328/prototype/squad-workspace?variant=clean&edition=chosen&size=10",
)
parser.add_argument("--working-url", default="http://127.0.0.1:4330")
parser.add_argument("--output", type=Path, default=Path("data/visual-qa/fidelity"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
source = args.reference_dir / "src/prototype/squadTalk/sources"
raw_grill = json.loads((source / "workspace-grill.json").read_text())
answer_source = json.loads((source / "workspace-answer-snapshot.json").read_text())
grill = copy.deepcopy(raw_grill)
grill["id"] = "fidelity-reference"
grill["title"] = "Token efficiency"
grill["steps"] = [step for step in grill["steps"] if step["part"] != "owner-steps"]
base = {
    "grill": grill,
    **answer_source,
    "asks": [],
    "revisions": [],
    "sends": [],
    "replies": [],
}
report = {"checks": [], "metrics": {}, "console_errors": []}


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    report["checks"].append(message)
    (args.output / "report.json").write_text(json.dumps(report, indent=2))
    if len(report["checks"]) % 10 == 0:
        print(f"Passed {len(report['checks'])} browser checks", flush=True)


def metrics(locator):
    return locator.evaluate("""el => {
      const s = getComputedStyle(el);
      return {rect: el.getBoundingClientRect().toJSON(), font: s.font,
        fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight};
    }""")


def near(a, b, label, tolerance=2):
    check(abs(a - b) <= tolerance, f"{label}: {a:.2f} vs {b:.2f}")


def ready(page):
    page.evaluate(
        "Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))])"
    )


def capture(page, name):
    ready(page)
    page.screenshot(path=str(args.output / f"{name}.png"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    reference_context = browser.new_context(
        viewport={"width": 1600, "height": 1000}, color_scheme="light"
    )
    reference = reference_context.new_page()
    reference.set_default_timeout(8000)
    reference.goto(args.reference_url, wait_until="domcontentloaded")
    reference.get_by_text("Card transition", exact=True).click()
    ready(reference)
    capture(reference, "reference-question")
    check(
        reference.evaluate('document.fonts.check("600 22px Literata")'),
        "Reference reading font is loaded",
    )
    reference_metrics = {
        "title": metrics(reference.locator("h1")),
        "answer": metrics(reference.get_by_text("Only new cards", exact=True)),
        "reason_heading": metrics(
            reference.get_by_role(
                "heading", name="The problem, in one line", exact=True
            )
        ),
        "options": metrics(reference.locator(".p-question-body .w-options")),
        "nav": metrics(reference.locator(".w-navigation.n-navigation")),
        "canvas": metrics(reference.locator(".w-shell")),
    }
    state = copy.deepcopy(base)
    sent_requests = []
    events = []
    context = browser.new_context(
        viewport={"width": 1600, "height": 1000}, color_scheme="light"
    )

    def route_snapshot(route):
        request = route.request
        if request.method == "POST":
            body = request.post_data_json
            if request.url.endswith("/events"):
                events.append(body)
                question = body.get("question")
                if body["kind"] == "answered":
                    state["answers"][question] = body["key"]
                    if body["key"] == "other":
                        state["own"][question] = body.get("text", "")
                elif body["kind"] == "cleared":
                    state["answers"].pop(question, None)
                elif body["kind"] == "noted":
                    state["notes"][question] = body["text"]
                elif body["kind"] == "asked":
                    state["asks"].append(
                        {
                            "id": len(events),
                            "at": len(events),
                            "stepId": body["stepId"],
                            "text": body["text"],
                            "answered": False,
                        }
                    )
            elif request.url.endswith("/send"):
                sent_requests.append(body)
                for question in body["questions"]:
                    state["sent"][question] = body["expectedLines"][question]
                state["sends"].append(
                    {
                        "at": len(sent_requests),
                        "ok": True,
                        "detail": "Delivered in browser test",
                    }
                )
        route.fulfill(json=state)

    context.route(f"{args.working_url}/api/grills/fidelity-reference", route_snapshot)
    context.route(
        f"{args.working_url}/api/grills/fidelity-reference/**", route_snapshot
    )
    context.route(
        f"{args.working_url}/api/grills",
        lambda route: route.fulfill(
            json=[{"id": grill["id"], "title": grill["title"], "loadedAt": 0}]
        ),
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: report["console_errors"].append(str(error)))

    def goto(path):
        page.goto(
            f"{args.working_url}/g/fidelity-reference/{path}",
            wait_until="domcontentloaded",
        )
        page.locator(".f-workspace").wait_for()
        ready(page)

    goto("question/Q14")
    working_metrics = {
        "title": metrics(page.locator(".f-question-title")),
        "answer": metrics(page.get_by_text("Only new cards", exact=True)),
        "reason_heading": metrics(
            page.get_by_role("heading", name="The problem, in one line", exact=True)
        ),
        "options": metrics(page.locator(".f-options")),
        "nav": metrics(page.locator(".f-navigation")),
        "canvas": metrics(page.locator(".f-frame")),
    }
    check(
        page.evaluate('document.fonts.check("600 22px Literata")'),
        "Working reading font is loaded",
    )
    report["metrics"] = {"reference": reference_metrics, "working": working_metrics}
    for key in ["title", "answer"]:
        check(
            reference_metrics[key]["font"] == working_metrics[key]["font"],
            f"{key} typography matches prototype",
        )
    near(
        reference_metrics["title"]["rect"]["x"],
        working_metrics["title"]["rect"]["x"],
        "Reading column x",
    )
    near(
        reference_metrics["title"]["rect"]["width"],
        working_metrics["title"]["rect"]["width"],
        "Reading column width",
    )
    near(
        reference_metrics["title"]["rect"]["y"]
        - reference_metrics["canvas"]["rect"]["y"],
        working_metrics["title"]["rect"]["y"] - working_metrics["canvas"]["rect"]["y"],
        "Title inset excluding demo banners",
    )
    near(
        reference_metrics["options"]["rect"]["y"]
        - reference_metrics["canvas"]["rect"]["y"],
        working_metrics["options"]["rect"]["y"]
        - working_metrics["canvas"]["rect"]["y"],
        "Answers inset excluding demo banners",
    )
    near(
        reference_metrics["options"]["rect"]["height"],
        working_metrics["options"]["rect"]["height"],
        "Answer group height",
    )
    near(
        reference_metrics["nav"]["rect"]["width"],
        working_metrics["nav"]["rect"]["width"],
        "Navigation width",
    )
    near(
        reference_metrics["reason_heading"]["rect"]["y"]
        - reference_metrics["canvas"]["rect"]["y"],
        working_metrics["reason_heading"]["rect"]["y"]
        - working_metrics["canvas"]["rect"]["y"],
        "Reasoning heading inset excluding demo banners",
        tolerance=4,
    )
    check(page.locator(".f-note").count() == 0, "Empty note is collapsed by default")
    page.get_by_role("button", name="Add a note", exact=True).click()
    expect(page.get_by_role("textbox", name="Note with this answer")).to_be_visible()
    check(True, "Add a note opens its editor below the choices")
    page.get_by_role("button", name="Add a note", exact=True).click()

    for direction in ["Previous", "Next"]:
        button = page.get_by_role("button", name=f"{direction} question", exact=True)
        box = button.bounding_box()
        icon = button.locator("svg").bounding_box()
        near(
            box["x"] + box["width"] / 2,
            icon["x"] + icon["width"] / 2,
            f"{direction} arrow horizontally centered",
        )
        near(
            box["y"] + box["height"] / 2,
            icon["y"] + icon["height"] / 2,
            f"{direction} arrow vertically centered",
        )
        near(
            box["height"],
            working_metrics["canvas"]["rect"]["height"],
            f"{direction} fills its whitespace",
        )
    capture(page, "working-question")

    closed_action = page.get_by_role(
        "button", name="Discuss", exact=True
    ).bounding_box()
    page.get_by_role("button", name="Discuss", exact=True).click()
    expect(page.get_by_role("heading", name="Discussion", exact=True)).to_be_visible()
    opened_action = (
        page.locator(".f-discussion-actions")
        .get_by_role("button", name="Close", exact=True)
        .bounding_box()
    )
    near(
        closed_action["x"] + closed_action["width"],
        opened_action["x"] + opened_action["width"],
        "Discuss and Close share the right edge",
    )
    near(
        closed_action["y"] + closed_action["height"] / 2,
        opened_action["y"] + opened_action["height"] / 2,
        "Discuss and Close share the vertical position",
    )
    expect(page.locator(".f-context")).to_contain_text("Q14")
    expect(
        page.get_by_role("textbox", name="Ask about Q14", exact=True)
    ).to_be_visible()
    capture(page, "working-drawer")
    page.get_by_role("button", name="Expand", exact=True).click()
    expect(page.locator(".f-main")).to_have_css("visibility", "hidden")
    page.get_by_role("button", name="Back", exact=True).click()
    expect(page.locator(".f-main")).to_have_css("visibility", "visible")
    check(True, "Discussion expands and returns without losing question context")

    handle = page.get_by_role("separator", name="Resize the pages list")
    box = handle.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 150)
    page.mouse.down()
    page.mouse.move(322, box["y"] + 150)
    page.mouse.up()
    check(
        page.locator(".f-navigation").bounding_box()["width"] > 310,
        "Navigation resizes with the pointer",
    )
    handle.dblclick()
    page.wait_for_function(
        'Math.abs(document.querySelector(".f-navigation").getBoundingClientRect().width - 276) < 2'
    )
    near(
        page.locator(".f-navigation").bounding_box()["width"],
        276,
        "Navigation resets to prototype width",
    )
    page.locator(".f-discussion-actions").get_by_role(
        "button", name="Close", exact=True
    ).click()

    page.get_by_role("button", name="Conversations", exact=True).click()
    expect(page.locator(".f-context")).to_contain_text("Card transition")
    page.get_by_role("button", name="Whole run", exact=True).click()
    expect(
        page.get_by_role("button", name="This question · Q14", exact=True)
    ).to_be_enabled()
    page.get_by_role("button", name="This question · Q14", exact=True).click()
    page.locator(".f-discussion-actions").get_by_role(
        "button", name="Close", exact=True
    ).click()
    expect(page.locator(".f-current-question")).to_have_text("Q14")
    expect(page.get_by_role("button", name="Discuss", exact=True)).to_be_visible()
    check(
        True,
        "Full conversations retain question scope and Close returns to the question",
    )

    page.get_by_role("button", name="Settings", exact=True).click()
    expect(page.locator("#workspace-settings")).to_be_visible()
    page.mouse.click(5, 5)
    expect(page.locator("#workspace-settings")).not_to_be_visible()
    check(
        page.locator("#workspace-settings-trigger").evaluate(
            "el => el === document.activeElement"
        ),
        "Outside click closes Settings and returns focus",
    )

    goto("question/Q12")
    page.locator(".f-reading-scroller").evaluate("el => el.scrollTop = 250")
    check(
        page.locator(".f-reading-scroller").evaluate("el => el.scrollTop") > 0,
        "Long question actually scrolls",
    )
    page.get_by_role("button", name="Next question", exact=True).click()
    expect(page.locator(".f-current-question")).to_have_text("Q13")
    page.wait_for_function(
        'document.querySelector(".f-reading-scroller").scrollTop < 2'
    )
    check(True, "Next question resets the reading scroll position")

    goto("question/Q17")
    page.get_by_role("radio", name="My own answer", exact=False).click()
    own_answer = page.get_by_role("textbox", name="Your own answer", exact=True)
    own_answer.fill("Keep the guard scoped to this run.")
    own_answer.press("Meta+Enter")
    expect(page.locator(".f-review-summary")).to_be_visible()
    page.reload(wait_until="domcontentloaded")
    expect(page.locator(".f-review-table")).to_contain_text(
        "Keep the guard scoped to this run."
    )
    check(True, "Command+Enter preserves a custom answer through reload")
    state = copy.deepcopy(base)
    goto("review")
    message = page.locator("#send-message")
    expect(message).to_be_in_viewport(ratio=1)
    check(True, "Review message box stays entirely visible")
    page.get_by_role("searchbox", name="Find a question or answer").fill("Q14")
    page.get_by_role("button", name="Show details for Q14", exact=True).click()
    expect(page.locator(".f-review-detail")).to_contain_text("Only new cards")
    expect(message).to_be_in_viewport(ratio=1)
    check(True, "Review search and inline details preserve the message box")
    page.get_by_role("checkbox", name="Select all drafts", exact=True).uncheck()
    expect(
        page.get_by_role("button", name="Send 0 answers", exact=True)
    ).to_be_disabled()
    page.get_by_role("checkbox", name="Send Q14", exact=True).check()
    expect(page.get_by_role("button", name="Send 1 answer", exact=True)).to_be_enabled()
    message.fill("Only this answer.")
    message.press("Meta+Enter")
    try:
        page.wait_for_function(
            'document.querySelector(".f-review-summary").textContent.includes("5 drafts")'
        )
    except Exception:
        capture(page, "failed-send")
        print(
            json.dumps(
                {
                    "requests": sent_requests,
                    "summary": page.locator(".f-review").inner_text(),
                    "errors": report["console_errors"],
                }
            ),
            flush=True,
        )
        raise
    check(
        sent_requests[-1]["questions"] == ["Q14"],
        "Command+Enter sends only the checked answer",
    )
    expect(message).to_have_value("")
    check(True, "Successful Send clears the message box")
    capture(page, "working-review")

    goto("plan")
    for name in ["Completed", "Later", "Sessions", "Dependencies"]:
        page.get_by_role("button", name=name, exact=False).first.click()
        expect(page.locator(".f-work-table")).to_be_visible()
    check(True, "Every Run overview tab displays its own section")
    goto("squad")
    expect(page.locator(".f-runs-table")).to_be_visible()
    expect(page.get_by_role("heading", name="Where to go next")).to_be_visible()
    check(True, "Squad overview restores the run index and navigation guidance")
    capture(page, "working-squad")

    for size in [30, 60]:
        template = base["grill"]["steps"][0]
        state = copy.deepcopy(base)
        state["grill"]["steps"] = [
            {
                **copy.deepcopy(template),
                "id": f"stress-{index}",
                "question": {
                    **copy.deepcopy(template["question"]),
                    "id": f"Q{index + 1}",
                    "title": f"Navigation question {index + 1}",
                    "ask": f"Which approach should item {index + 1} use?",
                    "round": index // 10 + 1,
                    "dependsOn": [],
                    "when": [],
                },
            }
            for index in range(size)
        ]
        state["answers"] = {
            step["question"]["id"]: step["question"]["options"][0]["key"]
            for step in state["grill"]["steps"]
        }
        state["sent"] = {}
        state["notes"] = {}
        goto("review")
        expect(page.locator("#send-message")).to_be_in_viewport(ratio=1)
        check(
            page.locator(".f-review-table-scroll").evaluate(
                "el => el.scrollHeight > el.clientHeight"
            ),
            f"{size} drafts scroll independently of the composer",
        )
        capture(page, f"working-review-{size}")
        goto("question/Q1")
        check(
            page.locator(".f-question-item").count() == size,
            f"{size} questions remain reachable",
        )
        check(
            page.locator(".f-question-list").evaluate(
                "el => el.scrollHeight > el.clientHeight"
            ),
            f"{size} question list scrolls independently",
        )

    for width, height in [(1100, 800), (720, 900), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        goto("question/Q1")
        check(
            page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
            f"Question has no page overflow at {width}px",
        )
        capture(page, f"working-question-{width}")
        goto("review")
        expect(page.locator("#send-message")).to_be_in_viewport(ratio=1)
        expect(
            page.get_by_role("button", name="Send 60 answers", exact=True)
        ).to_be_in_viewport(ratio=1)
        capture(page, f"working-review-{width}")
        check(True, f"Review composer and Send stay visible at {width}px")

    check(not report["console_errors"], "No uncaught browser errors")
    (args.output / "report.json").write_text(json.dumps(report, indent=2))
    browser.close()
print(
    json.dumps(
        {"checks_passed": len(report["checks"]), "output": str(args.output)}, indent=2
    )
)
