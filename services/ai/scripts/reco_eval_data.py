"""Curated recommender evaluation dataset for the Topos feed.

Source of truth for ``scripts/eval_reco.py``. Defines a fixed corpus of
blog posts spread over clearly separated topics and a set of synthetic users
whose interaction history drives ``RecommendFeed``.

Why separate topics?
--------------------
The eval runs against real embeddings, so relevance signals come from
semantic similarity. Topics are chosen to be far apart (brewing, cycling,
keyboards, photography) so a profile folded from one topic ranks its own
posts far above the others -- making precision@k a meaningful signal instead
of noise.

Relevance model
---------------
A recommended post counts as relevant for a user when its ``topic`` is one of
the topics the user interacted with ("precision@k against interaction
history"). Each user also lists ``held_out_post_ids``: same-topic posts kept
out of their interactions, i.e. what a good feed should still surface.

Row shapes
----------
* ``CORPUS`` posts: 24-hex ``post_id`` (MongoDB ObjectId style, matching how
  the ai-service returns ids), ``title``, ``body``, ``summary``, ``tags``
  (topic tag + one sub-tag), ``topic``.
* ``USERS``: ``id``, ``interactions`` as (post_id, kind) with kind in
  ``view|like|save`` (weights are applied server-side), ``held_out_post_ids``,
  and ``cold_start`` flag. The cold-start user has no interactions and is
  reported separately, never aggregated.
"""

from __future__ import annotations

# Feed depth requested per recommendation call.
DEFAULT_K = 5

# Fixed seed so SURPRISE ordering is deterministic across runs.
SURPRISE_SEED = 7

# 24-hex ids, topic-prefixed: 20 zeros + topic number + post number.
_COFFEE = "0000000000000000000001"
_CYCLING = "0000000000000000000002"
_KEYBOARDS = "0000000000000000000003"
_PHOTOGRAPHY = "0000000000000000000004"


def _pid(topic_prefix: str, n: int) -> str:
    return f"{topic_prefix}{n:02d}"


