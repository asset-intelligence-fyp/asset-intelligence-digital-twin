from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator
import math


class AnomalyAnswer(BaseModel):
    status: Literal["normal", "suspect", "anomaly", "unknown"]
    anomaly_type: str = "unspecified"
    confidence: float = Field(ge=0, le=1)
    evidence_timestamps: list[str] = Field(default_factory=list)
    explanation: str


class ForecastAnswer(BaseModel):
    values: list[float]
    explanation: str

    @field_validator("values")
    @classmethod
    def finite_values(cls, values: list[float]):
        if not values or any(not math.isfinite(x) for x in values):
            raise ValueError("Forecast must contain finite numeric values")
        return values


class RetrievalPlan(BaseModel):
    action: Literal["recent", "reference", "summary", "seasonal", "similar", "related", "context", "finish"]
    reason: str
    lookback_hours: int = Field(default=3, ge=1, le=6)
    lookback_days: int = Field(default=30, ge=1, le=90)
