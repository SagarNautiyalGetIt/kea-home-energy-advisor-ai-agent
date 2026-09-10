"""Reading a bill the customer photographed, and pricing it against Kea.

Two modules, deliberately split: `reader.py` gets numbers off a page and knows nothing
about Kea, `compare.py` does arithmetic on those numbers and never calls a model. The
seam is the point — it keeps the part that can hallucinate away from the part that
decides whether somebody should switch retailer.
"""

from app.bills.compare import BillComparison, compare_to_kea
from app.bills.reader import BillReadError, BillReading, read_bill

__all__ = [
    "BillComparison",
    "BillReadError",
    "BillReading",
    "compare_to_kea",
    "read_bill",
]
