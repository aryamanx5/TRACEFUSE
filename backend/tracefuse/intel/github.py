"""GitHub REST search connector (public data only).

Docs (docs.github.com/rest/search): issues & commits search work unauthenticated (10 req/min);
code search requires authentication (10 req/min). ``Accept: application/vnd.github.text-match+json``
returns ``text_matches`` fragments used as reviewable context. Queries are targeted (exact indicator
strings only) and bounded per investigation.
"""

from __future__ import annotations

from typing import Any

from ..config import Settings
from ..domain.models import AssertionStatus, ConfidenceCategory, Evidence, EvidenceKind
from ..providers.base import FetchContext, ts_from_iso
from ..providers.http import HttpResult, ResilientHttp
from .extract import clean_text, context_terms, extract_indicators, fingerprint, snippet_around

API = "https://api.github.com"
TEXT_MATCH = "application/vnd.github.text-match+json"
MENTION_CAVEAT = "A public mention of an address is not proof of ownership, control or culpability."


class GitHubClient:
    source = "github"

    def __init__(self, http: ResilientHttp, settings: Settings):
        self.http = http
        self.settings = settings

    @property
    def authenticated(self) -> bool:
        return bool(self.settings.github_token and self.settings.github_token.get_secret_value())

    def _headers(self) -> dict[str, str]:
        h = {"Accept": TEXT_MATCH, "X-GitHub-Api-Version": "2022-11-28"}
        if self.authenticated:
            assert self.settings.github_token is not None
            h["Authorization"] = f"Bearer {self.settings.github_token.get_secret_value()}"
        return h

    def endpoints(self) -> list[str]:
        return ["issues", "commits"] + (["code"] if self.authenticated else [])

    async def search(self, endpoint: str, indicator: str, ctx: FetchContext, per_page: int = 10) -> HttpResult:
        if endpoint not in ("issues", "commits", "code"):
            raise ValueError("unsupported search endpoint")
        return await self.http.request(
            "github", "GET", f"{API}/search/{endpoint}", params={"q": f'"{indicator}"', "per_page": per_page},
            headers=self._headers(), cache_ttl=self.settings.cache_ttl_intel_seconds, budget=ctx.budget,
        )

    def to_evidence(self, endpoint: str, indicator: str, chain: str, res: HttpResult, ctx: FetchContext) -> list[Evidence]:
        evs: list[Evidence] = []
        is_tx = len(indicator) == 66
        for item in (res.data or {}).get("items", [])[:30]:
            if endpoint == "issues":
                title = clean_text(item.get("title"), 300)
                text = f"{title}\n{clean_text(item.get('body'))}"
                url, item_id = item.get("html_url"), f"issue:{item.get('id')}"
                repo = str(item.get("repository_url") or "").removeprefix(f"{API}/repos/")
                published = ts_from_iso(item.get("created_at"))
                kind_label = "pull request" if item.get("pull_request") else "issue"
                doc_title = f"GitHub {kind_label}: {title[:120]}"
            elif endpoint == "commits":
                msg = clean_text((item.get("commit") or {}).get("message"))
                text, url, item_id = msg, item.get("html_url"), f"commit:{item.get('sha')}"
                repo = str((item.get("repository") or {}).get("full_name") or "")
                published = ts_from_iso(((item.get("commit") or {}).get("author") or {}).get("date"))
                doc_title = f"GitHub commit in {repo}: {msg.splitlines()[0][:100] if msg else ''}"
            else:
                frags = " … ".join(clean_text(tm.get("fragment"), 2000) for tm in item.get("text_matches") or [])
                text, url = frags, item.get("html_url")
                item_id = f"code:{(item.get('repository') or {}).get('full_name')}/{item.get('path')}@{item.get('sha')}"
                repo = str((item.get("repository") or {}).get("full_name") or "")
                published = None
                doc_title = f"GitHub file {repo}/{item.get('path')}"
            fragments = [clean_text(tm.get("fragment"), 1500) for tm in item.get("text_matches") or []]
            hit = snippet_around(text, indicator) or next(
                ((f, f.lower().find(indicator.lower())) for f in fragments if indicator.lower() in f.lower()), None)
            if hit is None:
                continue  # GitHub matched on tokens but the exact indicator string is absent: not an exact match
            snippet, pos = hit
            co = sorted({i.value for i in extract_indicators(text) if i.value != indicator.lower()})[:25]
            terms = context_terms(text)
            evs.append(Evidence(
                kind=EvidenceKind.ADDRESS_MENTION, subject_chain=chain,
                subject_address=None if is_tx else indicator.lower(), subject_tx=indicator.lower() if is_tx else None,
                title=doc_title, source=f"github-{endpoint}", source_url=url, source_item_id=item_id,
                snippet=snippet[:600], match_location=f"{endpoint} text offset {pos}",
                match_criteria="exact indicator string present in public text", query=f'"{indicator}"',
                published_at=published, collected_at=res.retrieved_at,
                confidence=ConfidenceCategory.WEAK, assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                caveats=[MENTION_CAVEAT] + ([] if terms else ["No incident-related context terms near the mention."]),
                attributes={"repository": repo, "context_terms": terms, "co_mentioned_indicators": co,
                            "authenticated": self.authenticated},
                fingerprint=fingerprint(snippet), data_origin=ctx.origin_for(res),
            ))
        return evs


def independent_sources(evidence: list[Evidence]) -> int:
    """Count independent public mentions: distinct content fingerprints across distinct repository owners."""
    seen_fp: set[str] = set()
    owners: set[str] = set()
    for e in evidence:
        if e.kind != EvidenceKind.ADDRESS_MENTION:
            continue
        if e.fingerprint in seen_fp:
            continue
        seen_fp.add(e.fingerprint or e.id)
        owners.add(str(e.attributes.get("repository", "")).split("/")[0] or e.id)
    return len(owners)


def has_incident_context(e: Evidence) -> bool:
    return bool(e.attributes.get("context_terms")) if isinstance(e.attributes, dict) else False


def summarize(evidence: list[Evidence]) -> dict[str, Any]:
    return {"mentions": len([e for e in evidence if e.kind == EvidenceKind.ADDRESS_MENTION]),
            "independent_sources": independent_sources(evidence)}
