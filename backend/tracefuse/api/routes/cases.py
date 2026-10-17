"""Casebook: persistent cases, notes, bookmarks, evidence reviews, decisions, analyst hypotheses."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from ...reports.builder import build_report, render_html
from ...services import Services
from ..deps import services

router = APIRouter(prefix="/api/cases", tags=["casebook"])

TargetType = Literal["case", "address", "transfer", "edge", "evidence", "relationship", "transaction"]


class CaseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field("", max_length=5000)


class CaseUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    review_state: Literal["open", "in_review", "closed"] | None = None
    ui_state: dict[str, Any] | None = None


class NoteIn(BaseModel):
    target_type: TargetType = "case"
    target_id: str | None = Field(None, max_length=300)
    body: str = Field(min_length=1, max_length=10000)


class NoteEdit(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class BookmarkIn(BaseModel):
    target_type: TargetType
    target_id: str = Field(min_length=1, max_length=300)
    label: str | None = Field(None, max_length=200)


class ReviewIn(BaseModel):
    state: Literal["unreviewed", "reviewed", "accepted", "disputed", "rejected"]
    note: str | None = Field(None, max_length=5000)


class DecisionIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class HypothesisIn(BaseModel):
    source_entity: str = Field(min_length=1, max_length=300)
    target_entity: str = Field(min_length=1, max_length=300)
    relation: str = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=5000)


@router.get("")
def list_cases(s: Services = Depends(services)) -> list[dict[str, Any]]:
    return s.cases.list()


@router.post("", status_code=201)
def create_case(body: CaseCreate, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.create(body.title.strip(), body.description)


@router.get("/{case_id}")
def get_case(case_id: str, s: Services = Depends(services)) -> dict[str, Any]:
    c = s.cases.get(case_id)
    return {**c, "investigations": s.investigations.list(case_id), "notes": s.cases.notes(case_id),
            "bookmarks": s.cases.bookmarks(case_id), "reviews": s.cases.reviews(case_id),
            "decisions": s.cases.decisions(case_id), "hypotheses": s.cases.relationships(case_id)}


@router.patch("/{case_id}")
def update_case(case_id: str, body: CaseUpdate, s: Services = Depends(services)) -> dict[str, Any]:
    if body.ui_state is not None and len(str(body.ui_state)) > 64_000:
        raise HTTPException(413, "ui_state too large")
    return s.cases.update(case_id, **body.model_dump(exclude_none=True))


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: str, s: Services = Depends(services)) -> Response:
    s.cases.delete(case_id)
    return Response(status_code=204)


@router.post("/{case_id}/notes", status_code=201)
def add_note(case_id: str, body: NoteIn, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.add_note(case_id, body.target_type, body.target_id, body.body)


@router.patch("/{case_id}/notes/{note_id}")
def edit_note(case_id: str, note_id: str, body: NoteEdit, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.update_note(case_id, note_id, body.body)


@router.delete("/{case_id}/notes/{note_id}", status_code=204)
def delete_note(case_id: str, note_id: str, s: Services = Depends(services)) -> Response:
    s.cases.delete_note(case_id, note_id)
    return Response(status_code=204)


@router.post("/{case_id}/bookmarks", status_code=201)
def add_bookmark(case_id: str, body: BookmarkIn, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.add_bookmark(case_id, body.target_type, body.target_id, body.label)


@router.delete("/{case_id}/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(case_id: str, bookmark_id: str, s: Services = Depends(services)) -> Response:
    s.cases.delete_bookmark(case_id, bookmark_id)
    return Response(status_code=204)


@router.put("/{case_id}/reviews/{evidence_id}")
def set_review(case_id: str, evidence_id: str, body: ReviewIn, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.set_review(case_id, evidence_id, body.state, body.note)


@router.post("/{case_id}/decisions", status_code=201)
def add_decision(case_id: str, body: DecisionIn, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.add_decision(case_id, body.body)


@router.delete("/{case_id}/decisions/{decision_id}", status_code=204)
def delete_decision(case_id: str, decision_id: str, s: Services = Depends(services)) -> Response:
    s.cases.delete_decision(case_id, decision_id)
    return Response(status_code=204)


@router.post("/{case_id}/hypotheses", status_code=201)
def add_hypothesis(case_id: str, body: HypothesisIn, s: Services = Depends(services)) -> dict[str, Any]:
    return s.cases.add_relationship(case_id, body.source_entity, body.target_entity, body.relation, body.rationale)


@router.delete("/{case_id}/hypotheses/{rel_id}", status_code=204)
def delete_hypothesis(case_id: str, rel_id: str, s: Services = Depends(services)) -> Response:
    s.cases.delete_relationship(case_id, rel_id)
    return Response(status_code=204)


@router.get("/{case_id}/report.html")
def case_report(case_id: str, download: bool = False, s: Services = Depends(services)) -> HTMLResponse:
    invs = s.investigations.list(case_id)
    done = [i for i in invs if i["status"] in ("completed", "partial", "cancelled")]
    if not done:
        raise HTTPException(409, "case has no finished investigation to report on")
    headers = {"Content-Disposition": f'attachment; filename="tracefuse-case-{case_id}.html"'} if download else {}
    return HTMLResponse(render_html(build_report(s, done[0]["id"], case_id)), headers=headers)
