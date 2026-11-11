"""Public RAG inputs: static app help, or explicitly public records for one school."""

import re
from datetime import datetime

APP_SOURCES = ("app:types", "app:screens", "app:navigation")

# Only public top-level collections in backend/firestore/firestore.rules.
# Subcollections (including personal courses) are never exported.
PUBLIC_FIELDS = {
    "announcements": ("title", "body", "content", "source", "category", "publishedAt"),
    "events": ("title", "description", "location", "startsAt", "endsAt", "organizer"),
    "courses": ("name", "code", "teacher", "description", "credits", "department"),
    "menus": ("name", "description", "price", "category", "cafeteria"),
    "pois": ("name", "category", "description", "address", "openingHours"),
}


def public_school_id(value: object) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?", value):
        return None
    if value in ("all", "unknown", "unavailable-campus"):
        return None
    return {"tw-pu": "pu", "tw-nchu": "nchu"}.get(value, value)


def retrieval_filter(school_id: object = None) -> dict:
    app_help = {"source": {"$in": list(APP_SOURCES)}}
    school = public_school_id(school_id)
    if not school:
        return app_help
    public_school = {"$and": [
        {"schoolId": school},
        {"source": {"$in": [f"firestore:{name}" for name in PUBLIC_FIELDS]}},
    ]}
    return {"$or": [app_help, public_school]}


def is_public_visibility(value: object) -> bool:
    """Known public collections stay public when the marker is absent."""
    return value is None or value == "public"


def public_document(collection: str, data: dict, document_id: str) -> dict | None:
    if collection not in PUBLIC_FIELDS or not isinstance(data, dict) or not is_public_visibility(data.get("visibility")):
        return None
    school = public_school_id(data.get("schoolId"))
    if not school:
        return None
    lines = []
    for field in PUBLIC_FIELDS[collection]:
        value = data.get(field)
        if isinstance(value, datetime):
            value = value.strftime("%Y/%m/%d %H:%M")
        # Nested structures may contain non-public fields. Export scalar display data only.
        if isinstance(value, (str, int, float)) and not isinstance(value, bool) and value != "":
            lines.append(f"{field}: {value}")
    if not lines:
        return None
    return {
        "text": "\n".join([f"[{collection}]", *lines]),
        "source": f"firestore:{collection}",
        "metadata": {"schoolId": school, "visibility": "public", "firestore_id": document_id},
    }
