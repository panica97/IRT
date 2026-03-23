"""Add label, strategies_found, drafts_created to research_sessions

Revision ID: 009
Revises: 008
Create Date: 2026-03-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "research_sessions",
        sa.Column("label", sa.String(255), nullable=True),
    )
    op.add_column(
        "research_sessions",
        sa.Column("strategies_found", sa.Integer(), nullable=True),
    )
    op.add_column(
        "research_sessions",
        sa.Column("drafts_created", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("research_sessions", "drafts_created")
    op.drop_column("research_sessions", "strategies_found")
    op.drop_column("research_sessions", "label")
