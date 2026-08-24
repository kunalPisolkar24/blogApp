"""Evidence lines for recommended posts, derived from real profiles.

A reason names the interest tag a recommended post shares with the
user's accumulated tag weights — nothing is invented: posts without a
shared interest get no reason at all.
"""


def build_reasons(
    tag_weights: dict[str, float],
    post_tags: dict[str, list[str]],
) -> dict[str, str]:
    """Map post_id -> evidence line for posts sharing an interest tag.

    The strongest shared tag (highest profile weight) backs each line;
    posts with no overlap are left out of the map entirely.
    """
    reasons: dict[str, str] = {}
    for post_id, tags in post_tags.items():
        shared = [tag for tag in tags if tag in tag_weights]
        if not shared:
            continue
        top = max(shared, key=lambda tag: tag_weights[tag])
        reasons[post_id] = f"Because you engage with {top} posts"
    return reasons
