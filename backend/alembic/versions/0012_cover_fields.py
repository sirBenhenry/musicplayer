"""Add has_cover, cover_fetch_attempts, cover_last_tried_at to songs.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("has_cover", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("songs", sa.Column("cover_fetch_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("songs", sa.Column("cover_last_tried_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("songs", "cover_last_tried_at")
    op.drop_column("songs", "cover_fetch_attempts")
    op.drop_column("songs", "has_cover")
