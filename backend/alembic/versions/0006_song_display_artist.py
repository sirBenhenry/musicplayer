"""add display_artist to songs

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("display_artist", sa.String(), nullable=True))


def downgrade():
    op.drop_column("songs", "display_artist")
