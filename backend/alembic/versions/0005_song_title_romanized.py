"""add title_romanized to songs

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("title_romanized", sa.String(), nullable=True))


def downgrade():
    op.drop_column("songs", "title_romanized")
