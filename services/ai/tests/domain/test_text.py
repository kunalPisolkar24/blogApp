from src.domain.text import clean_html


def test_strips_tags() -> None:
    assert clean_html("<h1>Hello</h1><p>world</p>") == "Hello world"


def test_drops_scripts_and_styles() -> None:
    html = "<p>ok</p><script>alert(1)</script><style>.x {}</style><p>done</p>"
    assert clean_html(html) == "ok done"


def test_unescapes_entities() -> None:
    assert clean_html("<p>a &amp; b</p>") == "a & b"


def test_normalizes_whitespace() -> None:
    assert clean_html("<p>a   b\n\nc</p>") == "a b c"


def test_empty_input() -> None:
    assert clean_html("") == ""
    assert clean_html("   ") == ""