CORPUS: list[dict] = [
    # --- Topic: home coffee brewing ---
    {
        "post_id": _pid(_COFFEE, 1),
        "title": "Dialing in espresso",
        "body": (
            "Dialing in espresso is about adjusting the grind until the shot "
            "runs in roughly 25-30 seconds. Change one variable at a time and "
            "taste every shot."
        ),
        "summary": "Grind adjustment is the main lever for balanced espresso shots.",
        "tags": ["coffee", "espresso"],
        "topic": "coffee",
    },
    {
        "post_id": _pid(_COFFEE, 2),
        "title": "Pour-over basics",
        "body": (
            "A good pour-over starts with a medium grind, water just off the "
            "boil, and a slow spiral pour. The bloom releases trapped gas "
            "before the main pour."
        ),
        "summary": "Bloom, spiral pouring and grind size shape a clean pour-over.",
        "tags": ["coffee", "pourover"],
        "topic": "coffee",
    },
    {
        "post_id": _pid(_COFFEE, 3),
        "title": "French press without sludge",
        "body": (
            "For a clean french press cup, use a coarse grind and decant "
            "instead of plunging hard. Four minutes of steeping is plenty."
        ),
        "summary": "Coarse grounds and gentle decanting keep french press cups clear.",
        "tags": ["coffee", "frenchpress"],
        "topic": "coffee",
    },
    {
        "post_id": _pid(_COFFEE, 4),
        "title": "Why grind size dominates flavor",
        "body": (
            "Grind size controls extraction speed: finer grounds extract "
            "faster and turn bitter sooner. Match the grind to your brew "
            "method before touching dose or temperature."
        ),
        "summary": "Extraction balance starts with choosing the right grind size.",
        "tags": ["coffee", "grinders"],
        "topic": "coffee",
    },
    {
        "post_id": _pid(_COFFEE, 5),
        "title": "Water temperature and extraction",
        "body": (
            "Hotter water extracts more from the same grounds. Light roasts "
            "reward hotter pours while dark roasts turn harsh above 95 "
            "degrees."
        ),
        "summary": "Temperature tunes extraction strength for each roast level.",
        "tags": ["coffee", "water"],
        "topic": "coffee",
    },
    # --- Topic: road cycling ---
    {
        "post_id": _pid(_CYCLING, 1),
        "title": "Climbing out of the saddle",
        "body": (
            "Out-of-the-saddle climbing trades efficiency for torque. Shift "
            "one gear harder before you stand and keep your hips over the "
            "bottom bracket."
        ),
        "summary": "Standing climbs need a harder gear and balanced hip position.",
        "tags": ["cycling", "climbing"],
        "topic": "cycling",
    },
    {
        "post_id": _pid(_CYCLING, 2),
        "title": "Getting a proper bike fit",
        "body": (
            "Saddle height set by heel drop and a level pelvis removes most "
            "knee pain on long rides. A professional bike fit pays for itself "
            "in comfort."
        ),
        "summary": "Correct saddle height and fit prevent most riding knee pain.",
        "tags": ["cycling", "bikefit"],
        "topic": "cycling",
    },
    {
        "post_id": _pid(_CYCLING, 3),
        "title": "Group ride etiquette",
        "body": (
            "Hold a steady line, point out road hazards, and rotate through "
            "the pace line smoothly. Predictability keeps a group ride safe "
            "for everyone behind you."
        ),
        "summary": "Steady lines and clear calls make group rides safe.",
        "tags": ["cycling", "grouprides"],
        "topic": "cycling",
    },
    {
        "post_id": _pid(_CYCLING, 4),
        "title": "Tire pressure for rough roads",
        "body": (
            "Lower tire pressure absorbs chatter and grips better on broken "
            "asphalt. Wider tires let you run softer pressures without "
            "pinch flats."
        ),
        "summary": "Softer, wider tires grip and comfort better on rough roads.",
        "tags": ["cycling", "tires"],
        "topic": "cycling",
    },
    {
        "post_id": _pid(_CYCLING, 5),
        "title": "Training with power zones",
        "body": (
            "Power zones turn training into repeatable intervals. Most weeks "
            "should be easy miles with one or two hard interval sessions."
        ),
        "summary": "Structured power intervals beat random hard miles.",
        "tags": ["cycling", "training"],
        "topic": "cycling",
    },
    # --- Topic: mechanical keyboards ---
    {
        "post_id": _pid(_KEYBOARDS, 1),
        "title": "Linear vs tactile vs clicky switches",
        "body": (
            "Switch choice defines how a board feels: linears glide, tactiles "
            "bump, clickies ping. Try a switch tester before committing to a "
            "full build."
        ),
        "summary": "Switch family decides the feel and sound of every keystroke.",
        "tags": ["keyboards", "switches"],
        "topic": "keyboards",
    },
    {
        "post_id": _pid(_KEYBOARDS, 2),
        "title": "Keycap profiles explained",
        "body": (
            "Keycap profile changes typing angle row by row. SA is tall and "
            "sculpted, Cherry is short and flat, and each suits different "
            "wrists."
        ),
        "summary": "Cap profile shapes typing angle and comfort across rows.",
        "tags": ["keyboards", "keycaps"],
        "topic": "keyboards",
    },
    {
        "post_id": _pid(_KEYBOARDS, 3),
        "title": "Lubing switches and stabilizers",
        "body": (
            "A thin coat of lube on switch rails removes spring scratch and "
            "rattle. Stabilizers benefit the most, especially on the spacebar."
        ),
        "summary": "Lube quiets rattle and smooths scratch in switches and stabs.",
        "tags": ["keyboards", "lube"],
        "topic": "keyboards",
    },
    {
        "post_id": _pid(_KEYBOARDS, 4),
        "title": "Choosing a layout size",
        "body": (
            "Sixty-five percent boards keep arrows while dropping the number "
            "row. Split and ortholinear layouts trade habit for ergonomics."
        ),
        "summary": "Layout size balances desk space, arrows and muscle memory.",
        "tags": ["keyboards", "layouts"],
        "topic": "keyboards",
    },
    {
        "post_id": _pid(_KEYBOARDS, 5),
        "title": "First steps with keyboard firmware",
        "body": (
            "Open-source firmware lets you remap layers, tap-dance and flash "
            "over USB. Start with a small layer change before rebuilding your "
            "whole keymap."
        ),
        "summary": "Remappable firmware unlocks layers and macros on any build.",
        "tags": ["keyboards", "firmware"],
        "topic": "keyboards",
    },
    # --- Topic: street photography ---
    {
        "post_id": _pid(_PHOTOGRAPHY, 1),
        "title": "Zone focusing for candids",
        "body": (
            "Zone focusing pre-sets distance and aperture so the shutter fires "
            "without hunting. Stop down to f/8 and everything within your "
            "zone stays sharp."
        ),
        "summary": "Pre-set focus zones make candid street frames instant.",
        "tags": ["photography", "focusing"],
        "topic": "photography",
    },
    {
        "post_id": _pid(_PHOTOGRAPHY, 2),
        "title": "Shooting the golden hour",
        "body": (
            "Low sun turns ordinary streets into rim-lit scenes. Arrive early, "
            "meter for highlights and let shadows go deep."
        ),
        "summary": "Golden hour light rewards early arrival and highlight metering.",
        "tags": ["photography", "light"],
        "topic": "photography",
    },
    {
        "post_id": _pid(_PHOTOGRAPHY, 3),
        "title": "Framing with layers",
        "body": (
            "Strong street frames stack a foreground, a subject and a backdrop. "
            "Move your feet before reaching for a zoom ring."
        ),
        "summary": "Layered composition adds depth to flat street scenes.",
        "tags": ["photography", "composition"],
        "topic": "photography",
    },
    {
        "post_id": _pid(_PHOTOGRAPHY, 4),
        "title": "Film habits that improve digital work",
        "body": (
            "Shooting a film roll forces you to compose before pressing the "
            "button. Carrying that discipline back to digital slows the "
            "spray-and-pray habit."
        ),
        "summary": "Film's frame limits teach deliberate digital shooting.",
        "tags": ["photography", "film"],
        "topic": "photography",
    },
    {
        "post_id": _pid(_PHOTOGRAPHY, 5),
        "title": "The ethics of candid streets",
        "body": (
            "Photographing strangers in public is legal in many places and "
            "still deserves care. A smile and an offered copy of the shot go "
            "a long way."
        ),
        "summary": "Respectful candids balance legality with common decency.",
        "tags": ["photography", "ethics"],
        "topic": "photography",
    },
]

