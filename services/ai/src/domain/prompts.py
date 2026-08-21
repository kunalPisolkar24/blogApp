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


CHAT_SYSTEM_PROMPT = (
    "You are the Topos blog assistant. Answer the user's question using ONLY "
    "the provided blog post excerpts, and cite the source of each claim with "
    "its bracketed number, e.g. [1]. Never invent facts that are not in the "
    "excerpts. If the excerpts do not answer the question, say that you could "
    "not find any relevant posts. Keep the answer concise and helpful."
)

REWRITE_QUERY_PROMPT = (
    "You are a search query rewriter. Rewrite the user's question into a "
    "short, self-contained search query: fix typos and spelling, expand "
    "vague wording into specific terms, and resolve pronouns or references "
    "using the conversation so far. Return ONLY the rewritten query text "
    "with no explanation, no quotes, and no punctuation at the end."
)

JUDGE_RELEVANCE_PROMPT = (
    "You are a retrieval relevance judge. Given a user's question and "
    "numbered blog post excerpts, decide whether the excerpts contain "
    "information that helps answer the question. Return ONLY a raw JSON "
    'object: {"relevant": true or false, "score": a 0.0-1.0 relevance '
    "score}. No explanation, no markdown."
)


def judge_user_prompt(query: str, contexts: list[tuple[str, str]]) -> str:
    """Assemble the judge prompt from the question and retrieved excerpts.

    ``contexts`` is a list of (title, body) excerpts numbered in order,
    matching how they were retrieved.
    """
    if contexts:
        excerpts = "\n\n".join(
            f"[{index}] {title}\n{body}"
            for index, (title, body) in enumerate(contexts, start=1)
        )
        return f"Question: {query}\n\nExcerpts:\n{excerpts}"
    return f"Question: {query}\n\nExcerpts: (none)"


def rewrite_query_user_prompt(query: str, history: list[tuple[str, str]]) -> str:
    """Assemble the rewrite prompt from recent turns and the question.

    ``history`` is a list of (role, content) turns, most recent last;
    it lets follow-up questions like \"what about its pricing?\" resolve
    to a standalone query.
    """
    parts: list[str] = []
    if history:
        transcript = "\n".join(
            f"{role.capitalize()}: {content}" for role, content in history
        )
        parts.append(f"Conversation so far:\n{transcript}")
    parts.append(f"Question: {query}")
    return "\n\n".join(parts)


def chat_user_prompt(
    query: str, history: list[tuple[str, str]], contexts: list[tuple[str, str]]
) -> str:
    """Assemble the grounded user prompt from history and retrieved posts.

    ``history`` is a list of (role, content) turns, most recent last.
    ``contexts`` is a list of (title, body) excerpts numbered in order,
    which the model is expected to cite as [1], [2], ...
    """
    parts: list[str] = []

    if history:
        transcript = "\n".join(
            f"{role.capitalize()}: {content}" for role, content in history
        )
        parts.append(f"Conversation so far:\n{transcript}")

    if contexts:
        excerpts = "\n\n".join(
            f"[{index}] {title}\n{body}"
            for index, (title, body) in enumerate(contexts, start=1)
        )
        parts.append(f"Relevant blog posts:\n{excerpts}")

    parts.append(f"Question: {query}")
    return "\n\n".join(parts)
