"""add monkey test params to backtest jobs

Revision ID: 015
Revises: 014
Create Date: 2026-03-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "backtest_jobs",
        sa.Column("n_simulations", sa.Integer(), nullable=True),
    )
    op.add_column(
        "backtest_jobs",
        sa.Column("monkey_mode", sa.String(5), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("backtest_jobs", "monkey_mode")
    op.drop_column("backtest_jobs", "n_simulations")
