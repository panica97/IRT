"""Strip (N) shift notation from cond strings in drafts

Revision ID: 008
Revises: 007
Create Date: 2026-03-23

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Migration already applied in previous container build.
    # Kept as a stub for Alembic revision chain continuity.
    pass


def downgrade() -> None:
    pass