POST_BY_ID = {post["post_id"]: post for post in CORPUS}

# Synthetic users. Single-topic users interact with three of five same-topic
# posts and hold out the rest; the mixed user spans two topics; the
# cold-start user has no history at all.
USERS: list[dict] = [
    {
        "id": "eval-user-coffee",
        "interactions": [
            (_pid(_COFFEE, 1), "view"),
            (_pid(_COFFEE, 2), "like"),
            (_pid(_COFFEE, 3), "save"),
        ],
        "held_out_post_ids": [_pid(_COFFEE, 4), _pid(_COFFEE, 5)],
        "cold_start": False,
    },
    {
        "id": "eval-user-cycling",
        "interactions": [
            (_pid(_CYCLING, 1), "like"),
            (_pid(_CYCLING, 2), "view"),
            (_pid(_CYCLING, 3), "save"),
        ],
        "held_out_post_ids": [_pid(_CYCLING, 4), _pid(_CYCLING, 5)],
        "cold_start": False,
    },
    {
        "id": "eval-user-keyboards",
        "interactions": [
            (_pid(_KEYBOARDS, 1), "save"),
            (_pid(_KEYBOARDS, 2), "like"),
            (_pid(_KEYBOARDS, 3), "view"),
        ],
        "held_out_post_ids": [_pid(_KEYBOARDS, 4), _pid(_KEYBOARDS, 5)],
        "cold_start": False,
    },
    {
        "id": "eval-user-photography",
        "interactions": [
            (_pid(_PHOTOGRAPHY, 1), "view"),
            (_pid(_PHOTOGRAPHY, 2), "save"),
            (_pid(_PHOTOGRAPHY, 3), "like"),
        ],
        "held_out_post_ids": [_pid(_PHOTOGRAPHY, 4), _pid(_PHOTOGRAPHY, 5)],
        "cold_start": False,
    },
    {
        "id": "eval-user-mixed",
        "interactions": [
            (_pid(_COFFEE, 1), "like"),
            (_pid(_PHOTOGRAPHY, 2), "view"),
        ],
        "held_out_post_ids": [_pid(_COFFEE, 4), _pid(_PHOTOGRAPHY, 4)],
        "cold_start": False,
    },
    {
        "id": "eval-user-cold-start",
        "interactions": [],
        "held_out_post_ids": [],
        "cold_start": True,
    },
]
