"""Add beat_strength, spectral_centroid, dyn_complexity for vibe-aware radio.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("beat_strength", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("spectral_centroid", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("dyn_complexity", sa.Float(), nullable=True))


def downgrade():
    for col in ["beat_strength", "spectral_centroid", "dyn_complexity"]:
        op.drop_column("songs", col)
