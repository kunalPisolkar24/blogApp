"""Offline checks for recommendation evidence lines."""

from src.domain.reasons import build_reasons


def test_reasons_name_the_strongest_shared_tag() -> None:
    reasons = build_reasons(
        {"golang": 5.0, "kafka": 3.0},
        {"post-1": ["kafka", "golang"], "post-2": ["kafka"]},
    )

    assert reasons == {
        "post-1": "Because you engage with golang posts",
        "post-2": "Because you engage with kafka posts",
    }


def test_posts_without_shared_interest_get_no_reason() -> None:
    reasons = build_reasons(
        {"golang": 5.0},
        {"post-1": [], "post-2": ["rust"], "post-3": ["golang"]},
    )

    assert reasons == {"post-3": "Because you engage with golang posts"}


def test_empty_inputs_yield_no_reasons() -> None:
    assert build_reasons({}, {"post-1": ["golang"]}) == {}
    assert build_reasons({"golang": 1.0}, {}) == {}
