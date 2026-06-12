"""Add is_staged to songs

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('songs', sa.Column('is_staged', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('songs', 'is_staged')
