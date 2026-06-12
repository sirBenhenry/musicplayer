"""Add mood, BPM, and key columns for vibe-aware radio recommendations.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("bpm", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("key_root", sa.SmallInteger(), nullable=True))
    op.add_column("songs", sa.Column("key_mode", sa.String(5), nullable=True))
    op.add_column("songs", sa.Column("mood_happy", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("mood_sad", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("mood_aggressive", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("mood_relaxed", sa.Float(), nullable=True))
    op.add_column("songs", sa.Column("mood_party", sa.Float(), nullable=True))


def downgrade():
    for col in ["bpm", "key_root", "key_mode", "mood_happy", "mood_sad",
                "mood_aggressive", "mood_relaxed", "mood_party"]:
        op.drop_column("songs", col)
