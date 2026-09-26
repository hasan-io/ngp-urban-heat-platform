from enum import Enum


class Layer(str, Enum):
    lst = "lst"
    ndvi = "ndvi"
    ndbi = "ndbi"


class Priority(str, Enum):
    critical = "CRITICAL"
    high = "HIGH"
    medium = "MEDIUM"
    low = "LOW"


class Severity(str, Enum):
    critical = "Critical"
    high = "High"
    moderate = "Moderate"


class ScenarioMethod(str, Enum):
    linear = "linear"
    ml = "ml"


class ReportType(str, Enum):
    full = "full"
    executive = "executive"
    technical = "technical"
