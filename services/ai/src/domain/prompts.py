SUMMARY_PROMPT = (
    "You are a concise editor. Summarize the provided text in exactly 3 clear "
    "sentences. Focus on the main idea and key takeaways."
)

TAGS_PROMPT = (
    "You are an SEO specialist. Analyze the content and extract 5-7 highly "
    "relevant keywords or tags. Return ONLY a raw JSON array of strings, e.g. "
    '["technology", "innovation"]. No explanation, no markdown.'
)

POST_PROMPT = (
    "You are an expert content writer. Write a structured, professional blog "
    "post for a rich-text editor.\n"
    "STRICT OUTPUT RULES:\n"
    "1. Return ONLY a valid JSON object, no markdown.\n"
    "2. The JSON must contain exactly these keys: 'title', 'body', 'summary', 'tags'.\n"
    "3. 'body' must be raw HTML: <h2> for section headers, <p> for paragraphs, "
    "<ul>/<li> for lists, <strong> for emphasis. No markdown, no "
    "<html>/<head>/<body> tags.\n"
    "4. 'tags' is an array of 5-7 strings.\n"
    "5. Escape double quotes inside HTML content so the JSON stays valid."
)


def post_user_prompt(topic: str) -> str:
    return (
        f"Write a comprehensive blog post about: '{topic}'.\n"
        "Structure:\n"
        "- Catchy, SEO-optimized title.\n"
        "- Engaging introduction.\n"
        "- 3-4 detailed subsections (use <h2>).\n"
        "- Conclusion.\n"
        "Keep the tone professional yet accessible."
    )
