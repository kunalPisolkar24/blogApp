from src.domain.sanitize import sanitize_post_html


def test_keeps_allowed_tags() -> None:
    html = "<h2>Title</h2><p>text <strong>bold</strong></p><ul><li>item</li></ul>"
    assert sanitize_post_html(html) == html


def test_strips_scripts() -> None:
    out = sanitize_post_html("<p>hi</p><script>alert(1)</script>")
    assert "<script" not in out
    assert out.startswith("<p>hi</p>")


def test_removes_javascript_urls() -> None:
    out = sanitize_post_html('<a href="javascript:alert(1)">x</a>')
    assert "javascript" not in out


def test_removes_event_handlers() -> None:
    out = sanitize_post_html('<p onclick="alert(1)">hi</p>')
    assert "onclick" not in out


def test_removes_styles() -> None:
    out = sanitize_post_html('<p style="color:red">hi</p>')
    assert "style" not in out


def test_empty_input() -> None:
    assert sanitize_post_html("") == ""
    assert sanitize_post_html("   ") == ""
